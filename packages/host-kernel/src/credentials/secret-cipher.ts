/** Windows-only production adapter; the host injects Electron's actual safeStorage. */
export interface DecryptedSecret {
  readonly plaintext: string;
  readonly shouldReEncrypt: boolean;
}
export interface SecretCipher {
  encrypt(plaintext: string): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array): Promise<DecryptedSecret>;
}

export interface AsyncSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plaintext: string): Promise<Buffer>;
  decryptStringAsync(ciphertext: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export const MAX_CIPHERTEXT_BYTES = 128 * 1024;

export class SecretCipherUnavailable extends Error {
  constructor() {
    super('Credential encryption is unavailable');
    this.name = 'SecretCipherUnavailable';
  }
}

export function createSafeStorageCipher(
  api: AsyncSafeStorage,
  platform: NodeJS.Platform = process.platform,
): SecretCipher {
  // Other OS backends, including basic_text, have not been accepted by M0.
  if (
    platform !== 'win32' ||
    typeof api?.isAsyncEncryptionAvailable !== 'function' ||
    typeof api?.encryptStringAsync !== 'function' ||
    typeof api?.decryptStringAsync !== 'function'
  ) {
    throw new SecretCipherUnavailable();
  }
  return Object.freeze({
    async encrypt(plaintext: string): Promise<Uint8Array> {
      try {
        if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext, 'utf8') > 64 * 1024) {
          throw new SecretCipherUnavailable();
        }
        if (!(await api.isAsyncEncryptionAvailable())) throw new SecretCipherUnavailable();
        const encrypted = await api.encryptStringAsync(plaintext);
        if (
          !Buffer.isBuffer(encrypted) ||
          encrypted.byteLength === 0 ||
          encrypted.byteLength > MAX_CIPHERTEXT_BYTES
        ) {
          throw new SecretCipherUnavailable();
        }
        return Uint8Array.from(encrypted);
      } catch {
        // Never forward native exceptions, which may contain input or user paths.
        throw new SecretCipherUnavailable();
      }
    },
    async decrypt(ciphertext: Uint8Array): Promise<DecryptedSecret> {
      try {
        if (
          !(ciphertext instanceof Uint8Array) ||
          ciphertext.byteLength === 0 ||
          ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
        ) {
          throw new SecretCipherUnavailable();
        }
        if (!(await api.isAsyncEncryptionAvailable())) throw new SecretCipherUnavailable();
        const value = await api.decryptStringAsync(Buffer.from(ciphertext));
        if (
          !value ||
          typeof value.result !== 'string' ||
          typeof value.shouldReEncrypt !== 'boolean' ||
          Buffer.byteLength(value.result, 'utf8') > 64 * 1024
        ) {
          throw new SecretCipherUnavailable();
        }
        return Object.freeze({ plaintext: value.result, shouldReEncrypt: value.shouldReEncrypt });
      } catch {
        throw new SecretCipherUnavailable();
      }
    },
  });
}
