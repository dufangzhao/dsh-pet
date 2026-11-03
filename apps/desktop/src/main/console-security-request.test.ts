import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  PluginManager,
  TaskSupervisor,
  CordisRuntimeDriver,
  discoverPlugins,
} from '@pet/host-kernel';
import { createHostPermissions } from './host-permissions.js';
import { ApprovalInbox } from './approval-inbox.js';
import { ConsoleSecurityRequests } from './console-security-request.js';
import { consoleSnapshot } from './console-snapshot.js';
const source = {
  senderId: 7,
  expectedId: 7,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
};
const id = { pluginId: 'test.security', instanceId: 'default' };
const cleanups: Array<() => Promise<void>> = [];
async function setup() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pet-security-'));
  const pkg = path.join(dir, 'package');
  await fs.mkdir(pkg);
  const manifest = {
    schemaVersion: 1,
    id: id.pluginId,
    version: '1.0.0',
    displayName: { en: 'Security' },
    description: { en: 'Security' },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['win32-x64'],
    entries: { runtime: 'index.mjs' },
    permissions: [{ kind: 'microphone' }],
  };
  await fs.writeFile(path.join(pkg, 'plugin.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(pkg, 'index.mjs'), 'export default {activate(){}};');
  const candidate = (await discoverPlugins([{ directory: dir, origin: 'user' }])).plugins[0]!;
  const reference: { manager?: PluginManager; tasks?: TaskSupervisor } = {},
    approvals = new ApprovalInbox(1000);
  const permission = createHostPermissions(reference, approvals, 1000);
  const manager = new PluginManager({
    driver: new CordisRuntimeDriver(async () => ({ activate() {} })),
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async (value) => permission.isTrusted(value.owner),
    readiness: async () => null,
  });
  reference.manager = manager;
  const tasks = new TaskSupervisor(manager);
  reference.tasks = tasks;
  expect(manager.install(candidate.manifest, { directory: pkg, origin: 'user' }).ok).toBe(true);
  permission.register(candidate);
  const host = {
    manager,
    permissionControl: permission.control,
    approvals,
    describeTrust: permission.describeTrust,
    verifyTrust: permission.verifyTrust,
    availableBuiltins: () => [],
    restoreBuiltin: async () => ({
      ok: false as const,
      error: {
        code: 'not-ready' as const,
        messageKey: 'errors.not-ready' as const,
        retryable: false,
      },
    }),
  };
  const snapshot = vi.fn(() =>
    consoleSnapshot(
      {
        version: 1,
        runtime: 'ready',
        installedPlugins: 1,
        activePlugins: manager.list().filter((p) => p.state === 'active').length,
        unreadyPlugins: 0,
        pendingRestartPlugins: 0,
        runningTasks: tasks.diagnostics().activeTasks,
        pendingWork: tasks.diagnostics().pendingWork,
      },
      manager.list(),
      { name: 'Pet', version: '1', electron: '45', node: '24', platform: 'win32-x64' },
      manager.contributions(),
    ),
  );
  const requests = new ConsoleSecurityRequests(host, snapshot);
  cleanups.push(async () => {
    tasks.shutdown();
    permission.service.close();
    approvals.close();
    await manager.shutdown();
    if (!path.basename(dir).startsWith('pet-security-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(dir, { recursive: true, force: true });
  });
  const approve = async () => {
    const entry = requests.read().plugins[0]!;
    return requests.handle(source, 'trust', [
      { owner: entry.owner, expectedDigest: entry.digest, approved: true },
    ]);
  };
  return {
    dir,
    pkg,
    candidate,
    manager,
    tasks,
    permission,
    approvals,
    requests,
    snapshot,
    approve,
    owner: () => manager.get(id)!.owner,
  };
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
it('binds trust to the displayed code fingerprint and exposes the actual preset', async () => {
  const f = await setup(),
    entry = f.requests.read().plugins[0]!;
  expect(entry).toMatchObject({ trusted: false, preset: 'allow', blocked: false });
  expect(entry.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(entry)).not.toContain(f.dir);
  expect(
    await f.requests.handle(source, 'trust', [
      { owner: entry.owner, expectedDigest: '0'.repeat(64), approved: true },
    ]),
  ).toMatchObject({ ok: true, value: { operationError: { code: 'package-changed' } } });
  expect((await f.approve()).ok).toBe(true);
  expect(f.requests.read().plugins[0]!.trusted).toBe(true);
  expect(
    await f.requests.handle(source, 'preset', [{ owner: f.owner(), preset: 'local' }]),
  ).toMatchObject({
    ok: true,
    value: { security: { plugins: [{ preset: 'local' }] }, operationError: null },
  });
});
it('refuses changed code and revokes the old approval without evaluating the changed file', async () => {
  const f = await setup();
  await f.approve();
  await f.manager.enable(id, {});
  await fs.writeFile(path.join(f.pkg, 'index.mjs'), 'throw new Error("PRIVATE_CHANGED_CODE")');
  const result = await f.approve();
  expect(result).toMatchObject({
    ok: true,
    value: {
      operationError: { code: 'package-changed' },
      security: { plugins: [{ trusted: false }] },
      snapshot: { plugins: [{ state: 'disabled' }] },
    },
  });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_CHANGED_CODE');
});
it('allows only a current one-shot approval and records metadata without content', async () => {
  const f = await setup();
  f.permission.control.setPreset(id, 'ask');
  await f.approve();
  await f.manager.enable(id, {});
  const owner = f.owner();
  let ran = 0;
  const pending = f.tasks.run(owner, async (task) => {
    const result = await f.permission.service.run(
      owner,
      task.taskId,
      { kind: 'microphone' },
      async () => {
        ran++;
        return 'done';
      },
    );
    return result.ok ? result.value : result.error.code;
  });
  if (!pending.ok) throw new Error('Task failed');
  await vi.waitFor(() => expect(f.approvals.snapshot()).toHaveLength(1));
  const prompt = f.approvals.snapshot()[0]!;
  expect(
    await f.requests.handle(source, 'approval', [
      {
        requestId: prompt.requestId,
        owner,
        taskId: 'wrong-task',
        permissionDigest: prompt.permissionDigest,
        approved: true,
      },
    ]),
  ).toMatchObject({ ok: true, value: { operationError: { code: 'not-ready' } } });
  expect(ran).toBe(0);
  const decision = {
    requestId: prompt.requestId,
    owner,
    taskId: prompt.taskId,
    permissionDigest: prompt.permissionDigest,
    approved: true,
  };
  expect(await f.requests.handle(source, 'approval', [decision])).toMatchObject({
    ok: true,
    value: { operationError: null },
  });
  expect(await pending.value.result).toEqual({ ok: true, value: 'done' });
  expect(ran).toBe(1);
  expect(await f.requests.handle(source, 'approval', [decision])).toMatchObject({
    ok: true,
    value: { operationError: { code: 'not-ready' } },
  });
  const audit = f.permission.control.snapshotAudit();
  expect(audit.entries.some((row) => row.event === 'approved')).toBe(true);
  expect(audit.entries.some((row) => row.event === 'completed')).toBe(true);
  expect(JSON.stringify(audit)).not.toContain('done');
});
it('revoking trust cancels pending approval and stops the actual owner', async () => {
  const f = await setup();
  f.permission.control.setPreset(id, 'ask');
  await f.approve();
  await f.manager.enable(id, {});
  const owner = f.owner();
  const task = f.tasks.run(owner, async (context) => {
    const result = await f.permission.service.authorize(owner, context.taskId, {
      kind: 'microphone',
    });
    if (result.ok) result.value.close();
    return result.ok;
  });
  if (!task.ok) throw new Error('Task failed');
  await vi.waitFor(() => expect(f.approvals.snapshot()).toHaveLength(1));
  const entry = f.requests.read().plugins[0]!;
  expect(
    await f.requests.handle(source, 'trust', [
      { owner, expectedDigest: entry.digest, approved: false },
    ]),
  ).toMatchObject({
    ok: true,
    value: {
      operationError: null,
      security: { plugins: [{ trusted: false, blocked: true }], pending: [] },
      snapshot: { plugins: [{ state: 'disabled' }] },
    },
  });
  expect((await task.value.result).ok).toBe(false);
});
it('rejects other windows, subframes and malformed input without exposing state', async () => {
  const f = await setup();
  for (const delta of [
    { senderId: 8 },
    { mainFrame: false },
    { frameUrl: source.frameUrl + '#wrong' },
  ])
    expect(await f.requests.handle({ ...source, ...delta }, 'get', [])).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
  for (const [action, args] of [
    ['get', [1]],
    ['audit', [{ offset: -1, limit: 50 }]],
    ['audit', [{ offset: 0, limit: 101 }]],
    ['trust', [{ owner: f.owner(), expectedDigest: 'fake', approved: true }]],
  ] as const)
    expect(await f.requests.handle(source, action, args)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  expect(f.snapshot).not.toHaveBeenCalled();
});
it('defaults a registered user plugin to allow and runs without an approval', async () => {
  const f = await setup();
  await f.approve();
  await f.manager.enable(id, {});
  const owner = f.owner();
  const task = f.tasks.run(owner, async (ctx) => {
    const result = await f.permission.service.run(
      owner,
      ctx.taskId,
      { kind: 'microphone' },
      async () => 42,
    );
    return result.ok ? result.value : result.error.code;
  });
  if (!task.ok) throw new Error('Task failed');
  expect(await task.value.result).toEqual({ ok: true, value: 42 });
  expect(f.approvals.snapshot()).toEqual([]);
  expect(
    f.permission.control
      .snapshotAudit()
      .entries.some((e) => e.event === 'approved' && e.source === 'preset'),
  ).toBe(true);
});
it('keeps a manual policy on source re-registration and defaults a fresh registration', async () => {
  const f = await setup();
  expect(f.permission.control.inspect(id)?.preset).toBe('allow');
  f.permission.control.setPreset(id, 'deny');
  f.permission.register(f.candidate);
  expect(f.permission.control.inspect(id)?.preset).toBe('deny');
  f.permission.forget(id);
  f.permission.register(f.candidate);
  expect(f.permission.control.inspect(id)?.preset).toBe('allow');
});
