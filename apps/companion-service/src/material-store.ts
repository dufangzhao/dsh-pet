import { constants } from 'node:fs';
import { mkdir, realpath, lstat, open, link, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_MATERIAL_IMAGE_MAX_BYTES,
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE,
  COMPANION_MATERIAL_STAGING_MAX_BYTES,
  COMPANION_FULL_TEXT_MAX_BYTES,
  isCompanionMaterialRef,
  isCompanionRecordId,
  isCompanionInputOrigin,
  companionAudienceKey,
  type CompanionMaterialRef,
  type CompanionInputAdmission,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import {
  COMPANION_HOST_ID,
  withSourceAuthority,
  type CompanionPluginHost,
  type CompanionRuntime,
  type RuntimeInputAccess,
  type RuntimeInputPorts,
} from '@pet/companion-runtime';
import type { StoredMaterial } from '@pet/state-sqlite';
import type { PetCanonicalTextResolver } from './speech-controller.js';
import { imageMediaType } from './material-format.js';

export interface MaterialWrite {
  readonly id?: string;
  readonly inputId: string;
  readonly observationId?: string | null;
  readonly kind: CompanionMaterialRef['kind'];
  readonly name: string;
  /** Assertion, never a filename-based MIME detector. Unknown files use application/octet-stream. */
  readonly mediaType?: string;
  /** Voice duration is supplied only by the host's verified codec path. */
  readonly durationMs?: number | null;
}
export interface MaterialStoreOptions {
  readonly directory: string;
  readonly host: Pick<CompanionPluginHost, 'runFor' | 'permissions'>;
  readonly state: Pick<CompanionRuntime, 'state'>;
}
type Identity = { readonly dev: number; readonly ino: number };
type Directory = Identity & { readonly path: string };
type Operation = {
  readonly access: RuntimeInputAccess;
  readonly signal: AbortSignal;
  check(): Promise<void>;
};
const sameFile = (a: Identity, b: Identity): boolean => a.dev === b.dev && a.ino === b.ino;
const digest = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
const objectName = (id: string): string => `${digest(`material:${id}`)}.bin`;
const storageKey = (id: string): string => `objects/${objectName(id)}`;
function missing(error: unknown): boolean {
  return error instanceof KernelFault && error.error.code === 'unavailable';
}
function enoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
async function directoryIdentity(target: string): Promise<Directory> {
  if ((await realpath(target)) !== target) throw new KernelFault('permission-denied');
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new KernelFault('permission-denied');
  return { path: target, dev: info.dev, ino: info.ino };
}

/** Physical bytes belong to this host; State remains the sole owner of canonical metadata/ACL. */
export class HostMaterialStore {
  private readonly lifetime = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private readonly root: Directory;
  private readonly objects: Directory;
  private readonly staging: Directory;
  private reservedBytes = 0;
  private closed = false;
  private cleanupFailed = false;
  private constructor(
    private readonly options: MaterialStoreOptions,
    directories: readonly [Directory, Directory, Directory],
  ) {
    [this.root, this.objects, this.staging] = directories;
  }
  static async create(options: MaterialStoreOptions): Promise<HostMaterialStore> {
    const supplied = path.resolve(options.directory);
    if ((await realpath(supplied)) !== supplied || !(await lstat(supplied)).isDirectory())
      throw new KernelFault('permission-denied');
    return withSourceAuthority(
      options.host,
      COMPANION_HOST_ID,
      [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
      async () => {
        const root = path.join(supplied, 'materials');
        await mkdir(root, { recursive: true, mode: 0o700 });
        const rootIdentity = await directoryIdentity(root);
        await mkdir(path.join(root, 'objects'), { mode: 0o700 }).catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
        await mkdir(path.join(root, 'staging'), { mode: 0o700 }).catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
        return new HostMaterialStore(options, [
          rootIdentity,
          await directoryIdentity(path.join(root, 'objects')),
          await directoryIdentity(path.join(root, 'staging')),
        ]);
      },
    );
  }
  private async paths(): Promise<void> {
    for (const expected of [this.root, this.objects, this.staging]) {
      if (!sameFile(expected, await directoryIdentity(expected.path)))
        throw new KernelFault('permission-denied');
    }
  }
  private reserve(bytes: number): () => void {
    if (this.reservedBytes + bytes > COMPANION_MATERIAL_STAGING_MAX_BYTES)
      throw new KernelFault('quota-exceeded');
    this.reservedBytes += bytes;
    return () => {
      this.reservedBytes -= bytes;
    };
  }
  private async authorized<T>(
    access: RuntimeInputAccess,
    writing: boolean,
    work: (operation: Operation) => Promise<T>,
  ): Promise<T> {
    if (this.closed || this.cleanupFailed) throw new KernelFault('not-ready');
    if (this.active.size >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      throw new KernelFault('quota-exceeded');
    const captured: RuntimeInputAccess = {
      scope: structuredClone(access.scope),
      signal: access.signal,
      check: access.check.bind(access),
    };
    const running = withSourceAuthority(
      this.options.host,
      COMPANION_HOST_ID,
      [{ kind: 'files', scope: 'plugin-data', access: writing ? 'read-write' : 'read' }],
      async (sourceSignal) => {
        const signal = AbortSignal.any([sourceSignal, captured.signal]);
        const check = async (): Promise<void> => {
          if (signal.aborted) throw new KernelFault('permission-denied');
          await captured.check();
          if (signal.aborted) throw new KernelFault('permission-denied');
          await this.paths();
        };
        await check();
        const value = await work({ access: captured, signal, check });
        if (this.cleanupFailed) throw new KernelFault('unavailable');
        await check();
        return value;
      },
      { signal: this.lifetime.signal },
    );
    this.active.add(running);
    try {
      return await running;
    } finally {
      this.active.delete(running);
    }
  }
  private async get(id: string, operation: Operation): Promise<StoredMaterial> {
    if (!isCompanionRecordId(id)) throw new KernelFault('invalid-input');
    await operation.check();
    const result = await this.options.state.state(
      'getMaterial',
      { id, scope: operation.access.scope },
      operation.signal,
    );
    await operation.check();
    return result;
  }
  private async bytes(stored: StoredMaterial, operation: Operation): Promise<Buffer> {
    const reference = stored.reference;
    if (
      stored.phase !== 'ready' ||
      stored.cleanup !== 'settled' ||
      !reference ||
      !isCompanionMaterialRef(reference) ||
      stored.id !== reference.id ||
      stored.storageKey !== storageKey(stored.id) ||
      companionAudienceKey(stored.audience) !== companionAudienceKey(reference.audience)
    )
      throw new KernelFault('not-ready');
    const release = this.reserve(reference.sizeBytes);
    let handle: FileHandle | undefined;
    try {
      await operation.check();
      const target = path.join(this.objects.path, objectName(stored.id));
      const before = await lstat(target);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
        throw new KernelFault('permission-denied');
      handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (
        !sameFile(before, info) ||
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size !== reference.sizeBytes
      )
        throw new KernelFault('permission-denied');
      const output = Buffer.alloc(reference.sizeBytes);
      let at = 0;
      while (at < output.length) {
        await operation.check();
        const read = await handle.read(output, at, Math.min(64 * 1024, output.length - at), at);
        if (!read.bytesRead) throw new KernelFault('invalid-input');
        at += read.bytesRead;
      }
      const after = await handle.stat();
      const named = await lstat(target);
      if (
        !sameFile(info, after) ||
        !sameFile(info, named) ||
        named.isSymbolicLink() ||
        after.nlink !== 1 ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        after.ctimeMs !== info.ctimeMs ||
        digest(output) !== reference.sha256
      )
        throw new KernelFault('invalid-input');
      await operation.check();
      return output;
    } finally {
      if (handle) await handle.close();
      release();
    }
  }
  async withMaterial<T>(
    id: string,
    access: RuntimeInputAccess,
    consume: (
      reference: CompanionMaterialRef,
      bytes: AsyncIterable<Uint8Array>,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    return this.authorized(access, false, async (operation) => {
      const stored = await this.get(id, operation);
      const bytes = await this.bytes(stored, operation),
        reference = stored.reference;
      if (!reference) throw new KernelFault('not-ready');
      const release = this.reserve(bytes.length);
      let complete = false;
      const stream: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          for (let at = 0; at < bytes.length; at += 64 * 1024) {
            await operation.check();
            yield bytes.subarray(at, at + 64 * 1024);
          }
          complete = true;
        },
      };
      try {
        const value = await consume(structuredClone(reference), stream, operation.signal);
        await operation.check();
        if (!complete) throw new KernelFault('invalid-input');
        return value;
      } finally {
        release();
      }
    });
  }
  private async removeOwned(directory: Directory, name: string, owned: Identity): Promise<void> {
    await this.paths();
    if (
      path.basename(name) !== name ||
      path.dirname(path.join(directory.path, name)) !== directory.path
    )
      throw new KernelFault('permission-denied');
    const target = path.join(directory.path, name);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (enoent(error)) return;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || !sameFile(info, owned))
      throw new KernelFault('permission-denied');
    await unlink(target);
  }
  private async write(
    input: MaterialWrite,
    source: AsyncIterable<Uint8Array>,
    operation: Operation,
  ): Promise<CompanionMaterialRef> {
    const id = input.id ?? `material-${randomUUID()}`;
    if (
      !isCompanionRecordId(id) ||
      !isCompanionRecordId(input.inputId) ||
      !['image', 'voice', 'file', 'text'].includes(input.kind)
    )
      throw new KernelFault('invalid-input');
    await operation.check();
    const admission = await this.options.state.state(
      'getInput',
      { id: input.inputId, scope: operation.access.scope },
      operation.signal,
    );
    await operation.check();
    const limit =
      input.kind === 'image'
        ? COMPANION_MATERIAL_IMAGE_MAX_BYTES
        : input.kind === 'text'
          ? COMPANION_FULL_TEXT_MAX_BYTES
          : COMPANION_MATERIAL_FILE_MAX_BYTES;
    const stageName = `${randomUUID()}.part`,
      finalName = objectName(id);
    const handle = await open(
      path.join(this.staging.path, stageName),
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const owned = await handle.stat();
    const hash = createHash('sha256');
    let reserved = 0;
    let size = 0,
      linked = false,
      commitAttempt = false,
      committed = false;
    try {
      for await (const chunk of source) {
        await operation.check();
        if (!(chunk instanceof Uint8Array)) throw new KernelFault('invalid-input');
        size += chunk.byteLength;
        if (size > limit) throw new KernelFault('quota-exceeded');
        if (this.reservedBytes + chunk.byteLength > COMPANION_MATERIAL_STAGING_MAX_BYTES)
          throw new KernelFault('quota-exceeded');
        this.reservedBytes += chunk.byteLength;
        reserved += chunk.byteLength;
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      await handle.sync();
      await handle.close();
      await operation.check();
      let mediaType =
        input.mediaType ?? (input.kind === 'text' ? 'text/plain' : 'application/octet-stream');
      if (input.kind === 'image' || input.kind === 'text') {
        const data = await this.readStage(stageName, owned, size);
        if (input.kind === 'image') mediaType = imageMediaType(data);
        else {
          try {
            new TextDecoder('utf-8', { fatal: true }).decode(data);
          } catch {
            throw new KernelFault('invalid-input');
          }
          if (mediaType !== 'text/plain') throw new KernelFault('invalid-input');
        }
        if (input.mediaType && mediaType !== input.mediaType)
          throw new KernelFault('invalid-input');
      } else if (input.kind === 'file' && mediaType !== 'application/octet-stream') {
        // Filename/reported MIME is not evidence of an arbitrary binary format.
        mediaType = 'application/octet-stream';
      }
      const reference: CompanionMaterialRef = {
        id,
        kind: input.kind,
        name: input.name,
        mediaType,
        sizeBytes: size,
        sha256: hash.digest('hex'),
        durationMs: input.kind === 'voice' ? (input.durationMs ?? null) : null,
        audience: structuredClone(admission.origin.audience),
        originInputIds: [input.inputId],
      };
      if (!isCompanionMaterialRef(reference)) throw new KernelFault('invalid-input');
      let existing: StoredMaterial | undefined;
      try {
        existing = await this.get(id, operation);
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (existing?.phase === 'ready') {
        if (
          !isDeepStrictEqual(existing.reference, reference) ||
          existing.inputId !== input.inputId ||
          existing.observationId !== (input.observationId ?? null)
        )
          throw new KernelFault('conflict');
        await this.bytes(existing, operation);
        return structuredClone(reference);
      }
      await operation.check();
      try {
        await link(
          path.join(this.staging.path, stageName),
          path.join(this.objects.path, finalName),
        );
        linked = true;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
          throw new KernelFault('conflict');
        throw error;
      }
      await this.removeOwned(this.staging, stageName, owned);
      const directory = await open(
        this.objects.path,
        constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        if (!sameFile(this.objects, await directory.stat()))
          throw new KernelFault('permission-denied');
        await directory.sync();
      } finally {
        await directory.close();
      }
      await operation.check();
      commitAttempt = true;
      const saved = await this.options.state.state(
        'putMaterial',
        {
          id,
          inputId: input.inputId,
          observationId: input.observationId ?? null,
          audience: reference.audience,
          phase: 'ready',
          reference,
          storageKey: storageKey(id),
          cleanup: 'settled',
          error: null,
        },
        operation.signal,
      );
      committed = true;
      if (!isDeepStrictEqual(saved.reference, reference) || saved.storageKey !== storageKey(id))
        throw new KernelFault('conflict');
      await operation.check();
      return structuredClone(reference);
    } finally {
      await handle.close();
      try {
        await this.removeOwned(this.staging, stageName, owned);
        if (linked && !committed) {
          let keep = false;
          if (commitAttempt) {
            // Private reconciliation of this known ID only; no participant data/bytes escape this cleanup lookup.
            try {
              await this.options.state.state('getMaterial', { id, scope: { kind: 'management' } });
              keep = true;
            } catch (error) {
              if (!missing(error)) {
                keep = true;
                this.cleanupFailed = true;
              }
            }
          }
          if (!keep) await this.removeOwned(this.objects, finalName, owned);
        }
      } catch {
        this.cleanupFailed = true;
      }
      this.reservedBytes -= reserved;
    }
  }
  private async readStage(name: string, owned: Identity, size: number): Promise<Buffer> {
    await this.paths();
    const handle = await open(
      path.join(this.staging.path, name),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const info = await handle.stat();
      if (!sameFile(info, owned) || !info.isFile() || info.nlink !== 1 || info.size !== size)
        throw new KernelFault('permission-denied');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
  put(
    input: MaterialWrite,
    bytes: AsyncIterable<Uint8Array>,
    access: RuntimeInputAccess,
  ): Promise<CompanionMaterialRef> {
    const captured = structuredClone(input);
    return this.authorized(access, true, (operation) => this.write(captured, bytes, operation));
  }
  readonly storeFullText: NonNullable<RuntimeInputPorts['storeFullText']> = async (
    output,
    access,
  ) => {
    output = structuredClone(output);
    if (
      !isCompanionRecordId(output.id) ||
      !isCompanionInputOrigin(output.origin) ||
      !output.origin.inputId ||
      !output.text.length ||
      Buffer.from(output.text, 'utf8').toString('utf8') !== output.text
    )
      throw new KernelFault('invalid-input');
    const inputId = output.origin.inputId;
    const bytes = Buffer.from(output.text, 'utf8');
    if (bytes.length > COMPANION_FULL_TEXT_MAX_BYTES) throw new KernelFault('quota-exceeded');
    return this.authorized(access, true, async (operation) => {
      const admission = await this.options.state.state(
        'getInput',
        { id: inputId, scope: operation.access.scope },
        operation.signal,
      );
      if (!isDeepStrictEqual(admission.origin, output.origin))
        throw new KernelFault('permission-denied');
      const id = `text-${digest(JSON.stringify([output.id, output.origin.inputId, companionAudienceKey(output.origin.audience)]))}`;
      return this.write(
        { id, inputId, kind: 'text', name: 'reply.txt', mediaType: 'text/plain' },
        (async function* () {
          yield bytes;
        })(),
        operation,
      );
    });
  };
  private async admission(input: CompanionInputAdmission, operation: Operation): Promise<void> {
    await operation.check();
    const stored = await this.options.state.state(
      'getInput',
      { id: input.id, scope: operation.access.scope },
      operation.signal,
    );
    if (
      !isDeepStrictEqual(stored.origin, input.origin) ||
      !isDeepStrictEqual(stored.materialIds, input.materialIds)
    )
      throw new KernelFault('permission-denied');
    await operation.check();
  }
  readonly resolveInput: NonNullable<RuntimeInputPorts['resolveInput']> = (input, access) =>
    this.authorized(access, false, async (operation) => {
      await this.admission(input, operation);
      const images: { type: 'input_image'; image_url: string }[] = [];
      for (const id of input.materialIds) {
        const stored = await this.get(id, operation);
        if (stored.reference?.kind !== 'image') continue;
        const bytes = await this.bytes(stored, operation);
        if (imageMediaType(bytes) !== stored.reference.mediaType)
          throw new KernelFault('invalid-input');
        images.push({
          type: 'input_image',
          image_url: `data:${stored.reference.mediaType};base64,${bytes.toString('base64')}`,
        });
      }
      await operation.check();
      return images;
    });
  async validateWorkMaterials(
    input: CompanionInputAdmission,
    access: RuntimeInputAccess,
  ): Promise<readonly CompanionMaterialRef[]> {
    return this.authorized(access, false, async (operation) => {
      await this.admission(input, operation);
      const materials: CompanionMaterialRef[] = [];
      for (const id of input.materialIds) {
        const stored = await this.get(id, operation);
        await this.bytes(stored, operation);
        if (!stored.reference) throw new KernelFault('not-ready');
        materials.push(structuredClone(stored.reference));
      }
      return materials;
    });
  }
  readonly resolvePetCanonicalText: PetCanonicalTextResolver = async (message, signal) => {
    if (message.role !== 'assistant' || message.audience?.kind !== 'owner-private')
      throw new KernelFault('permission-denied');
    if (!message.content || message.content.kind === 'inline-text') return message.text;
    const reference = message.content.material;
    if (reference.kind !== 'text' || reference.audience.kind !== 'owner-private')
      throw new KernelFault('permission-denied');
    const access: RuntimeInputAccess = {
      scope: { kind: 'conversation', audience: { kind: 'owner-private' }, principalId: 'owner' },
      signal,
      check: async () => {
        if (signal.aborted) throw new KernelFault('permission-denied');
      },
    };
    return this.authorized(access, false, async (operation) => {
      const stored = await this.get(reference.id, operation);
      if (!isDeepStrictEqual(stored.reference, reference)) throw new KernelFault('conflict');
      return new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(stored, operation));
    });
  };
  async close(): Promise<void> {
    this.closed = true;
    this.lifetime.abort();
    await Promise.allSettled([...this.active]);
    if (this.cleanupFailed) throw new KernelFault('unavailable');
  }
}
export function createMaterialStore(options: MaterialStoreOptions): Promise<HostMaterialStore> {
  return HostMaterialStore.create(options);
}
