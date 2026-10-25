import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  CordisRuntimeDriver,
  PluginManager,
  TaskSupervisor,
  type CapabilityAuthorizer,
  type CapabilityMethod,
} from '@pet/host-kernel';
import type { PluginManifest, Result } from '@pet/contracts';
const unwrap = <T>(r: Result<T>) => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const manifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({
  schemaVersion: 1,
  id,
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '测试' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'index.js' },
  ...extra,
});
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(method: CapabilityMethod) {
  const driver = new CordisRuntimeDriver(async (activation) =>
    activation.owner.pluginId === 'test.provider'
      ? {
          activate(ctx) {
            ctx.provide('main', { run: method });
          },
        }
      : { activate() {} },
  );
  const manager = new PluginManager({
    driver,
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async () => true,
  });
  const directory = path.resolve('.fixture-not-loaded');
  const provider = { pluginId: 'test.provider', instanceId: 'default' },
    consumer = { pluginId: 'test.consumer', instanceId: 'default' };
  unwrap(
    manager.install(
      manifest(provider.pluginId, { provides: [{ id: 'main', capability: 'test.echo@1' }] }),
      { directory, origin: 'user' },
    ),
  );
  unwrap(await manager.enable(provider));
  unwrap(
    manager.install(
      manifest(consumer.pluginId, { consumes: [{ capability: 'test.echo@1', optional: false }] }),
      { directory, origin: 'user' },
    ),
  );
  unwrap(manager.select(consumer, 'test.echo@1', { ...provider, providerId: 'main' }));
  const owner = unwrap(await manager.enable(consumer)).owner;
  const tasks = new TaskSupervisor(manager);
  cleanup.push(async () => {
    tasks.shutdown();
    await manager.shutdown();
    await driver.dispose();
  });
  return { driver, manager, tasks, owner, provider };
}
function lease() {
  const abort = new AbortController();
  const close = vi.fn();
  let allowed = true;
  return {
    authorize: vi.fn(async () => ({ signal: abort.signal, isValid: () => allowed, close })),
    close,
    revoke: () => {
      allowed = false;
      abort.abort();
    },
    invalidate: () => {
      allowed = false;
    },
  };
}
it('defaults to deny capability calls without invoking a provider', async () => {
  const method = vi.fn(async () => null);
  const f = await setup(method);
  const task = unwrap(f.tasks.invokeCapability(f.manager, f.owner, 'test.echo@1', 'run', null));
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  await task.settled;
  expect(method).not.toHaveBeenCalled();
});
it('authorizes exactly once and closes the lease on final completion', async () => {
  const f = await setup(async (_ctx, input) => input);
  const auth = lease();
  const task = unwrap(
    f.tasks.invokeCapability(
      f.manager,
      f.owner,
      'test.echo@1',
      'run',
      { value: 1 },
      auth.authorize,
    ),
  );
  expect(await task.result).toEqual({ ok: true, value: { value: 1 } });
  await task.settled;
  expect(auth.authorize).toHaveBeenCalledTimes(1);
  expect(auth.close).toHaveBeenCalledTimes(1);
});
it('cancels visible output immediately when a granted lease is revoked', async () => {
  const entered = deferred<void>(),
    gate = deferred<null>();
  const f = await setup(async () => {
    entered.resolve();
    return gate.promise;
  });
  const auth = lease();
  const task = unwrap(
    f.tasks.invokeCapability(f.manager, f.owner, 'test.echo@1', 'run', null, auth.authorize),
  );
  await entered.promise;
  auth.revoke();
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(auth.close).toHaveBeenCalledTimes(1);
  gate.resolve(null);
  await task.settled;
});
it('discards output if the lease is invalidated inside the provider', async () => {
  const auth = lease();
  const f = await setup(async () => {
    auth.invalidate();
    return 'late';
  });
  const task = unwrap(
    f.tasks.invokeCapability(f.manager, f.owner, 'test.echo@1', 'run', null, auth.authorize),
  );
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  await task.settled;
});
it('closes a late approval without starting the provider after cancellation', async () => {
  const method = vi.fn(async () => null),
    pending = deferred<Awaited<ReturnType<CapabilityAuthorizer>>>(),
    started = deferred<void>(),
    closed = deferred<void>();
  const f = await setup(method);
  const close = vi.fn(() => closed.resolve());
  const task = unwrap(
    f.tasks.invokeCapability(f.manager, f.owner, 'test.echo@1', 'run', null, async () => {
      started.resolve();
      return pending.promise;
    }),
  );
  await started.promise;
  task.cancel();
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  pending.resolve({ isValid: () => true, close });
  await closed.promise;
  await task.settled;
  expect(close).toHaveBeenCalledTimes(1);
  expect(method).not.toHaveBeenCalled();
});
it('cancels an in-flight binding when its provider is stopped', async () => {
  const entered = deferred<void>(),
    gate = deferred<null>();
  const f = await setup(async () => {
    entered.resolve();
    return gate.promise;
  });
  const auth = lease();
  const task = unwrap(
    f.tasks.invokeCapability(f.manager, f.owner, 'test.echo@1', 'run', null, auth.authorize),
  );
  await entered.promise;
  await f.manager.disable(f.provider);
  expect(await task.result).toMatchObject({ ok: false });
  gate.resolve(null);
  await task.settled;
  expect(auth.close).toHaveBeenCalledTimes(1);
});
it('reports a granted lease cleanup failure instead of claiming a clean completion', async () => {
  const f = await setup(async () => true);
  const task = unwrap(
    f.tasks.invokeCapability(f.manager, f.owner, 'test.echo@1', 'run', null, async () => ({
      isValid: () => true,
      close: () => {
        throw new Error('private-cleanup-detail');
      },
    })),
  );
  expect(await task.result).toMatchObject({ ok: false, error: { code: 'internal' } });
  await task.settled;
  expect(task.snapshot().cleanupFailed).toBe(true);
  expect(f.tasks.diagnostics().cleanupFailures).toBe(1);
  expect(JSON.stringify(await task.result)).not.toContain('private-cleanup-detail');
});
