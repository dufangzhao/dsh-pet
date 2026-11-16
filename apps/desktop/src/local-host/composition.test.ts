import { mkdtemp, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { QQAgentLink } from '@pet/local-host';
import { attachLocalManagement } from '../../../../packages/local-host/src/management.js';
import { openPrivateDirectory } from '../../../../packages/local-host/src/rendezvous.js';
import { createProductionLocalHost } from './composition.js';
import { startLocalHostDaemon } from './daemon.js';

const cleanup: Array<() => Promise<void>> = [];
/** Each Windows ACL/identity check starts PowerShell and compiles its native helper (~0.9s). */
const nativeTimeout = process.platform === 'win32' ? 120_000 : 5_000;
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'local-host-production-')),
    root = await realpath(temporary),
    identity = await lstat(root);
  cleanup.push(async () => {
    const now = await lstat(root);
    expect(await realpath(root)).toBe(root);
    expect(now.dev).toBe(identity.dev);
    expect(now.ino).toBe(identity.ino);
    expect(now.uid).toBe(identity.uid);
    expect(path.dirname(root)).toBe(await realpath(tmpdir()));
    await rm(root, { recursive: true });
  });
  // Production always opens the role profile through openPrivateDirectory; a bare mkdtemp
  // directory only satisfies that contract on POSIX, where mkdtemp already creates 0700.
  const profile = await openPrivateDirectory(path.join(root, 'profile'));
  const composition = createProductionLocalHost({
    dataDirectory: path.join(profile.path, 'plugin-data'),
  });
  const daemon = await startLocalHostDaemon({
    directory: path.join(profile.path, 'management'),
    packageVersion: '0.0.0',
    ...composition,
    onStopped: () => {},
  });
  cleanup.push(() => daemon.close());
  const client = await attachLocalManagement(daemon.rendezvous);
  cleanup.push(() => client.close());
  const target = { hostId: client.identity.hostId, bootId: client.identity.bootId };
  return { client, daemon, target };
}
it(
  'composes actual QQ sources AgentLink execution and management without granting source trust or starting another Core',
  async () => {
    const { client, daemon, target } = await fixture();
    const view = await client.view(target);
    if (!view.ok) throw new Error('No production view');
    expect(view.value.sources).toHaveLength(2);
    expect(view.value.agentLink.phase).toBe('disabled');
    for (const protocol of ['official', 'onebot-v11', 'agent-link'] as const) {
      const review = await client.reviewSource({ ...target, protocol });
      expect(review).toMatchObject({
        ok: true,
        value: { protocol, trusted: false, preset: 'deny' },
      });
    }
    const source = view.value.sources.find((value) => value.protocol === 'official');
    if (!source || !source.credential.version) throw new Error('Missing source slot');
    const committed = await client.setCredential(
      {
        ...target,
        purpose: 'qq-source',
        protocol: 'official',
        expectedRevision: source.configRevision,
        expectedCredentialVersion: source.credential.version,
      },
      'synthetic-production-source-key-123',
    );
    expect(committed).toMatchObject({ ok: true, value: { error: null } });
    await client.close();
    expect(client.signal.aborted).toBe(true);
    const second = await attachLocalManagement(daemon.rendezvous);
    cleanup.push(() => second.close());
    const still = await second.view(target);
    if (!still.ok) throw new Error('Daemon was not independent');
    expect(
      still.value.sources.find((value) => value.protocol === 'official')?.credential.available,
    ).toBe(true);
    expect((await second.stop()).ok).toBe(true);
  },
  nativeTimeout,
);
it(
  'returns the Agent target commit receipt even when another writer changes target and key version before the facade resumes',
  async () => {
    const { client, target } = await fixture();
    const first = await client.view(target);
    if (!first.ok) throw new Error('No view');
    const original = QQAgentLink.prototype.saveTarget;
    vi.spyOn(QQAgentLink.prototype, 'saveTarget').mockImplementation(async function (
      this: QQAgentLink,
      input: unknown,
    ) {
      const committed = await original.call(this, input);
      await original.call(this, {
        expectedRevision: committed.revision,
        baseUrl: 'http://127.0.0.1:19992',
        agentId: 'different-agent',
        agentEpoch: 'different-epoch',
      });
      return committed;
    });
    const result = await client.saveAgentSettings({
      ...target,
      expectedRevision: first.value.agentLink.revision,
      baseUrl: 'http://127.0.0.1:19991',
      agentId: 'captured-agent',
      agentEpoch: 'captured-epoch',
    });
    if (!result.ok) throw new Error('Target commit was lost');
    expect(result.value.view.agentLink.revision).toBe(first.value.agentLink.revision + 1);
    expect(result.value.view.agentLink.target).toEqual({
      baseUrl: 'http://127.0.0.1:19991',
      agentId: 'captured-agent',
      agentEpoch: 'captured-epoch',
    });
    const current = await client.view(target);
    if (!current.ok) throw new Error('No live view');
    expect(current.value.agentLink.target.agentId).toBe('different-agent');
    expect(current.value.agentLink.credentialVersion).not.toBe(
      result.value.view.agentLink.credentialVersion,
    );
  },
  nativeTimeout,
);
it(
  'sets an Agent key while its plugin is disabled and a same-target no-op preserves the captured slot',
  async () => {
    const { client, target } = await fixture();
    const initial = await client.view(target);
    if (!initial.ok) throw new Error('No view');
    const saved = await client.saveAgentSettings({
      ...target,
      expectedRevision: initial.value.agentLink.revision,
      baseUrl: 'http://127.0.0.1:19993',
      agentId: 'agent-captured',
      agentEpoch: 'epoch-captured',
    });
    if (!saved.ok) throw new Error('No target receipt');
    const source = saved.value.view.agentLink;
    const keyed = await client.setCredential(
      {
        ...target,
        purpose: 'agent-link',
        expectedRevision: source.revision,
        expectedCredentialVersion: source.credentialVersion,
      },
      'synthetic-production-agent-token-0123456789',
    );
    if (!keyed.ok) throw new Error('No key receipt');
    expect(keyed.value.view.agentLink.hasCredential).toBe(true);
    expect(keyed.value.view.agentLink.phase).toBe('offline');
    const noOp = await client.saveAgentSettings({
      ...target,
      expectedRevision: source.revision,
      ...source.target,
    });
    if (!noOp.ok) throw new Error('No no-op receipt');
    expect(noOp.value.view.agentLink.revision).toBe(source.revision);
    expect(noOp.value.view.agentLink.credentialVersion).toBe(
      keyed.value.view.agentLink.credentialVersion,
    );
    expect(noOp.value.view.agentLink.hasCredential).toBe(true);
    expect(
      await client.setAgentEnabled({
        ...target,
        expectedRevision: source.revision,
        expectedCredentialVersion: source.credentialVersion,
        enabled: false,
      }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const cleared = await client.clearCredential({
      ...target,
      purpose: 'agent-link',
      expectedRevision: source.revision,
      expectedCredentialVersion: keyed.value.view.agentLink.credentialVersion,
    });
    expect(cleared).toMatchObject({
      ok: true,
      value: { error: null, view: { agentLink: { hasCredential: false } } },
    });
  },
  nativeTimeout,
);
