/** Ciphertext-only persistence port. Implementations must copy buffers and commit atomically. */
export interface CiphertextStore {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, ciphertext: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Deterministic adapter for contract tests; not a persistent production vault. */
export class MemoryCiphertextStore implements CiphertextStore {
  readonly #records = new Map<string, Uint8Array>();

  async read(key: string): Promise<Uint8Array | null> {
    const value = this.#records.get(key);
    return value ? Uint8Array.from(value) : null;
  }

  async write(key: string, ciphertext: Uint8Array): Promise<void> {
    this.#records.set(key, Uint8Array.from(ciphertext));
  }

  async remove(key: string): Promise<void> {
    this.#records.delete(key);
  }
}
