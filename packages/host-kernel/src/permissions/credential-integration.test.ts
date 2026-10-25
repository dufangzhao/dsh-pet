import { expect, it, vi } from 'vitest';
import type { PluginManifest } from '@pet/contracts';
import { createPermissionKernel } from './kernel.js';
import { credentialPermissionAuthorizer } from './adapters.js';
import { CredentialBroker } from '../credentials/credential-broker.js';
import { MemoryCiphertextStore } from '../credentials/ciphertext-store.js';
const owner = { pluginId: 'test.credentials', instanceId: 'default', generation: 1 };
const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId };
const digest = 'c'.repeat(64);
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
  permissions: [{ kind: 'credentials', keys: ['key'] }],
};
it('revoking a real permission lease prevents pending decryption delivery', async () => {
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      started = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const scope = new AbortController(),
    task = new AbortController();
  const kernel = createPermissionKernel({
    host: {
      fingerprint: () => digest,
      describe: () => ({ manifest, digest }),
      isLive: () => true,
      ownerSignal: () => scope.signal,
      taskSignal: () => task.signal,
    },
    approval: {
      request: async (p) => ({
        requestId: p.requestId,
        owner: p.owner,
        taskId: p.taskId,
        permissionDigest: p.permissionDigest,
        approved: true,
      }),
    },
  });
  kernel.control.confirmTrust(identity, digest, true);
  // Public reversible fixture only; this test is not a cryptographic compatibility probe.
  const broker = new CredentialBroker({
    store: new MemoryCiphertextStore(),
    cipher: {
      encrypt: async (text) => Buffer.from(text, 'utf8'),
      decrypt: async (bytes) => {
        started();
        await gate;
        return { plaintext: Buffer.from(bytes).toString('utf8'), shouldReEncrypt: false };
      },
    },
    authorize: credentialPermissionAuthorizer(kernel.service),
  });
  await broker.setSecret(identity, 'key', 'PUBLIC_SYNTHETIC_FIXTURE');
  const client = broker.issueClient(owner, ['key']),
    operation = vi.fn(async () => true);
  const pending = client.withSecret('key', { taskId: 'task', signal: task.signal }, operation);
  await entered;
  kernel.control.revoke(identity);
  await expect(pending).rejects.toMatchObject({ code: 'permission-denied' });
  release();
  expect(operation).not.toHaveBeenCalled();
  expect(JSON.stringify(kernel.control.snapshotAudit())).not.toContain('PUBLIC_SYNTHETIC_FIXTURE');
  kernel.service.close();
  broker.dispose();
});
