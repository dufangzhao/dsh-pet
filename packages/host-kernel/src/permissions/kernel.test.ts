import { expect, it, vi } from 'vitest';
import type { PermissionDeclaration, PluginManifest } from '@pet/contracts';
import { createPermissionKernel, type ApprovalChannel, type ApprovalPrompt } from './kernel.js';
const owner = { pluginId: 'test.permission', instanceId: 'default', generation: 1 },
  identity = { pluginId: owner.pluginId, instanceId: owner.instanceId },
  digest = 'a'.repeat(64);
const microphone: PermissionDeclaration = { kind: 'microphone' };
const manifest: PluginManifest = {
  schemaVersion: 1,
  id: owner.pluginId,
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '测试' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'entry.mjs' },
  permissions: [microphone],
};
const decision = (p: ApprovalPrompt) => ({
  requestId: p.requestId,
  owner: p.owner,
  taskId: p.taskId,
  permissionDigest: p.permissionDigest,
  approved: true,
});
function setup(approval?: ApprovalChannel) {
  const scope = new AbortController(),
    task = new AbortController();
  let generation = 1;
  const kernel = createPermissionKernel({
    host: {
      fingerprint: () => digest,
      describe: () => ({ manifest, digest }),
      isLive: (value) => value.generation === generation,
      ownerSignal: () => scope.signal,
      taskSignal: (id, value) =>
        id === 'task' && value.generation === generation ? task.signal : null,
    },
    ...(approval ? { approval } : {}),
  });
  kernel.control.confirmTrust(identity, digest, true);
  return {
    ...kernel,
    scope,
    task,
    restart: () => {
      generation++;
      scope.abort();
    },
  };
}
it('SEC01/10: denies without declaration or an available host approval channel', async () => {
  const f = setup(),
    op = vi.fn(async () => true);
  expect(await f.service.run(owner, 'task', microphone, op)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
  expect(await f.service.run(owner, 'task', { kind: 'screen-capture' }, op)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
  expect(op).not.toHaveBeenCalled();
  expect(f.control.snapshotAudit().entries.some((e) => e.event === 'denied')).toBe(true);
});
it('SEC12: a prior approval does not authorize the next operation', async () => {
  const request = vi.fn(async (p: ApprovalPrompt) => decision(p)),
    f = setup({ request });
  expect((await f.service.run(owner, 'task', microphone, async () => 1)).ok).toBe(true);
  expect((await f.service.run(owner, 'task', microphone, async () => 2)).ok).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0]![0].requestId).not.toBe(request.mock.calls[1]![0].requestId);
});
it('SEC05: revoke cancels an uncooperative operation result promptly', async () => {
  let entered!: () => void, release!: (v: number) => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<number>((r) => {
      release = r;
    });
  const f = setup();
  f.control.setPreset(identity, 'local');
  const running = f.service.run(owner, 'task', microphone, async () => {
    entered();
    return gate;
  });
  await started;
  f.control.revoke(identity);
  expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(await f.service.authorize(owner, 'task', microphone)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
  release(1);
});
it('SEC11: cancels a waiting question and ignores its late approval', async () => {
  let entered!: (p: ApprovalPrompt) => void, release!: (v: ReturnType<typeof decision>) => void;
  const started = new Promise<ApprovalPrompt>((r) => {
      entered = r;
    }),
    gate = new Promise<ReturnType<typeof decision>>((r) => {
      release = r;
    });
  const request = vi.fn(async (p: ApprovalPrompt) => {
      entered(p);
      return gate;
    }),
    f = setup({ request }),
    extra = new AbortController(),
    op = vi.fn(async () => 1);
  const running = f.service.run(owner, 'task', microphone, op, extra.signal);
  const prompt = await started;
  extra.abort();
  expect(await running).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  release(decision(prompt));
  expect(op).not.toHaveBeenCalled();
  expect(f.service.diagnostics().leases).toBe(0);
});
it('SEC09: old-generation leases do not survive stop and restart', async () => {
  const f = setup();
  f.control.setPreset(identity, 'local');
  const approved = await f.service.authorize(owner, 'task', microphone);
  expect(approved.ok).toBe(true);
  if (!approved.ok) return;
  f.restart();
  expect(approved.value.isValid()).toBe(false);
  expect(approved.value.signal.aborted).toBe(true);
  expect(await f.service.authorize(owner, 'task', microphone)).toMatchObject({ ok: false });
});
it('does not expose host controls through service or bound clients', () => {
  const f = setup();
  expect(Object.keys(f.service)).not.toContain('revoke');
  expect(Object.keys(f.service.issueClient(owner))).toEqual(['run']);
});
it('records only metadata, not callback results or exceptions', async () => {
  const f = setup();
  f.control.setPreset(identity, 'local');
  await f.service.run(owner, 'task', microphone, async () => ({ secret: 'private-result' }));
  await f.service.run(owner, 'task', microphone, async () => {
    throw new Error('private-exception');
  });
  const text = JSON.stringify(f.control.snapshotAudit());
  expect(text).not.toContain('private-result');
  expect(text).not.toContain('private-exception');
  expect(text).not.toContain('payload');
});
