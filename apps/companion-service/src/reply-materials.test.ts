import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  link,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import type {
  CompanionInputOrigin,
  CompanionMaterialRef,
  PluginManifest,
  Result,
} from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import {
  SqliteState,
  type StateMethodInputs,
  type StateMethodOutputs,
  type StoredArtifact,
} from '@pet/state-sqlite';
import {
  CompanionPluginHost,
  companionHostDefinition,
  companionHostManifest,
  type CompanionRuntime,
  type RuntimeInputAccess,
} from '@pet/companion-runtime';
import { createMaterialStore } from './material-store.js';
import { createReplyMaterialResolver } from './reply-materials.js';

const provider = 'pet.reply-fixture';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new KernelFault(result.error.code);
  return result.value;
}
function origin(id: string, person: string, group?: string): CompanionInputOrigin {
  const account = {
    protocol: 'official' as const,
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default' as const,
    accountId: 'synthetic',
  };
  return {
    kind: 'qq',
    inputId: id,
    principalId: person,
    audience: group
      ? { kind: 'qq-group', account, groupId: group }
      : { kind: 'person-private', principalId: person },
    route: {
      kind: 'qq',
      account,
      scene: group ? 'group' : 'private',
      targetId: group ?? person,
      reference: {
        eventId: null,
        messageId: `message-${id}`,
        occurredAt: 1000,
        displayReference: null,
      },
    },
    actor: group
      ? { account, scene: 'group', groupId: group, senderId: person }
      : { account, scene: 'private', senderId: person },
    eventKey: `event-${id}`,
    messageId: `message-${id}`,
    trigger: 'direct',
    quote: null,
    policyRevision: 1,
  };
}
function png(): Buffer {
  const chunk = (kind: string, data: Buffer): Buffer => {
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
  const directory = await mkdtemp(path.join(tmpdir(), 'reply-material-test-'));
  const source: PluginManifest = {
    schemaVersion: 1,
    id: provider,
    version: '0.1.0',
    host: '^1.0.0',
    license: 'MIT',
    displayName: { en: 'Fixture artifacts' },
    description: { en: 'No external operations' },
    platforms: ['linux-x64'],
    entries: { runtime: 'index.mjs' },
    permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read' }],
  };
  const registrations = await Promise.all(
    [companionHostManifest, source].map(async (manifest) => {
      const location = path.join(directory, manifest.id);
      await mkdir(location);
      await writeFile(path.join(location, 'plugin.json'), JSON.stringify(manifest));
      return {
        manifest,
        directory: location,
        enabled: true,
        preset: 'allow' as const,
        definition:
          manifest.id === provider ? definePlugin({ activate() {} }) : companionHostDefinition,
      };
    }),
  );
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'host'),
    plugins: registrations,
  });
  const stateRoot = path.join(directory, 'state');
  await mkdir(stateRoot);
  const sqlite = new SqliteState({ dataDirectory: stateRoot });
  const runtime: Pick<CompanionRuntime, 'state'> = {
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
  const materials = await createMaterialStore({ directory: data, host, state: runtime });
  const root = path.join(directory, 'host', 'plugin-data', provider, 'jobs');
  await mkdir(root, { recursive: true });
  const options = { host, runtime, materials, artifactRoots: new Map([[provider, root]]) };
  const resolve = createReplyMaterialResolver(options);
  cleanups.push(async () => {
    await materials.close();
    await host.close();
    sqlite.close();
    if (
      (await realpath(directory)) !== directory ||
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('reply-material-test-')
    )
      throw new Error('unexpected fixture root');
    await rm(directory, { recursive: true });
  });
  let counter = 0;
  function admission(person = 'alice', group?: string) {
    const captured = origin(`input-${++counter}`, person, group);
    value(
      sqlite.createInput({
        id: captured.inputId ?? '',
        commandId: `command-${counter}`,
        origin: captured,
        evidence: {},
        materialIds: [],
      }),
    );
    const controller = new AbortController();
    let allowed = true;
    const access: RuntimeInputAccess = {
      scope: {
        kind: 'conversation',
        audience: captured.audience,
        principalId: captured.principalId,
      },
      signal: controller.signal,
      check: async () => {
        if (!allowed) throw new KernelFault('permission-denied');
      },
    };
    return {
      origin: captured,
      access,
      controller,
      revoke: () => {
        allowed = false;
      },
    };
  }
  async function artifact(
    a: ReturnType<typeof admission>,
    bytes: Buffer = Buffer.from('real retained output'),
    mediaType = 'application/octet-stream',
    name = 'output.bin',
  ) {
    const accepted = value(
      sqlite.createTask({
        commandId: `work-${++counter}`,
        title: 'Fixture completed work',
        code: 'fixture()',
        executionId: `execution-${counter}`,
        origin: {
          inputId: a.origin.inputId,
          principalId: a.origin.principalId ?? '',
          audience: a.origin.audience,
          route: a.origin.route,
          origins: [a.origin],
          materialIds: [],
        },
      }),
    );
    const record: StoredArtifact = {
      id: `artifact-${counter}`,
      taskId: accepted.task.id,
      name,
      mediaType,
      sizeBytes: bytes.length,
      provider,
      relativePath: `${randomUUID()}/artifacts/${name}`,
    };
    const target = path.join(root, record.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    value(
      sqlite.updateTask({
        taskId: accepted.task.id,
        status: 'completed',
        exitCode: 0,
        artifacts: [record],
      }),
    );
    return { record, target, bytes };
  }
  const collect = async (
    _ref: CompanionMaterialRef,
    stream: AsyncIterable<Uint8Array>,
  ): Promise<Buffer> => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  return {
    ...options,
    options,
    directory,
    data,
    root,
    sqlite,
    resolve,
    admission,
    artifact,
    collect,
  };
}

it('copies a scoped completed artifact into canonical material with deterministic ID/hash and no overwrite', async () => {
  const f = await fixture(),
    a = f.admission(),
    artifact = await f.artifact(a);
  const selection = { kind: 'artifact' as const, id: artifact.record.id };
  const first = await f.resolve(selection, a.origin, a.access);
  expect(first).toMatchObject({
    kind: 'file',
    mediaType: 'application/octet-stream',
    sizeBytes: artifact.bytes.length,
    sha256: createHash('sha256').update(artifact.bytes).digest('hex'),
    originInputIds: [a.origin.inputId],
  });
  expect(await f.materials.withMaterial(first.id, a.access, f.collect)).toEqual(artifact.bytes);
  expect(await f.resolve(selection, a.origin, a.access)).toEqual(first);
  expect(await readdir(path.join(f.data, 'materials/objects'))).toHaveLength(1);
  await writeFile(artifact.target, Buffer.alloc(artifact.bytes.length, 0x7a));
  await expect(f.resolve(selection, a.origin, a.access)).rejects.toMatchObject({
    error: { code: 'conflict' },
  });
  expect(await f.materials.withMaterial(first.id, a.access, f.collect)).toEqual(artifact.bytes);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('validates image bytes and MIME; ordinary audio remains a file, never fabricated voice', async () => {
  const f = await fixture(),
    a = f.admission();
  const image = await f.artifact(a, png(), 'image/png', 'picture.bin');
  expect(
    await f.resolve({ kind: 'artifact', id: image.record.id }, a.origin, a.access),
  ).toMatchObject({ kind: 'image', mediaType: 'image/png' });
  const audio = await f.artifact(
    a,
    Buffer.from('arbitrary audio file bytes'),
    'audio/wav',
    'sound.wav',
  );
  expect(
    await f.resolve({ kind: 'artifact', id: audio.record.id }, a.origin, a.access),
  ).toMatchObject({ kind: 'file', mediaType: 'application/octet-stream', durationMs: null });
  for (const [bytes, type] of [
    [Buffer.from('not an image'), 'image/png'],
    [png(), 'image/jpeg'],
  ] as const) {
    const bad = await f.artifact(a, bytes, type);
    await expect(
      f.resolve({ kind: 'artifact', id: bad.record.id }, a.origin, a.access),
    ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
  }
  expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
});

it('refuses canonical voice material without importing, casting or changing the source', async () => {
  const f = await fixture(),
    source = f.admission(),
    reply = f.admission();
  const wav = Buffer.alloc(60);
  wav.write('RIFF');
  wav.writeUInt32LE(52, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(16, 40);
  const reference = await f.materials.put(
    {
      inputId: source.origin.inputId ?? '',
      kind: 'voice',
      name: 'voice.wav',
      mediaType: 'audio/wav',
      durationMs: 1,
    },
    (async function* () {
      yield wav;
    })(),
    source.access,
  );
  const before = await readdir(path.join(f.data, 'materials/objects'));
  const put = vi.spyOn(f.materials, 'put');
  await expect(
    f.resolve({ kind: 'material', id: reference.id }, reply.origin, reply.access),
  ).rejects.toMatchObject({ error: { code: 'unavailable' } });
  expect(put).not.toHaveBeenCalled();
  expect(await readdir(path.join(f.data, 'materials/objects'))).toEqual(before);
  expect(
    value(f.sqlite.getMaterial({ id: reference.id, scope: source.access.scope })).reference,
  ).toEqual(reference);
  expect(await f.materials.withMaterial(reference.id, source.access, f.collect)).toEqual(wav);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('ready material selection derives only current reply provenance and verifies source scope/bytes', async () => {
  const f = await fixture(),
    a = f.admission(),
    item = await f.artifact(a);
  const ref = await f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, a.access);
  const reply = f.admission();
  const derived = await f.resolve({ kind: 'material', id: ref.id }, reply.origin, reply.access);
  expect(derived.id).not.toBe(ref.id);
  expect(derived).toMatchObject({
    originInputIds: [reply.origin.inputId],
    sha256: ref.sha256,
    sizeBytes: ref.sizeBytes,
  });
  expect(await f.resolve({ kind: 'material', id: ref.id }, reply.origin, reply.access)).toEqual(
    derived,
  );
  expect(value(f.sqlite.getMaterial({ id: ref.id, scope: a.access.scope })).reference).toEqual(ref);
  expect(await f.materials.withMaterial(derived.id, reply.access, f.collect)).toEqual(item.bytes);
  expect(
    value(
      f.sqlite.appendMessage({
        id: 'reply-with-derived-material',
        role: 'assistant',
        text: 'Attached result',
        audience: reply.origin.audience,
        origins: [reply.origin],
        materials: [derived],
        inputId: reply.origin.inputId,
      }),
    ).materials,
  ).toEqual([derived]);
  const b = f.admission('bob');
  await expect(
    f.resolve({ kind: 'material', id: ref.id }, b.origin, b.access),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  const stored = value(f.sqlite.getMaterial({ id: ref.id, scope: a.access.scope }));
  if (!stored.storageKey) throw new Error('missing material');
  await writeFile(
    path.join(f.data, 'materials', stored.storageKey),
    Buffer.alloc(ref.sizeBytes, 0x31),
  );
  await expect(
    f.resolve({ kind: 'material', id: ref.id }, a.origin, a.access),
  ).rejects.toMatchObject({ error: { code: 'invalid-input' } });
});

it('denies other private users, same-group other actors, other groups, forged origin and management scope', async () => {
  const f = await fixture();
  for (const group of [undefined, 'group-a']) {
    const a = f.admission('alice', group),
      item = await f.artifact(a),
      b = f.admission('bob', group);
    await expect(
      f.resolve({ kind: 'artifact', id: item.record.id }, b.origin, b.access),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
    const elsewhere = f.admission('alice', 'group-b');
    await expect(
      f.resolve({ kind: 'artifact', id: item.record.id }, elsewhere.origin, elsewhere.access),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
    await expect(
      f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, {
        ...a.access,
        scope: { kind: 'management' },
      }),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
    await expect(
      f.resolve(
        { kind: 'artifact', id: item.record.id },
        { ...a.origin, policyRevision: 77 },
        a.access,
      ),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  }
});

it('rejects cross-task work-result selections and unknown selector fields', async () => {
  const f = await fixture(),
    a = f.admission(),
    item = await f.artifact(a);
  const o: CompanionInputOrigin = {
    kind: 'work-result',
    inputId: 'result-input',
    principalId: 'alice',
    audience: a.origin.audience,
    route: a.origin.route,
    taskId: 'different-task',
    initiatingInputId: a.origin.inputId,
    policyRevision: 1,
  };
  value(
    f.sqlite.createInput({
      id: o.inputId,
      commandId: 'work-result',
      origin: o,
      evidence: {},
      materialIds: [],
    }),
  );
  await expect(
    f.resolve({ kind: 'artifact', id: item.record.id }, o, a.access),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await expect(
    f.resolve(
      { kind: 'artifact', id: item.record.id, path: '/etc/passwd' } as never,
      a.origin,
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
});

it('refuses unsafe retained paths, inconsistent names/tasks and incomplete execution evidence', async () => {
  const f = await fixture(),
    a = f.admission(),
    item = await f.artifact(a);
  const base = f.runtime.state.bind(f.runtime);
  for (const patch of [
    { relativePath: '../outside' },
    { relativePath: item.record.relativePath.replace('/artifacts/', '/work/') },
    { name: 'different.bin' },
    { taskId: 'missing-task' },
  ]) {
    const state = vi.spyOn(f.runtime, 'state').mockImplementation(async (method, input, signal) => {
      const result = await base(method, input, signal);
      return method === 'getArtifact' ? ({ ...item.record, ...patch } as never) : result;
    });
    await expect(
      f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, a.access),
    ).rejects.toBeDefined();
    state.mockRestore();
  }
  for (const patch of [
    { status: 'running' },
    { status: 'unknown' },
    { exitCode: 1 },
    { exitCode: null },
  ]) {
    const state = vi.spyOn(f.runtime, 'state').mockImplementation(async (method, input, signal) => {
      const result = await base(method, input, signal);
      return method === 'getTask' ? ({ ...result, ...patch } as never) : result;
    });
    await expect(
      f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, a.access),
    ).rejects.toMatchObject({ error: { code: 'not-ready' } });
    state.mockRestore();
  }
});

it('reuses the owned-file policy to reject leaf symlinks, hardlinks, symlink ancestors and size changes', async () => {
  const f = await fixture(),
    a = f.admission();
  for (const mode of ['symlink', 'hardlink', 'ancestor', 'size']) {
    const item = await f.artifact(
      a,
      Buffer.from('protected'),
      'application/octet-stream',
      mode === 'ancestor' ? 'nested/file.bin' : 'output.bin',
    );
    if (mode === 'size') await writeFile(item.target, 'changed-size');
    else if (mode === 'ancestor') {
      const linkAt = path.dirname(item.target);
      if (
        !linkAt.startsWith(f.root + path.sep) ||
        (await realpath(linkAt)) !== linkAt ||
        path.dirname(linkAt) !== path.join(path.dirname(path.dirname(linkAt)), 'artifacts')
      )
        throw new Error('unexpected retained parent');
      await rm(linkAt, { recursive: true });
      await symlink(f.directory, linkAt);
    } else {
      const outside = path.join(f.directory, `${mode}.bin`);
      await writeFile(outside, item.bytes);
      if (
        !item.target.startsWith(f.root + path.sep) ||
        (await realpath(item.target)) !== item.target
      )
        throw new Error('unexpected file');
      await unlink(item.target);
      if (mode === 'symlink') await symlink(outside, item.target);
      else await link(outside, item.target);
    }
    await expect(
      f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, a.access),
    ).rejects.toBeDefined();
  }
});

it('requires active source file permission and rejects a pre-cancelled access before copying', async () => {
  const f = await fixture(),
    a = f.admission(),
    item = await f.artifact(a);
  expect(
    f.host.permissionControl.setPreset({ pluginId: provider, instanceId: 'default' }, 'deny'),
  ).toBe(true);
  await expect(
    f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, a.access),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  a.controller.abort();
  await expect(
    f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, a.access),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(await readdir(path.join(f.data, 'materials/objects'))).toEqual([]);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it.each(['cancel', 'revoke', 'retire'] as const)(
  'joins real source/store work and closes files after %s during streaming',
  async (mode) => {
    const f = await fixture(),
      a = f.admission(),
      item = await f.artifact(a, Buffer.alloc(200_000, 0x8a));
    const put = f.materials.put.bind(f.materials);
    let crossed = false;
    let retirement: Promise<unknown> | undefined;
    vi.spyOn(f.materials, 'put').mockImplementation((request, bytes, access) =>
      put(
        request,
        (async function* () {
          for await (const chunk of bytes) {
            yield chunk;
            if (!crossed) {
              crossed = true;
              if (mode === 'cancel') a.controller.abort();
              else if (mode === 'revoke') a.revoke();
              else
                retirement = f.host.manager.disable({ pluginId: provider, instanceId: 'default' });
            }
          }
        })(),
        access,
      ),
    );
    await expect(
      f.resolve({ kind: 'artifact', id: item.record.id }, a.origin, a.access),
    ).rejects.toBeDefined();
    await retirement;
    expect(crossed).toBe(true);
    expect(await readdir(path.join(f.data, 'materials/staging'))).toEqual([]);
    expect(await readdir(path.join(f.data, 'materials/objects'))).toEqual([]);
    expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
    expect(f.host.permissions.diagnostics().leases).toBe(0);
    expect(await readFile(item.target)).toEqual(item.bytes);
  },
);
