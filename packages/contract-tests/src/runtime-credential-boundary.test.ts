import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  CordisRuntimeDriver,
  PluginManager,
  TaskSupervisor,
  ConfigService,
  MemoryConfigStore,
  createRuntimeHostPort,
  createPermissionKernel,
  CredentialBroker,
  MemoryCiphertextStore,
  credentialPermissionAuthorizer,
} from '@pet/host-kernel';
import type { OwnerRef, PluginManifest, Result, TaskContext } from '@pet/contracts';
const get = <T>(value: Result<T>): T => {
  if (!value.ok) throw new Error(value.error.code);
  return value.value;
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const fixture = 'PUBLIC_HOST_BOUNDARY_FIXTURE';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup() {
  const driver = new CordisRuntimeDriver(async () => ({ activate() {} }));
  const manager = new PluginManager({
    driver,
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async () => true,
    readiness: async () => null,
  });
  const tasks = new TaskSupervisor(manager);
  const configs = new ConfigService(new MemoryConfigStore(), (owner) => manager.isLive(owner));
  const digest = 'd'.repeat(64);
  const approval = vi.fn(
    async (p: {
      requestId: string;
      owner: OwnerRef;
      taskId: string;
      permissionDigest: string;
    }) => ({
      requestId: p.requestId,
      owner: p.owner,
      taskId: p.taskId,
      permissionDigest: p.permissionDigest,
      approved: true,
    }),
  );
  const kernel = createPermissionKernel({
    host: {
      fingerprint: () => digest,
      describe: (owner) => {
        const value = manager.get(owner);
        return value && value.owner.generation === owner.generation
          ? { manifest: value.manifest, digest }
          : null;
      },
      isLive: (owner) => manager.isLive(owner),
      ownerSignal: (owner) => manager.signal(owner),
      taskSignal: (taskId, owner) => tasks.taskSignal(taskId, owner),
    },
    approval: { request: approval },
  });
  const decrypt = vi.fn(async (bytes: Uint8Array) => ({
    plaintext: Buffer.from(bytes).toString('utf8'),
    shouldReEncrypt: false,
  }));
  const broker = new CredentialBroker({
    cipher: { encrypt: async (text) => Buffer.from(text), decrypt },
    store: new MemoryCiphertextStore(),
    authorize: credentialPermissionAuthorizer(kernel.service),
  });
  const owners: OwnerRef[] = [];
  for (const id of ['test.boundary-a', 'test.boundary-b']) {
    const manifest: PluginManifest = {
      schemaVersion: 1,
      id,
      version: '1.0.0',
      displayName: { 'zh-CN': '测试' },
      description: { 'zh-CN': '宿主任务边界合成夹具' },
      license: 'MIT',
      host: '^1.0.0',
      platforms: ['win32-x64'],
      entries: { runtime: 'index.mjs' },
      permissions: [{ kind: 'credentials', keys: ['key'] }],
    };
    get(
      manager.install(manifest, {
        directory: path.resolve('.fixture-not-imported'),
        origin: 'user',
      }),
    );
    const identity = { pluginId: id, instanceId: 'default' };
    get(configs.register(identity, manifest));
    get(await configs.initialize(identity));
    kernel.control.confirmTrust(identity, digest, true);
    owners.push(get(await manager.enable(identity)).owner);
  }
  await broker.setSecret(owners[0]!, 'key', fixture);
  const port = createRuntimeHostPort({
    manager,
    tasks,
    configs,
    permissions: kernel.service,
    credentials: broker,
  });
  const held = async () => {
    const entered = deferred<TaskContext>(),
      gate = deferred<void>();
    const task = get(
      tasks.run(owners[0]!, async (ctx) => {
        entered.resolve(ctx);
        await gate.promise;
        return null;
      }),
    );
    return {
      task,
      context: await entered.promise,
      release: async () => {
        gate.resolve();
        await task.result;
        await task.settled;
      },
    };
  };
  cleanup.push(async () => {
    tasks.shutdown();
    broker.dispose();
    kernel.service.close();
    configs.close();
    await manager.shutdown();
    await driver.dispose();
  });
  return { port, held, owners, approval, decrypt, manager, kernel };
}
it('denies invented tasks before approval and decrypt', async () => {
  const f = await setup(),
    operation = vi.fn(async () => ({ ok: true as const, value: null }));
  expect(
    await f.port.useCredential!(
      f.owners[0]!,
      'invented',
      'key',
      new AbortController().signal,
      operation,
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(f.approval).not.toHaveBeenCalled();
  expect(f.decrypt).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
});
it('denies an unrelated live owner and wrong generation for a real task', async () => {
  const f = await setup(),
    held = await f.held(),
    operation = vi.fn(async () => ({ ok: true as const, value: null }));
  try {
    for (const owner of [f.owners[1]!, { ...f.owners[0]!, generation: 99 }])
      expect(
        await f.port.useCredential!(
          owner,
          held.context.taskId,
          'key',
          new AbortController().signal,
          operation,
        ),
      ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(f.approval).not.toHaveBeenCalled();
    expect(f.decrypt).not.toHaveBeenCalled();
  } finally {
    await held.release();
  }
});
it('does not revive credential authority for a completed task', async () => {
  const f = await setup(),
    held = await f.held();
  await held.release();
  expect(
    await f.port.useCredential!(
      f.owners[0]!,
      held.context.taskId,
      'key',
      new AbortController().signal,
      async () => ({ ok: true, value: null }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(f.decrypt).not.toHaveBeenCalled();
});
it('rechecks a pre-aborted RPC scope before decrypt or approval', async () => {
  const f = await setup(),
    held = await f.held(),
    scope = new AbortController();
  try {
    scope.abort();
    expect(
      await f.port.useCredential!(
        f.owners[0]!,
        held.context.taskId,
        'key',
        scope.signal,
        async () => ({ ok: true, value: null }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(f.approval).not.toHaveBeenCalled();
    expect(f.decrypt).not.toHaveBeenCalled();
  } finally {
    await held.release();
  }
});
it('allows two valid uses with two new approvals but exposes no credential management port', async () => {
  const f = await setup(),
    held = await f.held(),
    seen: string[] = [];
  try {
    for (let i = 0; i < 2; i++)
      expect(
        await f.port.useCredential!(
          f.owners[0]!,
          held.context.taskId,
          'key',
          new AbortController().signal,
          async (secret) => {
            seen.push(secret);
            return { ok: true, value: null };
          },
        ),
      ).toEqual({ ok: true, value: null });
    expect(seen).toEqual([fixture, fixture]);
    expect(f.approval).toHaveBeenCalledTimes(2);
    expect(f.decrypt).toHaveBeenCalledTimes(2);
    for (const method of ['setSecret', 'deleteSecret', 'repairSecret', 'confirmTrust'])
      expect(Object.keys(f.port)).not.toContain(method);
    expect(JSON.stringify(f.kernel.control.snapshotAudit())).not.toContain(fixture);
  } finally {
    await held.release();
  }
});
it('does not deliver a decrypt already in flight after the owner is disabled', async () => {
  const f = await setup(),
    held = await f.held(),
    entered = deferred<void>(),
    gate = deferred<void>();
  const operation = vi.fn(async () => ({ ok: true as const, value: null }));
  f.decrypt.mockImplementationOnce(async (bytes) => {
    entered.resolve();
    await gate.promise;
    return { plaintext: Buffer.from(bytes).toString('utf8'), shouldReEncrypt: false };
  });
  const using = f.port.useCredential!(
    f.owners[0]!,
    held.context.taskId,
    'key',
    new AbortController().signal,
    operation,
  );
  try {
    await entered.promise;
    get(await f.manager.disable(f.owners[0]!));
    expect((await using).ok).toBe(false);
    expect(operation).not.toHaveBeenCalled();
  } finally {
    gate.resolve();
    await using;
    await held.release();
  }
});
it('issues a new generation client after restart and does not accept the old task', async () => {
  const f = await setup(),
    old = f.owners[0]!,
    held = await f.held();
  expect(
    await f.port.useCredential!(
      old,
      held.context.taskId,
      'key',
      new AbortController().signal,
      async () => ({ ok: true, value: null }),
    ),
  ).toEqual({ ok: true, value: null });
  get(await f.manager.disable(old));
  await held.release();
  const fresh = get(await f.manager.enable(old)).owner;
  expect(fresh.generation).toBeGreaterThan(old.generation);
  f.owners[0] = fresh;
  expect(
    await f.port.useCredential!(
      fresh,
      held.context.taskId,
      'key',
      new AbortController().signal,
      async () => ({ ok: true, value: null }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  const next = await f.held();
  try {
    expect(
      await f.port.useCredential!(
        fresh,
        next.context.taskId,
        'key',
        new AbortController().signal,
        async (secret) => {
          expect(secret).toBe(fixture);
          return { ok: true, value: null };
        },
      ),
    ).toEqual({ ok: true, value: null });
    expect(f.approval).toHaveBeenCalledTimes(2);
  } finally {
    await next.release();
  }
});
