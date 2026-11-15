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
import { createReadStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { crc32, deflateSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
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
import {
  createMaterialStore,
  type HostMaterialStore,
  type RawInputSource,
  type RawInputCustody,
  type RawInputBytes,
} from './material-store.js';

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

async function rawSource(
  directory: string,
  bytes: Buffer,
  options: {
    hold?: boolean;
    postflight?: boolean;
    cancelledDone?: boolean;
    onJoined?: () => void;
  } = {},
) {
  const target = path.join(directory, `native-${randomUUID()}.bin`);
  await writeFile(target, bytes);
  const reader = createReadStream(target, { highWaterMark: 16384 });
  const local = new AbortController(),
    entered = deferred(),
    release = deferred();
  let checks = 0,
    cancels = 0;
  const native = finished(reader);
  const settled = native.then(() => {
    if (options.postflight) local.abort();
    options.onJoined?.();
  });
  void settled.catch(() => {});
  const source: RawInputSource = {
    signal: local.signal,
    settled,
    check: async () => {
      checks++;
      if (local.signal.aborted) throw new KernelFault('stale-owner');
    },
    cancel: () => {
      cancels++;
      reader.destroy(new KernelFault('cancelled'));
    },
    body: {
      async *[Symbol.asyncIterator]() {
        let first = true;
        try {
          for await (const chunk of reader) {
            yield chunk;
            if (first) {
              first = false;
              entered.resolve();
              if (options.hold) await release.promise;
            }
            if (options.cancelledDone) reader.destroy(new KernelFault('cancelled'));
          }
        } catch (error) {
          if (!options.cancelledDone) throw error;
        }
      },
    },
  };
  cleanups.push(async () => {
    release.resolve();
    source.cancel();
    await Promise.allSettled([native]);
  });
  return { source, local, entered, release, counts: () => ({ checks, cancels }), native };
}
async function serverActor(
  host: CompanionPluginHost,
  access: RuntimeInputAccess,
): Promise<RuntimeInputAccess> {
  const entered = deferred();
  let taskSignal: AbortSignal | undefined;
  const task = host.runFor(COMPANION_HOST_ID, async (context) => {
    taskSignal = context.signal;
    entered.resolve();
    await new Promise<void>((resolve) =>
      context.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    return null;
  });
  cleanups.push(async () => {
    task.cancel();
    await task.settled;
  });
  await entered.promise;
  if (!taskSignal) throw new Error('Missing actual server task');
  return {
    scope: access.scope,
    check: access.check,
    signal: AbortSignal.any([access.signal, taskSignal]),
  };
}
const rawExpectation = (bytes: Buffer) => ({
  expectedSizeBytes: bytes.length,
  expectedSha256: createHash('sha256').update(bytes).digest('hex'),
});
async function collectRaw(
  _info: RawInputBytes,
  stream: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
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

it('retains two verified raw parts after local postflight loss without publishing premature ready materials', async () => {
  const f = await fixture(),
    a = f.admission();
  const actor = await serverActor(f.host, a.access);
  const encodedVoice = Buffer.from([2, 35, 33, 83, 73, 76, 75, 95, 86, 51, 0, 255, 0, 1]);
  const binary = Buffer.from([0, 255, 0, 254, 10, 13, 128]);
  const sources = [
    await rawSource(f.directory, encodedVoice),
    await rawSource(f.directory, binary),
  ];
  const state = vi.spyOn(f.port, 'state');
  const firstSource = sources[0],
    secondSource = sources[1];
  if (!firstSource || !secondSource) throw new Error('Missing native reader');
  const first = await f.store.stageRawInput(
    rawExpectation(encodedVoice),
    firstSource.source,
    actor,
  );
  const second = await f.store.stageRawInput(rawExpectation(binary), secondSource.source, actor);
  await Promise.all(sources.map((source) => source.native));
  sources.forEach((source) => source.local.abort());
  const checks = sources.map((source) => source.counts().checks);
  expect(await f.store.withRawInput(first, collectRaw)).toEqual(encodedVoice);
  expect(await f.store.withRawInput(second, collectRaw)).toEqual(binary);
  expect(sources.map((source) => source.counts().checks)).toEqual(checks);
  expect(state).not.toHaveBeenCalled();
  expect(await readdir(path.join(f.data, 'materials/objects'))).toEqual([]);
  expect(() => JSON.stringify(first)).toThrow(KernelFault);
  const fake = Object.assign({}, first) as RawInputCustody;
  const consumer = vi.fn(collectRaw);
  await expect(f.store.withRawInput(fake, consumer)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(consumer).not.toHaveBeenCalled();
  await f.store.releaseRawInput(first);
  await f.store.releaseRawInput(first);
  await f.store.releaseRawInput(second);
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
});

it('commits verified raw custody despite source-only postflight withdrawal after actual native join', async () => {
  const f = await fixture(),
    a = f.admission(),
    bytes = Buffer.from('positive native completion');
  const native = await rawSource(f.directory, bytes, { postflight: true });
  const cancel = native.source.cancel;
  native.source.cancel = () => {
    cancel();
    if (native.counts().cancels === 1) throw new KernelFault('stale-owner');
  };
  const custody = await f.store.stageRawInput(rawExpectation(bytes), native.source, a.access);
  expect(native.local.signal.aborted).toBe(true);
  expect(native.counts().cancels).toBeGreaterThan(0);
  await native.native;
  const checks = native.counts().checks;
  expect(await f.store.withRawInput(custody, collectRaw)).toEqual(bytes);
  expect(native.counts().checks).toBe(checks);
  await f.store.releaseRawInput(custody);
});

it('does not mint raw custody when the original server actor is withdrawn at native join', async () => {
  const f = await fixture(),
    a = f.admission(),
    bytes = Buffer.from('native bytes are not an actor grant');
  const native = await rawSource(f.directory, bytes, { onJoined: a.revoke });
  await expect(
    f.store.stageRawInput(rawExpectation(bytes), native.source, a.access),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  expect(await readdir(path.join(f.data, 'materials/objects'))).toEqual([]);
});

it('does not commit partial raw bytes on local disconnect and close joins the actual native reader', async () => {
  const f = await fixture(),
    a = f.admission(),
    bytes = Buffer.alloc(96 * 1024, 7);
  const native = await rawSource(f.directory, bytes, { hold: true });
  let custody: RawInputCustody | undefined;
  const work = f.store.stageRawInput(rawExpectation(bytes), native.source, a.access).then(
    (value) => {
      custody = value;
      return null;
    },
    (error: unknown) => error,
  );
  await native.entered.promise;
  native.local.abort();
  let closed = false;
  const closing = f.store.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  expect(custody).toBeUndefined();
  native.release.resolve();
  expect(await work).not.toBe(null);
  await closing;
  expect(custody).toBeUndefined();
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('rejects cancelled done as EOF when the actual native reader did not complete', async () => {
  const f = await fixture(),
    a = f.admission();
  const native = await rawSource(f.directory, Buffer.alloc(96 * 1024, 7), { cancelledDone: true });
  await expect(
    f.store.stageRawInput(
      { expectedSizeBytes: null, expectedSha256: null },
      native.source,
      a.access,
    ),
  ).rejects.toBeDefined();
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  expect(await readdir(path.join(f.data, 'materials/objects'))).toEqual([]);
});

it.each(['hash', 'size'] as const)(
  'requires actual raw %s equality before minting custody',
  async (mismatch) => {
    const f = await fixture(),
      a = f.admission(),
      bytes = Buffer.from('complete native bytes');
    const native = await rawSource(f.directory, bytes);
    await expect(
      f.store.stageRawInput(
        {
          expectedSizeBytes: bytes.length + (mismatch === 'size' ? 1 : 0),
          expectedSha256:
            mismatch === 'hash' ? '0'.repeat(64) : rawExpectation(bytes).expectedSha256,
        },
        native.source,
        a.access,
      ),
    ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
    expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  },
);

it('keeps the original server actor after raw custody and joins release after revocation', async () => {
  const f = await fixture(),
    a = f.admission(),
    bytes = Buffer.alloc(96 * 1024, 7);
  const native = await rawSource(f.directory, bytes);
  const custody = await f.store.stageRawInput(rawExpectation(bytes), native.source, a.access);
  native.local.abort();
  const entered = deferred(),
    release = deferred();
  const reading = f.store
    .withRawInput(custody, async (_info, chunks, signal) => {
      for await (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        entered.resolve();
        await release.promise;
        signal.throwIfAborted();
      }
    })
    .then(
      () => null,
      (error: unknown) => error,
    );
  await entered.promise;
  a.revoke();
  a.abort.abort();
  let disposed = false;
  const disposing = f.store.releaseRawInput(custody).then(() => {
    disposed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(disposed).toBe(false);
  release.resolve();
  expect(await reading).not.toBe(null);
  await disposing;
  await expect(f.store.withRawInput(custody, collectRaw)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
});

it('verifies raw disk bytes before delivering a consumer buffer', async () => {
  const f = await fixture(),
    a = f.admission(),
    bytes = Buffer.from('raw content');
  const native = await rawSource(f.directory, bytes),
    custody = await f.store.stageRawInput(rawExpectation(bytes), native.source, a.access);
  const entries = await readdir(path.join(f.data, 'materials/staging'));
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  if (!entry || !/^[a-f0-9-]+\.raw$/u.test(entry)) throw new Error('Unexpected raw object');
  await writeFile(path.join(f.data, 'materials/staging', entry), 'bad content');
  const consume = vi.fn(collectRaw);
  await expect(f.store.withRawInput(custody, consume)).rejects.toMatchObject({
    error: { code: 'invalid-input' },
  });
  expect(consume).not.toHaveBeenCalled();
  await f.store.releaseRawInput(custody);
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
});

it('drains a supplied native reader even when the host file grant refuses staging', async () => {
  const f = await fixture(),
    a = f.admission(),
    bytes = Buffer.from('no host write');
  const native = await rawSource(f.directory, bytes);
  f.host.permissionControl.setPreset(
    { pluginId: COMPANION_HOST_ID, instanceId: 'default' },
    'deny',
  );
  await expect(
    f.store.stageRawInput(rawExpectation(bytes), native.source, a.access),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(native.counts().cancels).toBeGreaterThan(0);
  await Promise.allSettled([native.native]);
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('allows two whole raw consumers to commit canonical bytes without borrowing extra preparation slots', async () => {
  const f = await fixture(),
    a = f.admission(),
    b = f.admission('bob'),
    bytes = Buffer.from('owned input bytes');
  const one = await rawSource(f.directory, bytes),
    two = await rawSource(f.directory, bytes);
  const first = await f.store.stageRawInput(rawExpectation(bytes), one.source, a.access),
    second = await f.store.stageRawInput(rawExpectation(bytes), two.source, b.access);
  const gate = deferred();
  let entered = 0;
  const process = (handle: RawInputCustody, actor: RuntimeInputAccess, inputId: string) =>
    f.store.withRawInput(handle, async (_info, raw, signal) => {
      entered++;
      if (entered === 2) gate.resolve();
      await gate.promise;
      return f.store.put({ inputId, kind: 'file', name: 'input.bin' }, raw, {
        scope: actor.scope,
        signal,
        check: actor.check,
      });
    });
  const results = await Promise.all([
    process(first, a.access, a.input.id),
    process(second, b.access, b.input.id),
  ]);
  expect(results.map((result) => result.sha256)).toEqual([
    rawExpectation(bytes).expectedSha256,
    rawExpectation(bytes).expectedSha256,
  ]);
  await f.store.releaseRawInput(first);
  await f.store.releaseRawInput(second);
});

it('bounds retained raw handles and store close removes only its owned raw files', async () => {
  const f = await fixture(),
    a = f.admission(),
    bytes = Buffer.alloc(0),
    handles: RawInputCustody[] = [];
  for (let index = 0; index < 8; index++) {
    const native = await rawSource(f.directory, bytes);
    handles.push(await f.store.stageRawInput(rawExpectation(bytes), native.source, a.access));
  }
  const extra = await rawSource(f.directory, bytes);
  await expect(
    f.store.stageRawInput(rawExpectation(bytes), extra.source, a.access),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  extra.source.cancel();
  await Promise.allSettled([extra.source.settled]);
  const first = handles.shift();
  if (!first) throw new Error('Missing custody');
  await f.store.releaseRawInput(first);
  const next = await rawSource(f.directory, bytes);
  await f.store.stageRawInput(rawExpectation(bytes), next.source, a.access);
  const canary = path.join(f.data, 'materials/staging', 'unowned-canary');
  await writeFile(canary, 'keep');
  await f.store.close();
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual(['unowned-canary']);
  expect(await readFile(canary, 'utf8')).toBe('keep');
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
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
