import { expect, it, vi } from 'vitest';
import type { PluginManifest } from '@pet/contracts';
import { createPermissionKernel, type ApprovalPrompt } from './kernel.js';
import { PermissionAudit, type AuditEntry } from './audit.js';
const owner = { pluginId: 'test.review', instanceId: 'default', generation: 1 },
  id = { pluginId: owner.pluginId, instanceId: owner.instanceId },
  digest = 'e'.repeat(64);
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
  permissions: [{ kind: 'microphone' }],
};
const scope = new AbortController(),
  task = new AbortController();
const host = {
  fingerprint: () => digest,
  describe: () => ({ manifest, digest }),
  isLive: () => true,
  ownerSignal: () => scope.signal,
  taskSignal: () => task.signal,
};
const answer = (p: ApprovalPrompt) => ({
  requestId: p.requestId,
  owner: p.owner,
  taskId: p.taskId,
  permissionDigest: p.permissionDigest,
  approved: true,
});
it('rejects an approval past its monotonic deadline even before its timer runs', async () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const kernel = createPermissionKernel({
      host,
      approvalTimeoutMs: 100,
      approval: {
        request: async (p) => {
          now = 101;
          return answer(p);
        },
      },
    });
    kernel.control.confirmTrust(id, digest, true);
    const operation = vi.fn(async () => true);
    expect(
      await kernel.service.run(owner, 'task', { kind: 'microphone' }, operation),
    ).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(operation).not.toHaveBeenCalled();
    kernel.service.close();
  } finally {
    clock.mockRestore();
  }
});
it('reports unavailable when audit cannot record operation start', async () => {
  class BrokenAudit extends PermissionAudit {
    override append(entry: AuditEntry): void {
      if (entry.event === 'started') throw new Error('private');
      super.append(entry);
    }
  }
  const kernel = createPermissionKernel({ host, audit: new BrokenAudit() });
  kernel.control.confirmTrust(id, digest, true);
  kernel.control.setPreset(id, 'local');
  const operation = vi.fn(async () => true);
  expect(await kernel.service.run(owner, 'task', { kind: 'microphone' }, operation)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
  expect(operation).not.toHaveBeenCalled();
  kernel.service.close();
});
it('does not claim success if the lease-close audit fails', async () => {
  class BrokenAudit extends PermissionAudit {
    override append(entry: AuditEntry): void {
      if (entry.event === 'closed') throw new Error('private');
      super.append(entry);
    }
  }
  const kernel = createPermissionKernel({ host, audit: new BrokenAudit() });
  kernel.control.confirmTrust(id, digest, true);
  kernel.control.setPreset(id, 'local');
  expect(
    await kernel.service.run(owner, 'task', { kind: 'microphone' }, async () => 1),
  ).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(kernel.service.diagnostics().leases).toBe(0);
  kernel.service.close();
});
