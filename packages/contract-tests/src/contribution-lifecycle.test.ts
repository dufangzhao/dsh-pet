import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  CordisRuntimeDriver,
  PluginManager,
  type PluginLoader,
  type PluginRuntimeContext,
} from '@pet/host-kernel';
import type { ContributionDeclaration, PluginManifest, Result } from '@pet/contracts';
const take = <T>(value: Result<T>): T => {
  if (!value.ok) throw new Error(value.error.code);
  return value.value;
};
const declarations: ContributionDeclaration[] = [
  { id: 'run', kind: 'command', title: { 'zh-CN': '运行' }, handler: 'run' },
  { id: 'quick', kind: 'shortcut-button', title: { 'zh-CN': '快捷按钮' }, command: 'run' },
  {
    id: 'key',
    kind: 'hotkey',
    title: { 'zh-CN': '快捷键' },
    command: 'run',
    defaultKey: 'Ctrl+Shift+P',
  },
  { id: 'settings', kind: 'settings', title: { 'zh-CN': '设置' }, section: 'general' },
  { id: 'panel', kind: 'panel', title: { 'zh-CN': '面板' }, entry: 'panel.html' },
];
const manifest = (
  id = 'test.contributions',
  extra: Partial<PluginManifest> = {},
): PluginManifest => ({
  schemaVersion: 1,
  id,
  version: '1.0.0',
  displayName: { 'zh-CN': '贡献点夹具' },
  description: { 'zh-CN': '生命周期验证' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'entry.mjs' },
  contributes: structuredClone(declarations),
  ...extra,
});
function publish(ctx: PluginRuntimeContext, rows = declarations) {
  for (const row of rows)
    ctx.contribute(row.id, row.kind === 'command' ? async (_task, input) => input : undefined);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.useRealTimers();
});
function setup(
  loader: PluginLoader = async () => ({ activate: (ctx) => publish(ctx) }),
  release = () => {},
  cleanupTimeoutMs = 2000,
) {
  const driver = new CordisRuntimeDriver(loader),
    manager = new PluginManager({
      driver,
      hostApiVersion: '1.0.0',
      platform: 'win32-x64',
      trust: async () => true,
      readiness: async () => null,
      removeInstallation: async () => true,
      cleanupTimeoutMs,
    });
  cleanup.push(async () => {
    release();
    await manager.shutdown();
    await driver.dispose();
  });
  const install = (m = manifest()) => {
    take(manager.install(m, { directory: path.resolve('.fixture-not-imported'), origin: 'user' }));
    return { pluginId: m.id, instanceId: 'default' };
  };
  return { manager, install };
}
it('publishes five frozen declarations atomically only after activation succeeds', async () => {
  const entered = deferred(),
    gate = deferred(),
    f = setup(
      async () => ({
        async activate(ctx) {
          publish(ctx);
          entered.resolve();
          await gate.promise;
        },
      }),
      gate.resolve,
    ),
    id = f.install();
  const enabling = f.manager.enable(id);
  await entered.promise;
  expect(f.manager.contributions()).toEqual([]);
  gate.resolve();
  const active = take(await enabling),
    rows = f.manager.contributions();
  expect(rows.map((row) => row.declaration.kind)).toEqual(declarations.map((row) => row.kind));
  expect(rows.map((row) => row.id)).toEqual(declarations.map((row) => row.id));
  expect(rows.every((row) => row.owner.generation === active.owner.generation)).toBe(true);
  expect(Object.isFrozen(rows)).toBe(true);
  expect(Object.isFrozen(rows[0]!.declaration.title)).toBe(true);
  expect(Object.keys(rows[0]!).sort()).toEqual(['declaration', 'id', 'owner']);
});
it('removes every entry before waiting for disposal', async () => {
  const disposing = deferred(),
    gate = deferred(),
    f = setup(
      async () => ({
        activate(ctx) {
          publish(ctx);
          ctx.effect(() => async () => {
            disposing.resolve();
            await gate.promise;
          });
        },
      }),
      gate.resolve,
    ),
    id = f.install();
  take(await f.manager.enable(id));
  const stopping = f.manager.disable(id);
  await disposing.promise;
  expect(f.manager.contributions()).toEqual([]);
  gate.resolve();
  expect(take(await stopping).state).toBe('disabled');
});
it('keeps equal local contribution ids distinct across plugins', async () => {
  const f = setup(),
    a = f.install(manifest('test.first')),
    b = f.install(manifest('test.second'));
  take(await f.manager.enable(a));
  take(await f.manager.enable(b));
  expect(f.manager.contributions()).toHaveLength(10);
  take(await f.manager.disable(a));
  expect(f.manager.contributions()).toHaveLength(5);
  expect(f.manager.contributions().every((row) => row.owner.pluginId === b.pluginId)).toBe(true);
});
for (const mode of ['throw', 'missing', 'duplicate'] as const)
  it('does not publish a ' + mode + ' activation', async () => {
    const f = setup(async () => ({
        activate(ctx) {
          publish(ctx, mode === 'missing' ? declarations.slice(0, 4) : declarations);
          if (mode === 'throw') throw new Error('fixture');
          if (mode === 'duplicate') ctx.contribute('run', async () => null);
        },
      })),
      id = f.install();
    expect((await f.manager.enable(id)).ok).toBe(false);
    expect(f.manager.contributions()).toEqual([]);
  });
it('uses a new owner generation after restart and ignores stale faults', async () => {
  const f = setup(),
    id = f.install(),
    old = take(await f.manager.enable(id)).owner;
  take(await f.manager.disable(id));
  expect(f.manager.contributions()).toEqual([]);
  const fresh = take(await f.manager.enable(id)).owner;
  expect(fresh.generation).toBeGreaterThan(old.generation);
  expect(f.manager.contributions().every((row) => row.owner.generation === fresh.generation)).toBe(
    true,
  );
  expect(await f.manager.reportFault(old)).toMatchObject({
    ok: false,
    error: { code: 'stale-owner' },
  });
  expect(f.manager.contributions()).toHaveLength(5);
});
it('leaves no entries when disposal times out into pending_restart', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const disposing = deferred(),
    gate = deferred(),
    f = setup(
      async () => ({
        activate(ctx) {
          publish(ctx);
          ctx.effect(() => async () => {
            disposing.resolve();
            await gate.promise;
          });
        },
      }),
      gate.resolve,
      30,
    ),
    id = f.install();
  take(await f.manager.enable(id));
  const stopping = f.manager.disable(id);
  await disposing.promise;
  await vi.advanceTimersByTimeAsync(31);
  expect(take(await stopping).state).toBe('pending_restart');
  expect(f.manager.contributions()).toEqual([]);
  gate.resolve();
});
it('removes entries on uninstall and runtime faults', async () => {
  const f = setup(),
    a = f.install(manifest('test.remove')),
    b = f.install(manifest('test.fault'));
  take(await f.manager.enable(a));
  const owner = take(await f.manager.enable(b)).owner;
  expect(f.manager.contributions()).toHaveLength(10);
  take(await f.manager.uninstall(a));
  expect(f.manager.contributions()).toHaveLength(5);
  take(await f.manager.reportFault(owner));
  expect(f.manager.contributions()).toEqual([]);
});
it('hides contributions while a required provider is unavailable and restores the selected provider', async () => {
  const f = setup(async (activation) => ({
    activate(ctx) {
      if (activation.owner.pluginId === 'test.base') ctx.provide('main', { run: async () => true });
      else publish(ctx);
    },
  }));
  const base = f.install(
      manifest('test.base', {
        contributes: [],
        provides: [{ id: 'main', capability: 'test.base@1' }],
      }),
    ),
    consumer = f.install(
      manifest('test.dependent', { consumes: [{ capability: 'test.base@1', optional: false }] }),
    );
  take(await f.manager.enable(base));
  take(f.manager.select(consumer, 'test.base@1', { ...base, providerId: 'main' }));
  take(await f.manager.enable(consumer));
  expect(f.manager.contributions()).toHaveLength(5);
  take(await f.manager.disable(base));
  expect(f.manager.get(consumer)!.state).toBe('unready');
  expect(f.manager.contributions()).toEqual([]);
  take(await f.manager.enable(base));
  expect(f.manager.get(consumer)!.state).toBe('active');
  expect(f.manager.contributions()).toHaveLength(5);
});
