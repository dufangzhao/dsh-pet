import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  CordisRuntimeDriver,
  PluginManager,
  type PluginManagerOptions,
  type PluginModule,
  type PluginRuntimeContext,
} from '@pet/host-kernel';
import type { PluginManifest, Result } from '@pet/contracts';
import {
  makeFailingPlugin,
  makeRecordingPlugin,
  makeSlowPlugin,
  makeStuckCleanupPlugin,
  makeProviderPlugin,
} from './fixtures/index.js';
import {
  PRIMARY_EFFECT_START,
  PRIMARY_EFFECT_STOP,
  SECONDARY_EFFECT_START,
  SECONDARY_EFFECT_STOP,
  SLOW_ACTIVATE_BEGIN,
  STUCK_CLEANUP_BEGIN,
  STUCK_CLEANUP_END,
  FAST_CLEANUP_END,
} from './fixtures/markers.js';
const base = path.resolve('.cache-fixture-path-only');
const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });
function manifest(id: string, extra: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    id,
    version: '1.0.0',
    displayName: { 'zh-CN': '测试' },
    description: { 'zh-CN': '公开夹具' },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['win32-x64'],
    entries: { runtime: 'index.js' },
    ...extra,
  };
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const cleanup: Array<() => Promise<void>> = [];
function harness(
  modules: Record<string, PluginModule>,
  options: Partial<PluginManagerOptions> = {},
  confirmed = true,
  expectCleanupFailure = false,
) {
  const load = vi.fn(async (request: { owner: { pluginId: string } }) => {
    const module = modules[request.owner.pluginId];
    if (!module) throw new Error('fixture missing');
    return module;
  });
  const driver = new CordisRuntimeDriver(load);
  const manager = new PluginManager({
    driver,
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    ...(confirmed ? { trust: async () => true } : {}),
    activationTimeoutMs: 1000,
    cleanupTimeoutMs: 100,
    ...options,
  });
  cleanup.push(async () => {
    await manager.shutdown();
    if (expectCleanupFailure)
      await expect(driver.dispose()).rejects.toThrow('Runtime cleanup incomplete');
    else await driver.dispose();
  });
  return { manager, driver, load };
}
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

describe('real Cordis host lifecycle', () => {
  it('activates and reverses owned effects without exposing Cordis', async () => {
    const f = makeRecordingPlugin();
    let api: PluginRuntimeContext | undefined;
    const module: PluginModule = {
      activate(ctx) {
        api = ctx;
        return f.module.activate(ctx);
      },
    };
    const { manager } = harness({ 'test.a': module });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    const first = value(await manager.enable(identity('test.a')));
    expect(first.state).toBe('active');
    expect(Object.keys(api!).sort()).toEqual([
      'config',
      'contribute',
      'effect',
      'owner',
      'provide',
      'signal',
    ]);
    expect(Object.isFrozen(api)).toBe(true);
    expect(f.events).toEqual([PRIMARY_EFFECT_START, SECONDARY_EFFECT_START]);
    expect(value(await manager.disable(identity('test.a'))).state).toBe('disabled');
    expect(f.events).toEqual([
      PRIMARY_EFFECT_START,
      SECONDARY_EFFECT_START,
      SECONDARY_EFFECT_STOP,
      PRIMARY_EFFECT_STOP,
    ]);
    expect(api!.signal.aborted).toBe(true);
    expect(() => api!.effect(() => () => {})).toThrow();
    const next = value(await manager.enable(identity('test.a')));
    expect(next.owner.generation).toBeGreaterThan(first.owner.generation);
    expect(manager.isLive(first.owner)).toBe(false);
  });
  it('fails closed without a trust confirmation hook', async () => {
    const f = makeRecordingPlugin();
    const { manager, load } = harness({ 'test.a': f.module }, {}, false);
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    expect(await manager.enable(identity('test.a'))).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
    expect(load).not.toHaveBeenCalled();
    expect(manager.get(identity('test.a'))?.state).toBe('unready');
  });
  it('rolls back failed activation and does not echo plugin exceptions', async () => {
    const f = makeFailingPlugin();
    const { manager } = harness({ 'test.a': f.module });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    const result = await manager.enable(identity('test.a'));
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(result)).not.toContain('fixture:');
    expect(manager.get(identity('test.a'))?.state).toBe('failed');
    expect(f.events.slice(-2)).toEqual([SECONDARY_EFFECT_STOP, PRIMARY_EFFECT_STOP]);
    expect(manager.capabilities.list()).toEqual([]);
  });
  it('deduplicates enable while activation is pending', async () => {
    const f = makeSlowPlugin();
    const { manager, load } = harness({ 'test.a': f.module });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    const one = manager.enable(identity('test.a'));
    const two = manager.enable(identity('test.a'));
    expect(one).toBe(two);
    await vi.waitFor(() => expect(f.events).toContain(SLOW_ACTIVATE_BEGIN));
    expect(manager.get(identity('test.a'))?.state).toBe('activating');
    expect(manager.capabilities.list()).toEqual([]);
    f.release();
    expect(value(await one).state).toBe('active');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('marks stuck cleanup pending_restart and never claims uninstall', async () => {
    const f = makeStuckCleanupPlugin();
    const remove = vi.fn(async () => true);
    const { manager } = harness(
      { 'test.a': f.module },
      { cleanupTimeoutMs: 15, removeInstallation: remove },
    );
    cleanup.push(async () => {
      f.release();
    });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    value(await manager.enable(identity('test.a')));
    const stopped = value(await manager.disable(identity('test.a')));
    expect(stopped.state).toBe('pending_restart');
    expect(f.events).toContain(STUCK_CLEANUP_BEGIN);
    expect(f.events).not.toContain(FAST_CLEANUP_END);
    expect(await manager.uninstall(identity('test.a'))).toMatchObject({ ok: false });
    expect(remove).not.toHaveBeenCalled();
    f.release();
    await vi.waitFor(() => expect(f.events).toContain(STUCK_CLEANUP_END));
    expect(manager.get(identity('test.a'))?.state).toBe('pending_restart');
  });
  it('reserves protected identities and only shuts them down through host shutdown', async () => {
    const f = makeRecordingPlugin();
    const { manager } = harness(
      { 'core.test': f.module },
      { protectedPackages: { 'core.test': base } },
    );
    expect(
      manager.install(manifest('core.test'), { origin: 'user', directory: base }),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    value(manager.install(manifest('core.test'), { origin: 'builtin', directory: base }));
    value(await manager.enable(identity('core.test')));
    expect(await manager.disable(identity('core.test'))).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
    expect(await manager.uninstall(identity('core.test'))).toMatchObject({ ok: false });
    await manager.shutdown();
    expect(manager.get(identity('core.test'))?.state).toBe('disabled');
  });
  it('does not remove an installation without an explicit successful receipt', async () => {
    const f = makeRecordingPlugin();
    let removed = false;
    const { manager } = harness(
      { 'test.a': f.module },
      { removeInstallation: async () => removed },
    );
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    const first = value(await manager.enable(identity('test.a')));
    expect(await manager.uninstall(identity('test.a'))).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    expect(manager.get(identity('test.a'))?.state).toBe('disabled');
    removed = true;
    expect(await manager.uninstall(identity('test.a'))).toEqual({ ok: true, value: null });
    expect(manager.get(identity('test.a'))).toBeNull();
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    expect(value(await manager.enable(identity('test.a'))).owner.generation).toBeGreaterThan(
      first.owner.generation,
    );
  });
  it('keeps incompatible packages rejected without loading code', async () => {
    const { manager, load } = harness({});
    expect(
      value(
        manager.install(manifest('test.old', { host: '^2.0.0' }), {
          origin: 'user',
          directory: base,
        }),
      ).state,
    ).toBe('rejected');
    expect(await manager.enable(identity('test.old'))).toMatchObject({ ok: false });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('explicit provider selection and generation-bound calls', () => {
  it('does not auto-pick providers or migrate old bindings after a settings change', async () => {
    const a = makeProviderPlugin('main', { run: async () => 'a' }),
      b = makeProviderPlugin('main', { run: async () => 'b' }),
      consumer = makeRecordingPlugin();
    const { manager } = harness({
      'test.a': a.module,
      'test.b': b.module,
      'test.consumer': consumer.module,
    });
    for (const id of ['test.a', 'test.b']) {
      value(
        manager.install(
          manifest(id, {
            provides: [{ id: 'main', capability: 'test.echo@1', features: { stream: true } }],
          }),
          { origin: 'user', directory: base },
        ),
      );
      value(await manager.enable(identity(id)));
    }
    value(
      manager.install(
        manifest('test.consumer', { consumes: [{ capability: 'test.echo@1', optional: false }] }),
        { origin: 'user', directory: base },
      ),
    );
    expect(value(await manager.enable(identity('test.consumer'))).state).toBe('unready');
    value(
      manager.select(identity('test.consumer'), 'test.echo@1', {
        ...identity('test.a'),
        providerId: 'main',
      }),
    );
    const c = value(await manager.enable(identity('test.consumer')));
    const old = value(manager.capabilities.bind(c.owner, 'test.echo@1'));
    expect(manager.capabilities.resolveBound(structuredClone(old), 'run')).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
    value(
      manager.select(identity('test.consumer'), 'test.echo@1', {
        ...identity('test.b'),
        providerId: 'main',
      }),
    );
    expect(value(manager.capabilities.bind(c.owner, 'test.echo@1')).provider.pluginId).toBe(
      'test.b',
    );
    const call = { taskId: 'task', signal: new AbortController().signal };
    expect(await value(manager.capabilities.resolveBound(old, 'run'))(call, null)).toBe('a');
    await manager.disable(identity('test.a'));
    expect(manager.capabilities.resolveBound(old, 'run')).toMatchObject({
      ok: false,
      error: { code: 'stale-owner' },
    });
    expect(manager.get(identity('test.consumer'))?.state).toBe('active');
  });
  it('degrades dependent availability without falling back to another provider', async () => {
    const provider = makeProviderPlugin('main', { run: async () => true });
    const consumer = makeRecordingPlugin();
    const { manager } = harness({ 'test.a': provider.module, 'test.consumer': consumer.module });
    value(
      manager.install(
        manifest('test.a', { provides: [{ id: 'main', capability: 'test.echo@1' }] }),
        { origin: 'user', directory: base },
      ),
    );
    value(await manager.enable(identity('test.a')));
    value(
      manager.install(
        manifest('test.consumer', { consumes: [{ capability: 'test.echo@1', optional: false }] }),
        { origin: 'user', directory: base },
      ),
    );
    value(
      manager.select(identity('test.consumer'), 'test.echo@1', {
        ...identity('test.a'),
        providerId: 'main',
      }),
    );
    const c = value(await manager.enable(identity('test.consumer')));
    await manager.disable(identity('test.a'));
    expect(manager.get(identity('test.consumer'))?.state).toBe('unready');
    expect(manager.capabilities.bind(c.owner, 'test.echo@1')).toMatchObject({ ok: false });
    value(await manager.enable(identity('test.a')));
    expect(manager.get(identity('test.consumer'))?.state).toBe('active');
    expect(manager.get(identity('test.consumer'))?.owner).toEqual(c.owner);
  });
  it('publishes registrations only on successful activation and removes partial publishes', async () => {
    let api: PluginRuntimeContext | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const module: PluginModule = {
      async activate(ctx) {
        api = ctx;
        ctx.provide('main', { run: async () => 1 });
        await gate;
      },
    };
    const { manager } = harness({ 'test.a': module });
    value(
      manager.install(
        manifest('test.a', { provides: [{ id: 'main', capability: 'test.echo@1' }] }),
        { origin: 'user', directory: base },
      ),
    );
    const enabling = manager.enable(identity('test.a'));
    await vi.waitFor(() => expect(api).toBeDefined());
    expect(manager.capabilities.list()).toEqual([]);
    release();
    value(await enabling);
    expect(manager.capabilities.list()).toHaveLength(1);
    expect(() => api!.provide('main', { run: async () => 2 })).toThrow();
    expect(Object.keys(manager.capabilities.list()[0]!).sort()).toEqual(['declaration', 'owner']);
  });
});
describe('lifecycle race and failure boundaries', () => {
  it('does not ask for trust after immediate disable', async () => {
    const trust = vi.fn(async () => true);
    const f = makeRecordingPlugin();
    const { manager, load } = harness({ 'test.a': f.module }, { trust });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    const enable = manager.enable(identity('test.a'));
    await manager.disable(identity('test.a'));
    expect(await enable).toMatchObject({ ok: false });
    expect(trust).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it('does not activate declared resources without readiness services', async () => {
    const f = makeRecordingPlugin();
    const { manager, load } = harness({ 'test.a': f.module });
    value(
      manager.install(manifest('test.a', { permissions: [{ kind: 'microphone' }] }), {
        origin: 'user',
        directory: base,
      }),
    );
    expect(value(await manager.enable(identity('test.a'))).state).toBe('unready');
    expect(load).not.toHaveBeenCalled();
  });
  it('retains validated configuration when readiness is repaired', async () => {
    let ready = false;
    const seen: unknown[] = [];
    const f = makeRecordingPlugin();
    const { manager } = harness(
      { 'test.a': f.module },
      {
        readiness: async (_snapshot, config) => {
          seen.push(config);
          return ready
            ? null
            : { code: 'not-ready', messageKey: 'errors.not-ready', retryable: true };
        },
      },
    );
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    expect(value(await manager.enable(identity('test.a'), { option: 42 })).state).toBe('unready');
    ready = true;
    await manager.reconcile();
    expect(manager.get(identity('test.a'))?.state).toBe('active');
    expect(seen).toEqual([{ option: 42 }, { option: 42 }]);
  });
  it('cannot be re-enabled while an uninstall receipt is pending', async () => {
    let entered!: () => void, finish!: () => void;
    const arrived = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const remove = vi.fn(async () => {
      entered();
      await gate;
      return true;
    });
    const f = makeRecordingPlugin();
    const { manager } = harness({ 'test.a': f.module }, { removeInstallation: remove });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    value(await manager.enable(identity('test.a')));
    const removing = manager.uninstall(identity('test.a'));
    await arrived;
    expect(manager.uninstall(identity('test.a'))).toBe(removing);
    expect(await manager.enable(identity('test.a'))).toMatchObject({ ok: false });
    finish();
    expect(await removing).toEqual({ ok: true, value: null });
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('never reports disabled when a disposer throws', async () => {
    const events: string[] = [];
    const module: PluginModule = {
      activate(ctx) {
        ctx.effect(() => () => {
          events.push('first');
        });
        ctx.effect(() => () => {
          events.push('throws');
          throw new Error('private-disposal-detail');
        });
      },
    };
    const { manager } = harness({ 'test.a': module }, {}, true, true);
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    value(await manager.enable(identity('test.a')));
    const result = value(await manager.disable(identity('test.a')));
    expect(result.state).toBe('pending_restart');
    expect(events).toEqual(['throws', 'first']);
    expect(JSON.stringify(result)).not.toContain('private-disposal-detail');
  });
});
describe('activation cancellation and supervisor epochs', () => {
  it('keeps uncooperative activation pending_restart and rejects late registration', async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let lateRejected = false;
    const module: PluginModule = {
      async activate(ctx) {
        entered();
        await gate;
        try {
          ctx.provide('main', { run: async () => true });
        } catch {
          lateRejected = true;
        }
      },
    };
    const { manager, driver } = harness({ 'test.a': module }, { cleanupTimeoutMs: 15 });
    cleanup.push(async () => {
      release();
    });
    value(
      manager.install(
        manifest('test.a', { provides: [{ id: 'main', capability: 'test.echo@1' }] }),
        { origin: 'user', directory: base },
      ),
    );
    const enabling = manager.enable(identity('test.a'));
    await started;
    expect(value(await manager.disable(identity('test.a'))).state).toBe('pending_restart');
    expect(await enabling).toMatchObject({ ok: false });
    release();
    await vi.waitFor(() => expect(lateRejected).toBe(true));
    expect(manager.capabilities.list()).toEqual([]);
    await vi.waitFor(() => expect(driver.diagnostics().sessions).toBe(0));
    expect(manager.get(identity('test.a'))?.state).toBe('pending_restart');
  });
  it('passes immutable configuration to the runtime and sanitizes its readiness reason', async () => {
    let config: unknown;
    const { manager } = harness({
      'test.a': {
        activate(ctx) {
          config = ctx.config;
        },
      },
    });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    value(await manager.enable(identity('test.a'), { nested: { value: 1 } }));
    expect(config).toEqual({ nested: { value: 1 } });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen((config as { nested: unknown }).nested)).toBe(true);
  });
  it('invalidates active owners on supervisor fault and ignores stale fault notifications', async () => {
    const f = makeRecordingPlugin();
    const { manager } = harness({ 'test.a': f.module });
    value(manager.install(manifest('test.a'), { origin: 'user', directory: base }));
    const first = value(await manager.enable(identity('test.a')));
    expect(value(await manager.reportFault(first.owner)).state).toBe('failed');
    expect(manager.signal(first.owner)?.aborted).toBe(true);
    const second = value(await manager.enable(identity('test.a')));
    expect(second.owner.generation).toBeGreaterThan(first.owner.generation);
    expect(await manager.reportFault(first.owner)).toMatchObject({
      ok: false,
      error: { code: 'stale-owner' },
    });
    expect(manager.get(identity('test.a'))?.state).toBe('active');
  });
});
