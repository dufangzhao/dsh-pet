import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { CiphertextStore } from './ciphertext-store.js';
import { MAX_CIPHERTEXT_BYTES } from './secret-cipher.js';

export const MAX_VAULT_FILE_BYTES = 192 * 1024;
export class CiphertextStoreUnavailable extends Error {
  constructor() {
    super('Credential storage is unavailable');
    this.name = 'CiphertextStoreUnavailable';
  }
}
function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}
function equalPath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Host supplies an existing, private, canonical directory. No caller-controlled relative paths. */
export class FileCiphertextStore implements CiphertextStore {
  readonly #root: string;
  constructor(directory: string) {
    if (!path.isAbsolute(directory)) throw new CiphertextStoreUnavailable();
    this.#root = path.resolve(directory);
  }

  private id(key: string): string {
    if (typeof key !== 'string' || key.length === 0 || Buffer.byteLength(key, 'utf8') > 1024)
      throw new CiphertextStoreUnavailable();
    return createHash('sha256').update(key).digest('hex');
  }

  private async root(): Promise<void> {
    const stat = await fs.lstat(this.#root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !equalPath(await fs.realpath(this.#root), this.#root)
    )
      throw new CiphertextStoreUnavailable();
  }

  private async inspect(file: string, enforceReadBudget = true) {
    try {
      const stat = await fs.lstat(file, { bigint: true });
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (enforceReadBudget && stat.size > BigInt(MAX_VAULT_FILE_BYTES))
      )
        throw new CiphertextStoreUnavailable();
      return stat;
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      const id = this.id(key);
      await this.root();
      const file = path.join(this.#root, id + '.sealed');
      const before = await this.inspect(file);
      if (!before) return null;
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat({ bigint: true });
        if (
          !opened.isFile() ||
          opened.ino !== before.ino ||
          opened.dev !== before.dev ||
          opened.size > BigInt(MAX_VAULT_FILE_BYTES)
        )
          throw new CiphertextStoreUnavailable();
        await this.root();
        const buffer = Buffer.alloc(MAX_VAULT_FILE_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
          const result = await handle.read(buffer, length, buffer.length - length, length);
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        if (length > MAX_VAULT_FILE_BYTES) throw new CiphertextStoreUnavailable();
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)),
        );
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new CiphertextStoreUnavailable();
        const row = value as Record<string, unknown>;
        if (
          Object.keys(row).sort().join(',') !== 'data,id,version' ||
          row['version'] !== 1 ||
          row['id'] !== id ||
          typeof row['data'] !== 'string'
        )
          throw new CiphertextStoreUnavailable();
        const bytes = Buffer.from(row['data'], 'base64');
        if (
          !bytes.length ||
          bytes.length > MAX_CIPHERTEXT_BYTES ||
          bytes.toString('base64') !== row['data']
        )
          throw new CiphertextStoreUnavailable();
        return Uint8Array.from(bytes);
      } finally {
        await handle.close();
      }
    } catch {
      throw new CiphertextStoreUnavailable();
    }
  }

  async write(key: string, ciphertext: Uint8Array): Promise<void> {
    let temp: string | undefined;
    let created = false;
    let failed = false;
    try {
      const id = this.id(key);
      await this.root();
      if (
        !(ciphertext instanceof Uint8Array) ||
        !ciphertext.length ||
        ciphertext.length > MAX_CIPHERTEXT_BYTES
      )
        throw new CiphertextStoreUnavailable();
      const file = path.join(this.#root, id + '.sealed');
      await this.inspect(file, false);
      temp = path.join(this.#root, id + '.' + randomUUID() + '.tmp');
      const handle = await fs.open(temp, 'wx', 0o600);
      created = true;
      try {
        await handle.writeFile(
          JSON.stringify({ version: 1, id, data: Buffer.from(ciphertext).toString('base64') }),
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.root();
      await this.inspect(file, false);
      // Replaces this credential record intentionally; no copy/truncate fallback.
      await fs.rename(temp, file);
    } catch {
      failed = true;
    } finally {
      if (created && temp) {
        try {
          await fs.unlink(temp);
        } catch (error) {
          if (!absent(error)) failed = true;
        }
      }
    }
    if (failed) throw new CiphertextStoreUnavailable();
  }

  async remove(key: string): Promise<void> {
    try {
      const id = this.id(key);
      await this.root();
      const file = path.join(this.#root, id + '.sealed');
      if (!(await this.inspect(file, false))) return;
      try {
        await fs.unlink(file);
      } catch (error) {
        if (!absent(error)) throw error;
      }
    } catch {
      throw new CiphertextStoreUnavailable();
    }
  }
}
