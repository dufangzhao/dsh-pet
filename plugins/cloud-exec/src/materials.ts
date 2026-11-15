import { constants } from 'node:fs';
import { chown, lstat, open, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  isKernelErrorCode,
  makeError,
  type KernelError,
} from '@pet/contracts';
import type { PluginTask } from '@pet/plugin-sdk';
import { checkedDirectory } from './workspace.js';
import type { CloudExecutionRequest, CloudMaterialReader, CloudMaterialSource } from './types.js';

export class MaterialInputFailure extends Error {
  readonly error: KernelError;
  constructor(code: KernelError['code']) {
    super(code);
    this.error = makeError(code);
  }
}

function failure(error: unknown): MaterialInputFailure {
  if (error instanceof MaterialInputFailure) return error;
  const code = (error as { error?: { code?: unknown } } | null)?.error?.code;
  return new MaterialInputFailure(isKernelErrorCode(code) ? code : 'unavailable');
}

/** Only called for parsed selections, before a container can access the fresh job workspace. */
export async function stageMaterials(
  root: string,
  jobId: string,
  request: CloudExecutionRequest,
  task: PluginTask,
  executionId: string,
  readMaterial: CloudMaterialReader,
): Promise<void> {
  const work = await checkedDirectory(path.join(root, jobId, 'work'));
  const lifetime = new AbortController();
  const signal = AbortSignal.any([task.signal, lifetime.signal]);
  const written: Array<{ target: string; dev: number; ino: number }> = [];
  let pending: Promise<void> | undefined;
  let total = (request.files ?? []).reduce(
    (bytes, file) => bytes + Buffer.byteLength(file.content),
    0,
  );
  const live = (): void => {
    if (signal.aborted) throw new MaterialInputFailure('cancelled');
  };
  const copy = async (source: CloudMaterialSource, inputName: string): Promise<void> => {
    live();
    if (
      !source ||
      !Number.isSafeInteger(source.sizeBytes) ||
      source.sizeBytes < 0 ||
      source.sizeBytes > COMPANION_MATERIAL_FILE_MAX_BYTES ||
      typeof source.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      typeof source.check !== 'function' ||
      !source.chunks ||
      typeof source.chunks[Symbol.asyncIterator] !== 'function'
    )
      throw new MaterialInputFailure('invalid-input');
    const size = source.sizeBytes;
    const expectedHash = source.sha256;
    total += size;
    if (total > COMPANION_MATERIAL_INPUT_MAX_BYTES)
      throw new MaterialInputFailure('quota-exceeded');
    await source.check();
    live();
    const target = path.resolve(work, inputName);
    if (!target.startsWith(`${work}${path.sep}`)) throw new MaterialInputFailure('invalid-input');
    await checkedDirectory(path.dirname(target), true);
    live();
    const file = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const info = await file.stat();
      written.push({ target, dev: info.dev, ino: info.ino });
      const hash = createHash('sha256');
      let bytes = 0;
      const chunks = source.chunks[Symbol.asyncIterator]();
      let complete = false;
      try {
        while (!complete) {
          await source.check();
          live();
          const next = await chunks.next();
          live();
          await source.check();
          live();
          if (next.done) {
            complete = true;
            break;
          }
          const chunk = next.value;
          if (!(chunk instanceof Uint8Array) || chunk.byteLength > size - bytes)
            throw new MaterialInputFailure('invalid-input');
          bytes += chunk.byteLength;
          // Copy one bounded slice so an upstream buffer cannot change during an awaited write.
          for (let offset = 0; offset < chunk.byteLength; offset += 65_536) {
            await source.check();
            live();
            const slice = Buffer.from(chunk.subarray(offset, offset + 65_536));
            hash.update(slice);
            await file.writeFile(slice);
            live();
          }
        }
      } finally {
        if (!complete) await chunks.return?.();
      }
      await source.check();
      live();
      if (bytes !== size || hash.digest('hex') !== expectedHash)
        throw new MaterialInputFailure('invalid-input');
      await file.sync();
      if (process.getuid?.() === 0) {
        await file.chown(65534, 65534);
        let directory = path.dirname(target);
        while (directory !== work) {
          await chown(directory, 65534, 65534);
          directory = path.dirname(directory);
        }
      }
      live();
    } finally {
      await file.close();
    }
  };
  try {
    for (const selection of request.materials ?? []) {
      live();
      let consumed = false;
      let openCall = true;
      let misuse = false;
      pending = undefined;
      try {
        const result = await readMaterial(
          Object.freeze({
            task: Object.freeze({ ...task, signal }),
            executionId,
            selection: Object.freeze({ ...selection }),
          }),
          (source) => {
            if (!openCall || consumed) {
              misuse = true;
              return Promise.reject(new MaterialInputFailure('invalid-input'));
            }
            consumed = true;
            pending = copy(source, selection.inputName);
            // The host must await consume. Retain our own join even if an injected reader fails.
            void pending.catch(() => {});
            return pending;
          },
        );
        openCall = false;
        if (!result.ok) throw new MaterialInputFailure(result.error.code);
        if (pending) await pending;
        live();
        if (!consumed || misuse) throw new MaterialInputFailure('invalid-input');
      } finally {
        openCall = false;
      }
    }
    live();
  } catch (error) {
    lifetime.abort();
    // Never delete a file while its copy is still running.
    await pending?.catch(() => {});
    for (const entry of written.reverse()) {
      await checkedDirectory(path.dirname(entry.target));
      const info = await lstat(entry.target);
      if (
        !entry.target.startsWith(`${work}${path.sep}`) ||
        (await realpath(entry.target)) !== entry.target ||
        !info.isFile() ||
        info.nlink !== 1 ||
        info.dev !== entry.dev ||
        info.ino !== entry.ino
      )
        throw new MaterialInputFailure('unavailable');
      await unlink(entry.target);
    }
    throw failure(error);
  }
}
