import { constants } from 'node:fs';
import { mkdir, realpath, lstat, open, link, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_MATERIAL_IMAGE_MAX_BYTES,
  COMPANION_MATERIAL_MAX_PARTS,
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
const rawCustody = Symbol('server raw input custody');
/** Host-private object identity. Serialized metadata cannot recreate this proof or its actor. */
export interface RawInputCustody {
  readonly [rawCustody]: true;
}
export interface RawInputSource {
  readonly body: AsyncIterable<Uint8Array>;
  /** Resolves only after successful native completion AND actual reader join; cancellation rejects. */
  readonly settled: Promise<void>;
  readonly signal: AbortSignal;
  check(): Promise<void>;
  cancel(): void;
}
export interface RawInputExpectation {
  readonly expectedSizeBytes: number | null;
  readonly expectedSha256: string | null;
}
export interface RawInputBytes {
  readonly sizeBytes: number;
  readonly sha256: string;
}
type StagedBytes = RawInputBytes & {
  readonly name: string;
  readonly owned: Identity;
  release(): void;
};
type RawInputRecord = RawInputBytes & {
  readonly name: string;
  readonly owned: Identity;
  readonly actor: RuntimeInputAccess;
  readonly readers: Set<Promise<unknown>>;
  readonly abort: AbortController;
  readonly releaseReservation: () => void;
  releasing: Promise<void> | undefined;
};
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
  private preparations = 0;
  private readonly rawReaders = new Set<Promise<unknown>>();
  private readonly root: Directory;
  private readonly objects: Directory;
  private readonly staging: Directory;
  private reservedBytes = 0;
  private closed = false;
  private cleanupFailed = false;
  private closing: Promise<void> | undefined;
  private readonly rawStages = new Set<Promise<unknown>>();
  private readonly rawInputs = new Map<RawInputCustody, RawInputRecord>();
  private readonly releasedRawInputs = new WeakSet<RawInputCustody>();
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
    preparation = true,
  ): Promise<T> {
    if (this.closed || this.cleanupFailed) throw new KernelFault('not-ready');
    if (preparation && this.preparations >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      throw new KernelFault('quota-exceeded');
    const captured: RuntimeInputAccess = {
      scope: structuredClone(access.scope),
      signal: access.signal,
      check: access.check.bind(access),
    };
    if (preparation) this.preparations++;
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
      if (preparation) this.preparations--;
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
    const verified = await this.readVerified(
      this.objects,
      objectName(stored.id),
      reference,
      operation,
    );
    try {
      return verified.bytes;
    } finally {
      verified.release();
    }
  }
  private async readVerified(
    directory: Directory,
    name: string,
    reference: RawInputBytes,
    operation: Operation,
    owned?: Identity,
  ): Promise<{ bytes: Buffer; release(): void }> {
    const release = this.reserve(reference.sizeBytes);
    let handle: FileHandle | undefined,
      transferred = false;
    try {
      await operation.check();
      const target = path.join(directory.path, name);
      const before = await lstat(target);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        (owned && !sameFile(before, owned))
      )
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
      await handle.close();
      handle = undefined;
      transferred = true;
      return { bytes: output, release };
    } finally {
      try {
        if (handle) await handle.close();
      } finally {
        if (!transferred) release();
      }
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
  private async stageBytes(
    source: AsyncIterable<Uint8Array>,
    limit: number,
    operation: Operation,
  ): Promise<StagedBytes> {
    await operation.check();
    const name = `${randomUUID()}.part`;
    const handle = await open(
      path.join(this.staging.path, name),
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    let owned: Identity | undefined,
      retained = 0,
      sizeBytes = 0;
    const hash = createHash('sha256');
    try {
      owned = await handle.stat();
      for await (const chunk of source) {
        await operation.check();
        if (!(chunk instanceof Uint8Array)) throw new KernelFault('invalid-input');
        if (
          sizeBytes + chunk.byteLength > limit ||
          this.reservedBytes + chunk.byteLength > COMPANION_MATERIAL_STAGING_MAX_BYTES
        )
          throw new KernelFault('quota-exceeded');
        sizeBytes += chunk.byteLength;
        retained += chunk.byteLength;
        this.reservedBytes += chunk.byteLength;
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      await handle.sync();
      await handle.close();
      await operation.check();
      const result: StagedBytes = {
        name,
        owned,
        sizeBytes,
        sha256: hash.digest('hex'),
        release: () => {
          this.reservedBytes -= retained;
          retained = 0;
        },
      };
      return result;
    } catch (error) {
      try {
        await handle.close();
        if (owned) await this.removeOwned(this.staging, name, owned);
        else this.cleanupFailed = true;
      } catch {
        this.cleanupFailed = true;
      }
      this.reservedBytes -= retained;
      throw error;
    }
  }
  private async syncDirectory(directory: Directory): Promise<void> {
    const handle = await open(
      directory.path,
      constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      if (!sameFile(directory, await handle.stat())) throw new KernelFault('permission-denied');
      await handle.sync();
    } finally {
      await handle.close();
    }
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
    const stage = await this.stageBytes(source, limit, operation);
    const stageName = stage.name,
      owned = stage.owned,
      size = stage.sizeBytes,
      finalName = objectName(id);
    let linked = false,
      commitAttempt = false,
      committed = false;
    try {
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
        sha256: stage.sha256,
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
      await this.syncDirectory(this.objects);
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
      stage.release();
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
  /** The producer is host-private: EOF plus successful native join, never a wire ready flag. */
  stageRawInput(
    expectation: RawInputExpectation,
    source: RawInputSource,
    actor: RuntimeInputAccess,
  ): Promise<RawInputCustody> {
    const expected = structuredClone(expectation);
    if (
      (expected.expectedSizeBytes !== null &&
        (!Number.isSafeInteger(expected.expectedSizeBytes) ||
          expected.expectedSizeBytes < 0 ||
          expected.expectedSizeBytes > COMPANION_MATERIAL_FILE_MAX_BYTES)) ||
      (expected.expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(expected.expectedSha256))
    )
      return Promise.reject(new KernelFault('invalid-input'));
    if (
      this.rawInputs.size + this.rawStages.size >=
      COMPANION_MATERIAL_MAX_PARTS * COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE
    )
      return Promise.reject(new KernelFault('quota-exceeded'));
    if (this.rawStages.size >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      return Promise.reject(new KernelFault('quota-exceeded'));
    const body = source.body,
      settled = source.settled,
      localSignal = source.signal;
    const localCheck = source.check.bind(source),
      cancelSource = source.cancel.bind(source);
    // Native failure may precede iterator EOF; its original promise is still awaited below.
    void settled.catch(() => {});
    let started = false;
    const work = this.authorized(actor, true, async (operation) => {
      started = true;
      let acquired = false,
        cancelFailure: unknown,
        failure: unknown;
      let stage: StagedBytes | undefined,
        linked = false,
        custody: RawInputCustody | undefined;
      const finalName = `${randomUUID()}.raw`;
      const cancel = () => {
        if (!acquired) {
          try {
            cancelSource();
          } catch (error) {
            cancelFailure ??= error;
          }
        }
      };
      localSignal.addEventListener('abort', cancel, { once: true });
      operation.signal.addEventListener('abort', cancel, { once: true });
      const incoming: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          const iterator = body[Symbol.asyncIterator]();
          try {
            for (;;) {
              await operation.check();
              localSignal.throwIfAborted();
              await localCheck();
              localSignal.throwIfAborted();
              const next = await iterator.next();
              if (next.done) {
                // A fulfilled join must mean successful native completion, including cancellation rejection.
                await settled;
                acquired = true;
                break;
              }
              await operation.check();
              localSignal.throwIfAborted();
              await localCheck();
              localSignal.throwIfAborted();
              yield next.value;
            }
          } finally {
            if (!acquired) {
              cancel();
              await iterator.return?.();
            }
          }
        },
      };
      try {
        stage = await this.stageBytes(incoming, COMPANION_MATERIAL_FILE_MAX_BYTES, operation);
        if (
          (expected.expectedSizeBytes !== null && stage.sizeBytes !== expected.expectedSizeBytes) ||
          (expected.expectedSha256 !== null && stage.sha256 !== expected.expectedSha256)
        )
          throw new KernelFault('invalid-input');
        const verified = await this.readVerified(
          this.staging,
          stage.name,
          stage,
          operation,
          stage.owned,
        );
        verified.release();
        await operation.check();
        await link(
          path.join(this.staging.path, stage.name),
          path.join(this.staging.path, finalName),
        );
        linked = true;
        await this.removeOwned(this.staging, stage.name, stage.owned);
        await this.syncDirectory(this.staging);
        await operation.check();
        custody = Object.freeze({
          [rawCustody]: true as const,
          toJSON(): never {
            throw new KernelFault('permission-denied');
          },
        });
        this.rawInputs.set(custody, {
          name: finalName,
          owned: stage.owned,
          sizeBytes: stage.sizeBytes,
          sha256: stage.sha256,
          actor: operation.access,
          readers: new Set(),
          abort: new AbortController(),
          releaseReservation: stage.release,
          releasing: undefined,
        });
      } catch (error) {
        failure = error;
      } finally {
        localSignal.removeEventListener('abort', cancel);
        operation.signal.removeEventListener('abort', cancel);
        if (!acquired) {
          cancel();
          const result = await Promise.allSettled([settled]);
          if (result[0]?.status === 'rejected') failure ??= result[0].reason;
        }
        if (!custody && stage) {
          try {
            await this.removeOwned(this.staging, stage.name, stage.owned);
            if (linked) await this.removeOwned(this.staging, finalName, stage.owned);
          } catch {
            this.cleanupFailed = true;
            failure ??= new KernelFault('unavailable');
          }
          stage.release();
        }
      }
      // Successful native EOF/join is stronger than a source-only cancel/postflight refusal.
      if (cancelFailure && !acquired) throw new KernelFault('unavailable');
      if (failure) throw failure;
      if (!custody) throw new KernelFault('unavailable');
      return custody;
    });
    const drained = work
      .catch(async (error) => {
        if (!started) {
          const cleanup = await Promise.allSettled([Promise.resolve().then(cancelSource), settled]);
          if (cleanup[0]?.status === 'rejected') throw new KernelFault('unavailable');
        }
        throw error;
      })
      .finally(() => {
        this.rawStages.delete(drained);
      });
    this.rawStages.add(drained);
    return drained;
  }
  /** Reuses only the original captured server actor; the local source is no longer consulted. */
  withRawInput<T>(
    custody: RawInputCustody,
    consume: (
      info: RawInputBytes,
      bytes: AsyncIterable<Uint8Array>,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    const record = this.rawInputs.get(custody);
    if (!record || record.releasing) return Promise.reject(new KernelFault('permission-denied'));
    if (this.rawReaders.size >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      return Promise.reject(new KernelFault('quota-exceeded'));
    const access: RuntimeInputAccess = {
      ...record.actor,
      signal: AbortSignal.any([record.actor.signal, record.abort.signal]),
    };
    const work = this.authorized(
      access,
      false,
      async (operation) => {
        const check = async () => {
          if (record.releasing) throw new KernelFault('permission-denied');
          await operation.check();
        };
        await check();
        const verified = await this.readVerified(
          this.staging,
          record.name,
          record,
          { ...operation, check },
          record.owned,
        );
        const bytes = verified.bytes;
        let complete = false;
        const stream: AsyncIterable<Uint8Array> = {
          async *[Symbol.asyncIterator]() {
            for (let at = 0; at < bytes.length; at += 64 * 1024) {
              await check();
              yield bytes.subarray(at, at + 64 * 1024);
            }
            complete = true;
          },
        };
        try {
          const value = await consume(
            Object.freeze({ sizeBytes: record.sizeBytes, sha256: record.sha256 }),
            stream,
            operation.signal,
          );
          await check();
          if (!complete) throw new KernelFault('invalid-input');
          return value;
        } finally {
          verified.release();
        }
      },
      false,
    );
    this.rawReaders.add(work);
    record.readers.add(work);
    void work.then(
      () => {
        record.readers.delete(work);
        this.rawReaders.delete(work);
      },
      () => {
        record.readers.delete(work);
        this.rawReaders.delete(work);
      },
    );
    return work;
  }
  releaseRawInput(custody: RawInputCustody): Promise<void> {
    const record = this.rawInputs.get(custody);
    if (!record)
      return this.releasedRawInputs.has(custody)
        ? Promise.resolve()
        : Promise.reject(new KernelFault('permission-denied'));
    record.abort.abort();
    return (record.releasing ??= Promise.resolve().then(async () => {
      await Promise.allSettled([...record.readers]);
      try {
        await withSourceAuthority(
          this.options.host,
          COMPANION_HOST_ID,
          [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
          async () => {
            await this.removeOwned(this.staging, record.name, record.owned);
            await this.syncDirectory(this.staging);
          },
        );
        record.releaseReservation();
        this.rawInputs.delete(custody);
        this.releasedRawInputs.add(custody);
      } catch (error) {
        this.cleanupFailed = true;
        throw error;
      }
    }));
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
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.closed = true;
      this.lifetime.abort();
      await Promise.allSettled([...this.active, ...this.rawStages]);
      const cleanup = await Promise.allSettled(
        [...this.rawInputs.keys()].map((custody) => this.releaseRawInput(custody)),
      );
      if (this.cleanupFailed || cleanup.some((result) => result.status === 'rejected'))
        throw new KernelFault('unavailable');
    })());
  }
}
export function createMaterialStore(options: MaterialStoreOptions): Promise<HostMaterialStore> {
  return HostMaterialStore.create(options);
}
