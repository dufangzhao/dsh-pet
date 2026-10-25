import type { SafeStorage } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  createSafeStorageCipher,
  MAX_CIPHERTEXT_BYTES,
  SecretCipherUnavailable,
  type AsyncSafeStorage,
} from './secret-cipher.js';
function nativeTypeCheck(api: SafeStorage): AsyncSafeStorage {
  return api;
}
const available = async () => true;
const decoded = (result = 'public-fixture', shouldReEncrypt = false) => ({
  result,
  shouldReEncrypt,
});

describe('asynchronous safeStorage boundary', () => {
  it('matches the locked Electron native type', () => {
    expect(nativeTypeCheck).toBeTypeOf('function');
  });
  it('uses only async APIs and copies input/output buffers', async () => {
    const encrypted = Buffer.from([1, 2, 3]);
    let received: Buffer | undefined;
    const api = {
      isAsyncEncryptionAvailable: available,
      encryptStringAsync: vi.fn(async () => encrypted),
      decryptStringAsync: vi.fn(async (value: Buffer) => {
        received = value;
        return decoded();
      }),
    };
    const cipher = createSafeStorageCipher(api, 'win32');
    const output = await cipher.encrypt('public-fixture');
    encrypted[0] = 99;
    expect(output[0]).toBe(1);
    expect(await cipher.decrypt(output)).toEqual({
      plaintext: 'public-fixture',
      shouldReEncrypt: false,
    });
    expect(received).not.toBe(output);
    expect(api.encryptStringAsync).toHaveBeenCalledTimes(1);
    expect(api.decryptStringAsync).toHaveBeenCalledTimes(1);
  });
  it('does not accept an unverified OS or missing async methods', () => {
    const api = {
      isAsyncEncryptionAvailable: available,
      encryptStringAsync: async () => Buffer.from([1]),
      decryptStringAsync: async () => decoded(),
    };
    expect(() => createSafeStorageCipher(api, 'linux')).toThrow(SecretCipherUnavailable);
    expect(() => createSafeStorageCipher({} as never, 'win32')).toThrow(SecretCipherUnavailable);
  });
  it('sanitizes native errors instead of echoing secrets or paths', async () => {
    const api = {
      isAsyncEncryptionAvailable: available,
      encryptStringAsync: async () => {
        throw new Error('private-fixture-token C:/private');
      },
      decryptStringAsync: async () => {
        throw new Error('private-fixture-token C:/private');
      },
    };
    const cipher = createSafeStorageCipher(api, 'win32');
    await expect(cipher.encrypt('private-fixture-token')).rejects.toThrow(
      'Credential encryption is unavailable',
    );
    await expect(cipher.decrypt(new Uint8Array([1]))).rejects.toThrow(
      'Credential encryption is unavailable',
    );
  });
  it('rejects invalid sizes before invoking native crypto', async () => {
    const api = {
      isAsyncEncryptionAvailable: available,
      encryptStringAsync: vi.fn(async () => Buffer.from([1])),
      decryptStringAsync: vi.fn(async () => decoded()),
    };
    const cipher = createSafeStorageCipher(api, 'win32');
    await expect(cipher.decrypt(new Uint8Array())).rejects.toThrow(SecretCipherUnavailable);
    await expect(cipher.decrypt(new Uint8Array(MAX_CIPHERTEXT_BYTES + 1))).rejects.toThrow(
      SecretCipherUnavailable,
    );
    await expect(cipher.encrypt('x'.repeat(65537))).rejects.toThrow(SecretCipherUnavailable);
    expect(api.decryptStringAsync).not.toHaveBeenCalled();
    expect(api.encryptStringAsync).not.toHaveBeenCalled();
  });
  it('fails closed when OS encryption is unavailable', async () => {
    const api = {
      isAsyncEncryptionAvailable: async () => false,
      encryptStringAsync: vi.fn(async () => Buffer.from([1])),
      decryptStringAsync: vi.fn(async () => decoded()),
    };
    const cipher = createSafeStorageCipher(api, 'win32');
    await expect(cipher.encrypt('fixture')).rejects.toThrow(SecretCipherUnavailable);
    await expect(cipher.decrypt(new Uint8Array([1]))).rejects.toThrow(SecretCipherUnavailable);
    expect(api.encryptStringAsync).not.toHaveBeenCalled();
    expect(api.decryptStringAsync).not.toHaveBeenCalled();
  });
  it('preserves the native re-encryption signal', async () => {
    const cipher = createSafeStorageCipher(
      {
        isAsyncEncryptionAvailable: available,
        encryptStringAsync: async () => Buffer.from([1]),
        decryptStringAsync: async () => decoded('fixture', true),
      },
      'win32',
    );
    expect(await cipher.decrypt(new Uint8Array([1]))).toEqual({
      plaintext: 'fixture',
      shouldReEncrypt: true,
    });
  });
  it('rejects malformed native output', async () => {
    const cipher = createSafeStorageCipher(
      {
        isAsyncEncryptionAvailable: available,
        encryptStringAsync: async () => Buffer.alloc(0),
        decryptStringAsync: async () => decoded('x'.repeat(65537)),
      },
      'win32',
    );
    await expect(cipher.encrypt('fixture')).rejects.toThrow(SecretCipherUnavailable);
    await expect(cipher.decrypt(new Uint8Array([1]))).rejects.toThrow(SecretCipherUnavailable);
  });
});
