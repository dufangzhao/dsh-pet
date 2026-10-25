import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { makeError, type Result } from '@pet/contracts';
import type { InstanceIdentity } from '../runtime/identity.js';
import { configIdentity } from './store.js';
/** Host-only allocator. Does not grant a plugin permission to perform file operations. */
export class PluginDataDirectories {
  readonly #root: string;
  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new Error('Invalid data root');
    this.#root = path.resolve(root);
  }
  async get(identity: InstanceIdentity): Promise<Result<string>> {
    try {
      const id = configIdentity(identity);
      if (!id) return { ok: false, error: makeError('invalid-input', false) };
      const same = (a: string, b: string) =>
        process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
      const check = async (file: string) => {
        const stat = await fs.lstat(file);
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          !same(await fs.realpath(file), path.resolve(file))
        )
          throw new Error('Invalid directory');
      };
      await check(this.#root);
      let current = this.#root;
      for (const part of [id.pluginId, id.instanceId]) {
        current = path.join(current, createHash('sha256').update(part).digest('hex'));
        try {
          await fs.mkdir(current, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        await check(current);
      }
      return { ok: true, value: current };
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  }
}
