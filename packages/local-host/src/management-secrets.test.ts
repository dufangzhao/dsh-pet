import { mkdtemp, readFile, realpath, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { SecretRedactor, SensitivePeer, KernelFault } from '@pet/host-kernel';
import { validateManifest } from '@pet/contracts/validation';
import { createLocalPluginKernel } from './kernel.js';
import { randomUUID } from 'node:crypto';
import { LocalQQSourceController } from './qq-source.js';
import {
  startLocalManagement,
  attachLocalManagement,
  type LocalManagementConsole,
} from './management.js';
import { LOCAL_HOST_PROTOCOL_VERSION, type LocalHostConsoleView } from '@pet/contracts';
import { ManagementSecretSession } from './management-secrets.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function kernelFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'local-management-secret-')),
    original = await lstat(root),
    absolute = await realpath(root);
  cleanup.push(async () => {
    const current = await lstat(absolute);
    expect(await realpath(absolute)).toBe(absolute);
    expect(current.dev).toBe(original.dev);
    expect(current.ino).toBe(original.ino);
    expect(current.uid).toBe(original.uid);
    expect(path.dirname(absolute)).toBe(await realpath(tmpdir()));
    await rm(absolute, { recursive: true });
  });
  const resolve = createRequire(import.meta.url).resolve;
  const source = async (name: string) => {
    const directory = await realpath(path.resolve(path.dirname(resolve(name)), '..'));
    const manifest = validateManifest(
      JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8')) as unknown,
    );
    if (!manifest.ok) throw new Error('Invalid source');
    return { directory, manifest: manifest.value, preset: 'deny' as const };
  };
  const kernel = await createLocalPluginKernel({
    dataDirectory: root,
    official: {
      ...(await source('@pet/qq-official')),
      portsFor() {
        throw new KernelFault('not-ready');
      },
    },
    onebot: {
      ...(await source('@pet/qq-onebot')),
      portsFor() {
        throw new KernelFault('not-ready');
      },
    },
  });
  cleanup.push(() => kernel.close());
  return kernel;
}
it('uses a real inert management task while QQ is disabled and registers redaction before provider use', async () => {
  const kernel = await kernelFixture(),
    redactor = new SecretRedactor();
  const receiver: ManagementSecretSession = new ManagementSecretSession({
    runManagement: (work, options) => kernel.runManagement(work, options),
    redactor,
    write: async (frame) => sender.receive(frame),
  });
  const sender: SensitivePeer = new SensitivePeer({
    write: async (frame) => receiver.receive(frame),
  });
  cleanup.push(async () => {
    sender.close();
    await receiver.close();
  });
  const key = 'synthetic-private-management-key-123';
  let called = 0;
  const prepared = await receiver.prepare(async (secret) => {
    expect(redactor.contains(secret)).toBe(true);
    called++;
    return { available: true };
  });
  if (!prepared.ok) throw new Error('No management task');
  expect(prepared.value.reference.owner.pluginId).toBe('pet.local-qq-control');
  expect(
    kernel.host
      .views()
      .filter((view) => view.id.startsWith('pet.qq-'))
      .every((view) => view.state === 'disabled'),
  ).toBe(true);
  expect(await sender.send(prepared.value.reference, key, new AbortController().signal)).toEqual({
    ok: true,
    value: null,
  });
  expect(await receiver.finish(prepared.value.reference.streamId)).toEqual({
    ok: true,
    value: { available: true },
  });
  expect(called).toBe(1);
});
it('rejects unregistered streams or forged owner/task without spending the registered slot', async () => {
  const kernel = await kernelFixture(),
    redactor = new SecretRedactor();
  const receiver: ManagementSecretSession = new ManagementSecretSession({
    runManagement: (work, options) => kernel.runManagement(work, options),
    redactor,
    write: async (frame) => sender.receive(frame),
  });
  const sender: SensitivePeer = new SensitivePeer({
    write: async (frame) => receiver.receive(frame),
  });
  cleanup.push(async () => {
    sender.close();
    await receiver.close();
  });
  let called = 0;
  const prepared = await receiver.prepare(async () => {
    called++;
    return null;
  });
  if (!prepared.ok) throw new Error('No task');
  const reference = prepared.value.reference;
  for (const changed of [
    { streamId: 'unknown' },
    { taskId: 'other' },
    { owner: { ...reference.owner, pluginId: 'pet.qq-official' } },
  ]) {
    const payload = Buffer.from('synthetic-forged-key');
    expect(
      receiver.receive({
        header: { ...reference, ...changed, sequence: 0, byteLength: payload.length },
        payload,
      }).ok,
    ).toBe(false);
    expect(called).toBe(0);
  }
  expect(
    await sender.send(reference, 'synthetic-correct-key', new AbortController().signal),
  ).toEqual({ ok: true, value: null });
  expect(await receiver.finish(reference.streamId)).toEqual({ ok: true, value: null });
  expect(called).toBe(1);
});
it('GUI close cancels and joins actual in-progress work but does not clear committed key facts or root redaction', async () => {
  const kernel = await kernelFixture(),
    redactor = new SecretRedactor();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = () => {};
  const entry = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let committed = '';
  const receiver: ManagementSecretSession = new ManagementSecretSession({
    runManagement: (work, options) => kernel.runManagement(work, options),
    redactor,
    write: async (frame) => sender.receive(frame),
  });
  const sender: SensitivePeer = new SensitivePeer({
    write: async (frame) => receiver.receive(frame),
  });
  cleanup.push(async () => {
    release();
    sender.close();
    await receiver.close();
  });
  const prepared = await receiver.prepare(async (secret) => {
    committed = secret;
    entered();
    await gate;
    return { available: true };
  });
  if (!prepared.ok) throw new Error('No task');
  const sending = sender.send(
    prepared.value.reference,
    'synthetic-known-committed-key',
    new AbortController().signal,
  );
  await entry;
  let closed = false;
  const closing = receiver.close().then(() => {
    closed = true;
  });
  sender.close();
  await sending;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  expect(kernel.host.tasks.diagnostics().pendingWork).toBeGreaterThan(0);
  release();
  await closing;
  expect(committed).toBe('synthetic-known-committed-key');
  expect(redactor.contains(committed)).toBe(true);
  expect(kernel.host.tasks.diagnostics().pendingWork).toBe(0);
});
it('carries key bytes only on the authenticated sensitive frame kind into the real disabled source setter', async () => {
  const kernel = await kernelFixture();
  const sources = new LocalQQSourceController(kernel, {
    onOfficial: async () => {},
    onOneBot: async () => {},
  });
  await sources.initialize();
  cleanup.push(() => sources.close());
  const identity = {
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    packageVersion: '0.1.0',
    hostId: randomUUID(),
    bootId: randomUUID(),
  };
  const redactor = new SecretRedactor();
  const view = async (): Promise<LocalHostConsoleView> => {
    const source = await sources.view();
    return {
      identity,
      sourcesRevision: source.revision,
      sources: [...source.sources],
      agentLink: {
        revision: 0,
        target: { baseUrl: '', agentId: '', agentEpoch: '' },
        credentialVersion: 'unit-disabled-agent',
        hasCredential: false,
        phase: 'disabled',
        sessionId: null,
        error: null,
      },
    };
  };
  const refused = async (): Promise<never> => {
    throw new KernelFault('not-ready');
  };
  const backend: LocalManagementConsole = {
    runManagement: (work, options) => kernel.runManagement(work, options),
    redactor,
    view,
    review: refused,
    trust: refused,
    preset: refused,
    sourceSettings: refused,
    sourceEnabled: refused,
    agentSettings: refused,
    agentEnabled: refused,
    clearCredential: refused,
    prepareSecret: async (input) => {
      if (input.purpose !== 'qq-source') throw new KernelFault('not-ready');
      const current = (await sources.view()).sources.find(
        (source) => source.protocol === input.protocol,
      );
      if (
        !current ||
        current.configRevision !== input.expectedRevision ||
        current.credential.version !== input.expectedCredentialVersion
      )
        throw new KernelFault('conflict');
      return async (value, signal) => {
        const mutation = await sources.credential(
          {
            protocol: input.protocol,
            expectedRevision: input.expectedRevision,
            expectedCredentialVersion: input.expectedCredentialVersion,
            value,
          },
          signal,
        );
        return { view: await view(), error: mutation.error };
      };
    },
  };
  const capability = 'a'.repeat(64);
  const server = await startLocalManagement({
    identity,
    capability,
    console: backend,
    kernel: { status: async () => ({}), close: () => kernel.close() },
    onStopped: () => {},
  });
  cleanup.push(() => server.close());
  const record = {
    ...identity,
    format: 1 as const,
    endpoint: server.endpoint,
    managementCapability: capability,
  };
  const client = await attachLocalManagement(record);
  cleanup.push(() => client.close());
  expect(Object.isFrozen(client.identity)).toBe(true);
  expect(client.identity).toEqual(identity);
  expect(client.signal.aborted).toBe(false);
  let changed = () => {};
  const notified = new Promise<void>((resolve) => {
    changed = resolve;
  });
  client.onChanged(changed);
  server.changed();
  await notified;
  const before = (await sources.view()).sources.find((source) => source.protocol === 'official');
  if (!before || before.credential.version === null)
    throw new Error('Missing actual source key slot');
  const target = {
    hostId: identity.hostId,
    bootId: identity.bootId,
    purpose: 'qq-source' as const,
    protocol: 'official' as const,
    expectedRevision: before.configRevision,
    expectedCredentialVersion: before.credential.version,
  };
  const key = 'synthetic-network-secret-real-source-123';
  const committed = await client.setCredential(target, key);
  expect(committed).toMatchObject({ ok: true, value: { error: null } });
  expect(redactor.contains(key)).toBe(true);
  expect(
    await client.setCredential(target, 'synthetic-stale-slot-must-not-dispatch'),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(redactor.contains('synthetic-stale-slot-must-not-dispatch')).toBe(false);
  await client.close();
  expect(client.signal.aborted).toBe(true);
  const next = await attachLocalManagement(record);
  cleanup.push(() => next.close());
  const current = await next.view({ hostId: identity.hostId, bootId: identity.bootId });
  if (!current.ok) throw new Error('Lost captured host');
  expect(
    current.value.sources.find((source) => source.protocol === 'official')?.credential.available,
  ).toBe(true);
});
