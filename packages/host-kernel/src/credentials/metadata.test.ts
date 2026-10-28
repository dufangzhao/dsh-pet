import { expect, it, vi } from 'vitest';
import { CredentialBroker } from './credential-broker.js';
import type { CiphertextStore } from './ciphertext-store.js';
const owner = { pluginId: 'test.keys', instanceId: 'default' };
it('reports namespace-bound presence without decrypting or exposing the secret', async () => {
  const values = new Map<string, Uint8Array>();
  const store: CiphertextStore = {
    async read(key) {
      return values.get(key) ?? null;
    },
    async write(key, bytes) {
      values.set(key, bytes);
    },
    async remove(key) {
      values.delete(key);
    },
  };
  const decrypt = vi.fn(async () => ({ plaintext: '', shouldReEncrypt: false }));
  const broker = new CredentialBroker({
    store,
    cipher: {
      async encrypt(value) {
        return new TextEncoder().encode(value);
      },
      decrypt,
    },
  });
  expect(await broker.hasSecret(owner, 'api-key')).toBe(false);
  await broker.setSecret(owner, 'api-key', 'fixture-only-secret');
  expect(await broker.hasSecret(owner, 'api-key')).toBe(true);
  expect(await broker.hasSecret({ ...owner, instanceId: 'other' }, 'api-key')).toBe(false);
  expect(decrypt).not.toHaveBeenCalled();
  await broker.deleteSecret(owner, 'api-key');
  expect(await broker.hasSecret(owner, 'api-key')).toBe(false);
  broker.dispose();
});
it('serializes presence reads behind a pending atomic credential write', async () => {
  let release!: () => void, started!: () => void;
  const writing = new Promise<void>((resolve) => {
      started = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  let stored: Uint8Array | null = null;
  const read = vi.fn(async () => stored);
  const store: CiphertextStore = {
    read,
    async write(_key, bytes) {
      started();
      await gate;
      stored = bytes;
    },
    async remove() {
      stored = null;
    },
  };
  const broker = new CredentialBroker({
    store,
    cipher: {
      async encrypt(value) {
        return new TextEncoder().encode(value);
      },
      async decrypt() {
        return { plaintext: '', shouldReEncrypt: false };
      },
    },
  });
  const pending = broker.setSecret(owner, 'api-key', 'fixture-value');
  await writing;
  const inspected = broker.hasSecret(owner, 'api-key');
  expect(read).not.toHaveBeenCalled();
  release();
  await pending;
  expect(await inspected).toBe(true);
  broker.dispose();
});
