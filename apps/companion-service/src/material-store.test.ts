import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  realpath,
  rename,
  unlink,
  symlink,
  link,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { crc32, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { CompanionInputOrigin, CompanionMaterialRef, Result } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { SqliteState, type StateMethodInputs, type StateMethodOutputs } from '@pet/state-sqlite';
import {
  CompanionPluginHost,
  companionHostManifest,
  companionHostDefinition,
  COMPANION_HOST_ID,
  type CompanionRuntime,
  type RuntimeInputAccess,
} from '@pet/companion-runtime';
import { createMaterialStore, type HostMaterialStore } from './material-store.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new KernelFault(result.error.code);
  return result.value;
}
function origin(id: string, person = 'alice'): CompanionInputOrigin {
  if (person === 'owner')
    return {
      kind: 'owner',
      inputId: id,
      principalId: 'owner',
      audience: { kind: 'owner-private' },
      route: { kind: 'owner-private' },
      policyRevision: null,
    };
  const account = {
    protocol: 'official' as const,
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default' as const,
    accountId: 'test',
  };
  return {
    kind: 'qq',
    inputId: id,
    principalId: person,
    audience: { kind: 'person-private', principalId: person },
    route: {
      kind: 'qq',
      account,
      scene: 'private',
      targetId: person,
      reference: {
        eventId: null,
        messageId: `message-${id}`,
        occurredAt: 1000,
        displayReference: null,
      },
    },
    actor: { account, scene: 'private', senderId: person },
    eventKey: `event-${id}`,
    messageId: `message-${id}`,
    trigger: 'direct',
    quote: null,
    policyRevision: 1,
  };
}
async function* stream(bytes: Uint8Array) {
  for (let at = 0; at < bytes.length; at += 16384) yield bytes.subarray(at, at + 16384);
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function png(): Buffer {
  const chunk = (kind: string, data: Buffer) => {
    const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length);
    output.write(kind, 4);
    data.copy(output, 8);
    output.writeUInt32BE(crc32(output.subarray(4, data.length + 8)), data.length + 8);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'material-store-test-'));
  const plugin = path.join(directory, 'source');
  await mkdir(plugin);
  await writeFile(path.join(plugin, 'plugin.json'), JSON.stringify(companionHostManifest));
  const stateRoot = path.join(directory, 'state');
  await mkdir(stateRoot);
  const sqlite = new SqliteState({ dataDirectory: stateRoot });
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'host'),
    plugins: [
      {
        manifest: companionHostManifest,
        definition: companionHostDefinition,
        directory: plugin,
        enabled: true,
        preset: 'allow',
      },
    ],
  });
  const port: Pick<CompanionRuntime, 'state'> = {
    async state<M extends keyof StateMethodInputs>(
      method: M,
      input: StateMethodInputs[M],
      signal?: AbortSignal,
    ): Promise<StateMethodOutputs[M]> {
      signal?.throwIfAborted();
      return value(sqlite.invoke(method, input));
    },
  };
  const data = path.join(directory, 'data');
  await mkdir(data);
  const stores: { current?: HostMaterialStore } = {};
  cleanups.push(async () => {
    const closes = await Promise.allSettled([stores.current?.close()]);
    await host.close();
    sqlite.close();
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('material-store-test-') ||
      (await realpath(directory)) !== directory
    )
      throw new Error('Unexpected test root');
    await rm(directory, { recursive: true });
    const failed = closes.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  });
  const store = await createMaterialStore({ directory: data, host, state: port });
  stores.current = store;
  let number = 0;
  function admission(person = 'alice', materials: string[] = []) {
    const o = origin(`input-${++number}`, person);
    const admitted = value(
      sqlite.createInput({
        id: o.inputId ?? '',
        commandId: `cmd-${number}`,
        origin: o,
        evidence: { originalText: 'synthetic' },
        materialIds: materials,
      }),
    );
    let allowed = true;
    const abort = new AbortController();
    const access: RuntimeInputAccess = {
      scope: { kind: 'conversation', audience: o.audience, principalId: o.principalId },
      signal: abort.signal,
      check: async () => {
        if (!allowed) throw new KernelFault('permission-denied');
      },
    };
    return {
      origin: o,
      input: admitted.admission,
      access,
      abort,
      revoke: () => {
        allowed = false;
      },
    };
  }
  const file = (id: string, access: RuntimeInputAccess): string => {
    const stored = value(sqlite.getMaterial({ id, scope: access.scope }));
    if (!stored.storageKey) throw new Error('No private storage key');
    return path.join(data, 'materials', stored.storageKey);
  };
  const collect = async (_reference: CompanionMaterialRef, source: AsyncIterable<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  return { store, host, sqlite, port, data, directory, admission, file, collect };
}

it('writes opaque files with actual hash/MIME and scoped State metadata; returns no storage path', async () => {
  const f = await fixture(),
    a = f.admission();
  const bytes = Buffer.from('binary material beyond the old text worker envelope'.repeat(1200));
  const ref = await f.store.put(
    { inputId: a.input.id, kind: 'file', name: '../../display-only.bin' },
    stream(bytes),
    a.access,
  );
  expect(ref.sizeBytes).toBe(bytes.length);
  expect(ref.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(ref.mediaType).toBe('application/octet-stream');
  expect(JSON.stringify(ref)).not.toContain('storageKey');
  expect(path.basename(f.file(ref.id, a.access))).toMatch(/^[a-f0-9]{64}\.bin$/);
  expect(await f.store.withMaterial(ref.id, a.access, f.collect)).toEqual(bytes);
  const b = f.admission('bob');
  await expect(f.store.withMaterial(ref.id, b.access, f.collect)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('stores exact full text deterministically, deduplicates it and never reads an owner document stub', async () => {
  const f = await fixture(),
    a = f.admission('owner');
  const text = ' 完整正文🌳\r\n'.repeat(1800);
  const input = { id: 'formal-output', text, origin: a.origin };
  const ref = await f.store.storeFullText(input, a.access);
  expect(await f.store.storeFullText(input, a.access)).toEqual(ref);
  expect(await readdir(path.join(f.data, 'materials/objects'))).toHaveLength(1);
  await expect(
    f.store.storeFullText({ ...input, text: text + 'changed' }, a.access),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  expect(await f.store.withMaterial(ref.id, a.access, f.collect)).toEqual(Buffer.from(text));
  const message = value(
    f.sqlite.appendMessage({
      id: 'formal',
      role: 'assistant',
      text: 'explicit document stub',
      audience: a.origin.audience,
      inputId: a.input.id,
      origins: [a.origin],
      materials: [ref],
      content: { kind: 'text-document', material: ref },
    }),
  );
  expect(await f.store.resolvePetCanonicalText(message, new AbortController().signal)).toBe(text);
  await expect(
    f.store.resolvePetCanonicalText(
      { ...message, audience: { kind: 'person-private', principalId: 'alice' } },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await expect(
    f.store.resolvePetCanonicalText(
      {
        ...message,
        content: { kind: 'text-document', material: { ...ref, sha256: '0'.repeat(64) } },
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  await expect(
    f.store.storeFullText({ ...input, id: 'too-large', text: 'x'.repeat(65537) }, a.access),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
});

it('resolves actual checked PNG bytes to native input_image and rejects MIME/corruption/foreign admission', async () => {
  const f = await fixture(),
    a = f.admission('alice', ['image-one']);
  const bytes = png();
  const ref = await f.store.put(
    {
      id: 'image-one',
      inputId: a.input.id,
      kind: 'image',
      name: 'not-a-real-suffix.txt',
      mediaType: 'image/png',
    },
    stream(bytes),
    a.access,
  );
  const committed = value(
    f.sqlite.commitInput({ id: a.input.id, text: 'image', materials: [ref] }),
  );
  const images = await f.store.resolveInput(committed.admission, a.access);
  expect(images).toEqual([
    { type: 'input_image', image_url: `data:image/png;base64,${bytes.toString('base64')}` },
  ]);
  const b = f.admission('bob');
  await expect(f.store.resolveInput(committed.admission, b.access)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  await expect(
    f.store.put(
      { inputId: a.input.id, kind: 'image', name: 'bad.jpg', mediaType: 'image/jpeg' },
      stream(bytes),
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
  const invalid = Buffer.from(bytes);
  invalid[invalid.length - 1] = (invalid[invalid.length - 1] ?? 0) ^ 1;
  await expect(
    f.store.put({ inputId: a.input.id, kind: 'image', name: 'bad.png' }, stream(invalid), a.access),
  ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
});

it.each(['hash', 'symlink', 'hardlink', 'storage-key', 'directory'])(
  'rejects %s substitution before delivering bytes',
  async (kind) => {
    const f = await fixture(),
      a = f.admission();
    const bytes = Buffer.from('verified');
    const ref = await f.store.put(
      { inputId: a.input.id, kind: 'file', name: 'data' },
      stream(bytes),
      a.access,
    );
    const file = f.file(ref.id, a.access);
    if (!file.startsWith(f.data + path.sep)) throw new Error('Unexpected owned object');
    let readId = ref.id;
    if (kind === 'hash') await writeFile(file, Buffer.from('modified'));
    if (kind === 'symlink') {
      await unlink(file);
      const outside = path.join(f.directory, 'private-canary');
      await writeFile(outside, 'private');
      await symlink(outside, file);
    }
    if (kind === 'hardlink') await link(file, path.join(f.directory, 'second-link'));
    if (kind === 'storage-key') {
      readId = 'forged-path';
      const stored = value(f.sqlite.getMaterial({ id: ref.id, scope: a.access.scope }));
      value(f.sqlite.putMaterial({ ...stored, id: readId, reference: { ...ref, id: readId } }));
    }
    if (kind === 'directory') {
      const objects = path.join(f.data, 'materials/objects');
      if (path.dirname(objects) !== path.join(f.data, 'materials'))
        throw new Error('Unexpected move');
      await rename(objects, objects + '-old');
      await mkdir(objects);
    }
    const consume = vi.fn(f.collect);
    await expect(f.store.withMaterial(readId, a.access, consume)).rejects.toBeDefined();
    expect(consume).not.toHaveBeenCalled();
  },
);

it('rechecks a retained access role between chunks and permits independent work access after input retirement', async () => {
  const f = await fixture(),
    a = f.admission('alice', ['work-material']);
  const bytes = Buffer.alloc(128 * 1024, 7);
  const ref = await f.store.put(
    { id: 'work-material', inputId: a.input.id, kind: 'file', name: 'binary' },
    stream(bytes),
    a.access,
  );
  let delivered = 0;
  await expect(
    f.store.withMaterial(ref.id, a.access, async (_ref, data) => {
      for await (const chunk of data) {
        delivered += chunk.length;
        a.revoke();
      }
    }),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(delivered).toBe(64 * 1024);
  const committed = value(f.sqlite.commitInput({ id: a.input.id, text: 'work', materials: [ref] }));
  value(f.sqlite.claimInput({ id: a.input.id }));
  value(f.sqlite.updateInput({ id: a.input.id, phase: 'completed', cleanup: 'settled' }));
  a.abort.abort();
  const workAccess: RuntimeInputAccess = {
    scope: structuredClone(a.access.scope),
    signal: new AbortController().signal,
    check: async () => {},
  };
  expect(await f.store.validateWorkMaterials(committed.admission, workAccess)).toEqual([ref]);
  expect(await f.store.withMaterial(ref.id, workAccess, f.collect)).toEqual(bytes);
});

it('joins real cancelled staging before close and removes only its verified temporary files', async () => {
  const f = await fixture(),
    a = f.admission();
  const entered = deferred(),
    release = deferred();
  const writing = f.store
    .put(
      { inputId: a.input.id, kind: 'file', name: 'cancelled' },
      (async function* () {
        yield Buffer.from('first');
        entered.resolve();
        await release.promise;
      })(),
      a.access,
    )
    .then(
      () => null,
      (error: unknown) => error,
    );
  await entered.promise;
  let closed = false;
  const closing = f.store.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  expect(f.host.tasks.diagnostics().pendingWork).toBeGreaterThan(0);
  release.resolve();
  await writing;
  await closing;
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  expect(await readdir(path.join(f.data, 'materials/objects'))).toEqual([]);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('preserves committed bytes if access is revoked after State commit, and cleans a rejected write', async () => {
  const f = await fixture(),
    a = f.admission();
  const original = f.port.state.bind(f.port);
  const real = vi.spyOn(f.port, 'state').mockImplementation(async (method, input, signal) => {
    const result = await original(method, input, signal);
    if (method === 'putMaterial') {
      a.revoke();
      throw new KernelFault('permission-denied');
    }
    return result;
  });
  await expect(
    f.store.put(
      { id: 'committed', inputId: a.input.id, kind: 'file', name: 'kept' },
      stream(Buffer.from('exact bytes')),
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  real.mockRestore();
  const access: RuntimeInputAccess = { ...a.access, check: async () => {} };
  expect(await f.store.withMaterial('committed', access, f.collect)).toEqual(
    Buffer.from('exact bytes'),
  );
  const fail = vi.spyOn(f.port, 'state').mockImplementation(async (method, input, signal) => {
    if (method === 'putMaterial') throw new KernelFault('conflict');
    return original(method, input, signal);
  });
  await expect(
    f.store.put(
      { id: 'rejected', inputId: a.input.id, kind: 'file', name: 'discarded' },
      stream(Buffer.from('new')),
      access,
    ),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  fail.mockRestore();
  expect(await readdir(path.join(f.data, 'materials/objects'))).toHaveLength(1);
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
});

it('enforces exact full-text/image/file byte boundaries and cleans rejected stages', async () => {
  const f = await fixture(),
    a = f.admission('owner');
  const text = 'x'.repeat(65536);
  const ref = await f.store.storeFullText(
    { id: 'exact-boundary', text, origin: a.origin },
    a.access,
  );
  expect(ref.sizeBytes).toBe(65536);
  await expect(
    f.store.put(
      { inputId: a.input.id, kind: 'image', name: 'large' },
      stream(Buffer.alloc(8 * 1024 * 1024 + 1)),
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  await expect(
    f.store.put(
      { inputId: a.input.id, kind: 'file', name: 'large' },
      (async function* () {
        yield Buffer.alloc(32 * 1024 * 1024);
        yield Buffer.from([1]);
      })(),
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  await expect(
    f.store.put(
      { inputId: a.input.id, kind: 'text', name: 'invalid.txt' },
      stream(Buffer.from([255])),
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  expect(await readdir(path.join(f.data, 'materials/objects'))).toHaveLength(1);
});

it('bounds two actual preparation scopes and closes both only after their input streams retire', async () => {
  const f = await fixture(),
    a = f.admission();
  const entered = [deferred(), deferred()],
    release = deferred();
  const work = entered.map((gate, at) =>
    f.store
      .put(
        { inputId: a.input.id, kind: 'file', name: `pending-${at}` },
        (async function* () {
          yield Buffer.from('x');
          gate.resolve();
          await release.promise;
        })(),
        a.access,
      )
      .then(
        () => null,
        (error: unknown) => error,
      ),
  );
  await Promise.all(entered.map((gate) => gate.promise));
  await expect(
    f.store.put(
      { inputId: a.input.id, kind: 'file', name: 'third' },
      stream(Buffer.from('x')),
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  let closed = false;
  const closing = f.store.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  release.resolve();
  await Promise.all(work);
  await closing;
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('joins a real scoped reader consumer and preserves its canonical bytes on close', async () => {
  const f = await fixture(),
    a = f.admission();
  const ref = await f.store.put(
    { inputId: a.input.id, kind: 'file', name: 'reader' },
    stream(Buffer.from('verified')),
    a.access,
  );
  const entered = deferred(),
    release = deferred();
  const reading = f.store
    .withMaterial(ref.id, a.access, async (_ref, bytes) => {
      for await (const chunk of bytes) {
        expect(chunk.toString()).toBe('verified');
        entered.resolve();
        await release.promise;
      }
    })
    .then(
      () => null,
      (error: unknown) => error,
    );
  await entered.promise;
  let closed = false;
  const closing = f.store.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  release.resolve();
  await reading;
  await closing;
  expect(await readFile(f.file(ref.id, a.access), 'utf8')).toBe('verified');
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('captures write identity before awaits so caller mutation cannot retarget metadata', async () => {
  const f = await fixture(),
    a = f.admission(),
    b = f.admission('bob');
  const request = { inputId: a.input.id, kind: 'file' as const, name: 'original' };
  const writing = f.store.put(request, stream(Buffer.from('original')), a.access);
  request.inputId = b.input.id;
  request.name = 'retargeted';
  const ref = await writing;
  expect(ref.originInputIds).toEqual([a.input.id]);
  expect(ref.name).toBe('original');
});

it('respects actual host file permission denial and leaves existing canonical files intact on close', async () => {
  const f = await fixture(),
    a = f.admission();
  const ref = await f.store.put(
    { inputId: a.input.id, kind: 'file', name: 'persisted' },
    stream(Buffer.from('persist')),
    a.access,
  );
  f.host.permissionControl.setPreset(
    { pluginId: COMPANION_HOST_ID, instanceId: 'default' },
    'deny',
  );
  await expect(f.store.withMaterial(ref.id, a.access, f.collect)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  await f.store.close();
  expect(await readFile(f.file(ref.id, a.access), 'utf8')).toBe('persist');
});
