import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { InstanceIdentity } from '../runtime/identity.js';
import {
  configIdentity,
  storedConfig,
  ConfigStoreError,
  type ConfigStore,
  type StoredConfig,
} from './store.js';
export const CONFIG_MAX_RECORD_BYTES = 96 * 1024;
const absent = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
const equalPath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sameFile = (a: BigIntStats | null, b: BigIntStats | null) =>
  a === null || b === null
    ? a === b
    : a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeNs === b.mtimeNs;
/** Existing canonical host-private root. Cooperating writers use an exclusive lock; no stale-lock deletion. */
export class FileConfigStore implements ConfigStore {
  readonly #root: string;
  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new ConfigStoreError();
    this.#root = path.resolve(root);
  }
  private name(identity: InstanceIdentity): string {
    const id = configIdentity(identity);
    if (!id) throw new ConfigStoreError();
    return createHash('sha256')
      .update(JSON.stringify([id.pluginId, id.instanceId]))
      .digest('hex');
  }
  private async root(): Promise<void> {
    const stat = await fs.lstat(this.#root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !equalPath(await fs.realpath(this.#root), this.#root)
    )
      throw new ConfigStoreError();
  }
  private async inspect(file: string): Promise<BigIntStats | null> {
    try {
      const stat = await fs.lstat(file, { bigint: true });
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink > 1n ||
        stat.size > BigInt(CONFIG_MAX_RECORD_BYTES)
      )
        throw new ConfigStoreError();
      return stat;
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }
  private async readState(
    identity: InstanceIdentity,
    file: string,
  ): Promise<{ value: StoredConfig | null; stat: BigIntStats | null }> {
    await this.root();
    const before = await this.inspect(file);
    if (!before) return { value: null, stat: null };
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat({ bigint: true });
      if (!sameFile(opened, before)) throw new ConfigStoreError();
      const bytes = Buffer.alloc(CONFIG_MAX_RECORD_BYTES + 1);
      let count = 0;
      while (count < bytes.length) {
        const result = await handle.read(bytes, count, bytes.length - count, count);
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      if (
        count > CONFIG_MAX_RECORD_BYTES ||
        !sameFile(await handle.stat({ bigint: true }), opened) ||
        !sameFile(await this.inspect(file), opened)
      )
        throw new ConfigStoreError();
      await this.root();
      const raw: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)),
      );
      const value = storedConfig(raw, identity);
      if (!value) throw new ConfigStoreError();
      return { value, stat: opened };
    } finally {
      await handle.close();
    }
  }
  async read(identity: InstanceIdentity): Promise<StoredConfig | null> {
    try {
      const name = this.name(identity);
      return (await this.readState(identity, path.join(this.#root, name + '.config.json'))).value;
    } catch {
      throw new ConfigStoreError();
    }
  }
  async compareAndSet(
    identity: InstanceIdentity,
    expectedRevision: number | null,
    input: StoredConfig,
    signal?: AbortSignal,
  ): Promise<boolean> {
    let lock: fs.FileHandle | undefined;
    let lockStat: BigIntStats | undefined;
    let lockPath = '';
    let temp = '';
    let tempCreated = false;
    let error = false;
    let result = false;
    try {
      const name = this.name(identity);
      const value = storedConfig(input, identity);
      if (
        !value ||
        value.revision !== (expectedRevision ?? 0) + 1 ||
        !Number.isSafeInteger(value.revision) ||
        (expectedRevision !== null &&
          (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))
      )
        throw new ConfigStoreError();
      const bytes = Buffer.from(JSON.stringify(value), 'utf8');
      if (bytes.length > CONFIG_MAX_RECORD_BYTES || signal?.aborted) throw new ConfigStoreError();
      await this.root();
      lockPath = path.join(this.#root, name + '.lock');
      lock = await fs.open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      lockStat = await lock.stat({ bigint: true });
      const file = path.join(this.#root, name + '.config.json');
      const current = await this.readState(identity, file);
      if ((current.value?.revision ?? null) === expectedRevision) {
        temp = path.join(this.#root, name + '.' + randomUUID() + '.tmp');
        const handle = await fs.open(
          temp,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        tempCreated = true;
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.root();
        if (signal?.aborted || !sameFile(await this.inspect(file), current.stat))
          throw new ConfigStoreError();
        // Commit fence: once rename starts, a later cancellation cannot undo its actual effect.
        await fs.rename(temp, file);
        tempCreated = false;
        result = true;
      }
    } catch {
      error = true;
    } finally {
      if (tempCreated)
        try {
          await fs.unlink(temp);
        } catch {
          error = true;
        }
      if (lock) {
        try {
          await lock.close();
          const current = await fs.lstat(lockPath, { bigint: true });
          if (
            !lockStat ||
            current.ino !== lockStat.ino ||
            current.dev !== lockStat.dev ||
            current.isSymbolicLink()
          )
            error = true;
          else await fs.unlink(lockPath);
        } catch {
          error = true;
        }
      }
    }
    if (error) throw new ConfigStoreError();
    return result;
  }
}
