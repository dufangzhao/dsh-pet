import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FileCiphertextStore,
  CiphertextStoreUnavailable,
  MAX_VAULT_FILE_BYTES,
} from './file-ciphertext-store.js';
const roots: string[] = [];
async function root() {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'pet-vault-test-'));
  roots.push(directory);
  return directory;
}
const filename = (key: string) => createHash('sha256').update(key).digest('hex') + '.sealed';
afterEach(async () => {
  for (const directory of roots.splice(0)) {
    if (!path.basename(directory).startsWith('pet-vault-test-'))
      throw new Error('Unexpected cleanup path');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe('ciphertext filesystem adapter', () => {
  it('stores only ciphertext in opaque filenames and survives reopen', async () => {
    const directory = await root();
    const store = new FileCiphertextStore(directory);
    const bytes = new Uint8Array([1, 2, 3]);
    await store.write('../not-a-path', bytes);
    bytes[0] = 9;
    expect(await new FileCiphertextStore(directory).read('../not-a-path')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(await fs.readdir(directory)).toEqual([filename('../not-a-path')]);
  });
  it('replaces records atomically and deletes idempotently', async () => {
    const directory = await root();
    const store = new FileCiphertextStore(directory);
    await store.write('key', new Uint8Array([1]));
    await store.write('key', new Uint8Array([2]));
    expect(await store.read('key')).toEqual(new Uint8Array([2]));
    expect((await fs.readdir(directory)).some((n) => n.endsWith('.tmp'))).toBe(false);
    await store.remove('key');
    await store.remove('key');
    expect(await store.read('key')).toBeNull();
  });
  it('rejects relative or missing roots', async () => {
    expect(() => new FileCiphertextStore('relative')).toThrow(CiphertextStoreUnavailable);
    const directory = await root();
    await expect(
      new FileCiphertextStore(path.join(directory, 'missing')).read('key'),
    ).rejects.toThrow(CiphertextStoreUnavailable);
  });
  it('refuses a directory junction instead of following it', async () => {
    const directory = await root();
    const actual = path.join(directory, 'actual');
    await fs.mkdir(actual);
    const alias = path.join(directory, 'alias');
    await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(new FileCiphertextStore(alias).write('key', new Uint8Array([1]))).rejects.toThrow(
      CiphertextStoreUnavailable,
    );
    expect(await fs.readdir(actual)).toEqual([]);
  });
  it('rejects oversized and malformed records without echoing contents', async () => {
    const directory = await root();
    const store = new FileCiphertextStore(directory);
    const file = path.join(directory, filename('key'));
    await fs.writeFile(file, 'x'.repeat(MAX_VAULT_FILE_BYTES + 1));
    await expect(store.read('key')).rejects.toThrow('Credential storage is unavailable');
    await fs.writeFile(file, 'private-not-json');
    await expect(store.read('key')).rejects.toThrow('Credential storage is unavailable');
  });
  it('rejects mismatched record identity and noncanonical base64', async () => {
    const directory = await root();
    const store = new FileCiphertextStore(directory);
    const file = path.join(directory, filename('key'));
    await fs.writeFile(file, JSON.stringify({ version: 1, id: 'wrong', data: 'AQ==' }));
    await expect(store.read('key')).rejects.toThrow(CiphertextStoreUnavailable);
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, id: filename('key').slice(0, -7), data: ' A Q== ' }),
    );
    await expect(store.read('key')).rejects.toThrow(CiphertextStoreUnavailable);
  });
  it('rejects a directory impersonating a credential record', async () => {
    const directory = await root();
    const store = new FileCiphertextStore(directory);
    await fs.mkdir(path.join(directory, filename('key')));
    await expect(store.write('key', new Uint8Array([1]))).rejects.toThrow(
      CiphertextStoreUnavailable,
    );
    await expect(store.remove('key')).rejects.toThrow(CiphertextStoreUnavailable);
  });
});
it('permits explicit replacement or deletion of an oversized regular record', async () => {
  const directory = await root();
  const store = new FileCiphertextStore(directory);
  const file = path.join(directory, filename('repair'));
  await fs.writeFile(file, 'x'.repeat(MAX_VAULT_FILE_BYTES + 1));
  await expect(store.read('repair')).rejects.toThrow(CiphertextStoreUnavailable);
  await store.write('repair', new Uint8Array([9]));
  expect(await store.read('repair')).toEqual(new Uint8Array([9]));
  await fs.writeFile(file, 'x'.repeat(MAX_VAULT_FILE_BYTES + 1));
  await store.remove('repair');
  expect(await store.read('repair')).toBeNull();
});
