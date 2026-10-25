import { afterEach, expect, it } from 'vitest';
import path from 'node:path';
import {
  CordisRuntimeDriver,
  PluginManager,
  TaskSupervisor,
  createPermissionKernel,
  type PermissionService,
} from '@pet/host-kernel';
import type { OwnerRef, PluginManifest, Result } from '@pet/contracts';
const unwrap = <T>(r: Result<T>) => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const manifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest => ({
  schemaVersion: 1,
  id,
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '测试' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'entry.mjs' },
  ...extra,
});
async function setup() {
  const reference: { permissions?: PermissionService } = {};
  let providerOwner: OwnerRef | undefined;
  const driver = new CordisRuntimeDriver(async (activation) =>
    activation.owner.pluginId === 'test.provider'
      ? {
          activate(ctx) {
            providerOwner = ctx.owner;
            ctx.provide('main', {
              capture: async (task) => {
                const result = await reference.permissions!.run(
                  ctx.owner,
                  task.taskId,
                  { kind: 'microphone' },
                  async () => ({ synthetic: true }),
                );
                if (!result.ok) throw new Error('denied');
                return result.value;
              },
            });
          },
        }
      : { activate() {} },
  );
  const manager = new PluginManager({
    driver,
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async () => true,
    readiness: async () => null,
  });
  const tasks = new TaskSupervisor(manager),
    digest = 'b'.repeat(64);
  const kernel = createPermissionKernel({
    host: {
      fingerprint: () => digest,
      describe: (owner) => {
        const snapshot = manager.get(owner);
        return snapshot && snapshot.owner.generation === owner.generation
          ? { manifest: snapshot.manifest, digest }
          : null;
      },
      isLive: (owner) => manager.isLive(owner),
      ownerSignal: (owner) => manager.signal(owner),
      taskSignal: (taskId, owner) => tasks.taskSignal(taskId, owner),
    },
  });
  reference.permissions = kernel.service;
  const directory = path.resolve('.fixture-not-imported');
  for (const m of [
    manifest('test.provider', {
      provides: [{ id: 'main', capability: 'test.capture@1' }],
      permissions: [{ kind: 'microphone' }],
    }),
    manifest('test.consumer', {
      consumes: [{ capability: 'test.capture@1', optional: false }],
      permissions: [{ kind: 'capability-use', capability: 'test.capture@1' }],
    }),
  ]) {
    unwrap(manager.install(m, { directory, origin: 'user' }));
    kernel.control.confirmTrust({ pluginId: m.id, instanceId: 'default' }, digest, true);
    kernel.control.setPreset({ pluginId: m.id, instanceId: 'default' }, 'local');
  }
  unwrap(await manager.enable({ pluginId: 'test.provider', instanceId: 'default' }));
  unwrap(
    manager.select({ pluginId: 'test.consumer', instanceId: 'default' }, 'test.capture@1', {
      pluginId: 'test.provider',
      instanceId: 'default',
      providerId: 'main',
    }),
  );
  const owner = unwrap(
    await manager.enable({ pluginId: 'test.consumer', instanceId: 'default' }),
  ).owner;
  cleanup.push(async () => {
    kernel.service.close();
    tasks.shutdown();
    await manager.shutdown();
    await driver.dispose();
  });
  return { manager, tasks, kernel, owner, provider: providerOwner! };
}
it('allows sensitive provider operations only for a real bound task participant', async () => {
  const f = await setup();
  const task = unwrap(
    f.tasks.invokeCapability(
      f.manager,
      f.owner,
      'test.capture@1',
      'capture',
      null,
      async (request) => {
        const result = await f.kernel.service.authorize(
          request.binding.consumer,
          request.taskId,
          { kind: 'capability-use', capability: request.binding.capability },
          request.signal,
        );
        return result.ok ? result.value : null;
      },
    ),
  );
  expect(await task.result).toEqual({ ok: true, value: { synthetic: true } });
  await task.settled;
  expect(f.tasks.taskSignal(task.taskId, f.provider)).toBeNull();
  expect(f.kernel.service.diagnostics().leases).toBe(0);
});
it('does not accept an unrelated owner or an invented task ID', async () => {
  const f = await setup();
  expect(
    await f.kernel.service.authorize(f.provider, 'invented', { kind: 'microphone' }),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  const task = unwrap(
    f.tasks.run(f.owner, async (context) => {
      expect(f.tasks.taskSignal(context.taskId, f.provider)).toBeNull();
      return (await f.kernel.service.authorize(f.provider, context.taskId, { kind: 'microphone' }))
        .ok;
    }),
  );
  expect(await task.result).toEqual({ ok: true, value: false });
  await task.settled;
});
