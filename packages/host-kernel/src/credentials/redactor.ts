import { types } from 'node:util';

/** Secondary defence for known secrets, not a general content/DLP filter. */
export class SecretRedactor {
  readonly #values = new Set<string>();
  #bytes = 0;
  #maxPatternBytes = 0;

  add(secret: string): void {
    if (
      !secret ||
      Buffer.byteLength(secret, 'utf8') > 16 * 1024 ||
      Buffer.from(secret, 'utf8').toString('utf8') !== secret
    ) {
      throw new Error('Secret redaction registration refused');
    }
    const additions = [
      ...new Set([
        secret,
        encodeURIComponent(secret),
        Buffer.from(secret, 'utf8').toString('base64'),
      ]),
    ].filter((value) => !this.#values.has(value));
    const extra = additions.reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0);
    if (this.#bytes + extra > 256 * 1024) throw new Error('Secret redaction capacity exceeded');
    for (const value of additions) {
      this.#values.add(value);
      this.#maxPatternBytes = Math.max(this.#maxPatternBytes, Buffer.byteLength(value, 'utf8'));
    }
    this.#bytes += extra;
  }

  contains(text: string): boolean {
    for (const value of this.#values) if (text.includes(value)) return true;
    return false;
  }
  containsBytes(bytes: Uint8Array): boolean {
    const value = Buffer.from(bytes);
    for (const pattern of this.#values)
      if (value.includes(Buffer.from(pattern, 'utf8'))) return true;
    return false;
  }
  get maxPatternBytes(): number {
    return this.#maxPatternBytes;
  }
  redact(value: unknown): string {
    try {
      let text: string;
      if (typeof value === 'string') text = value;
      else if (types.isNativeError(value) && !types.isProxy(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, 'message');
        text =
          descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
            ? descriptor.value
            : '[non-text error]';
      } else return '[non-text diagnostic]';
      // Do not truncate an unknown fragment of a secret into a log, or rescan replacement markers.
      if (text.length > 8192) return '[oversized diagnostic omitted]';
      for (const secret of this.#values) if (text.includes(secret)) return '[REDACTED diagnostic]';
      return text;
    } catch {
      return '[diagnostic unavailable]';
    }
  }

  clear(): void {
    this.#values.clear();
    this.#bytes = 0;
    this.#maxPatternBytes = 0;
    // JS strings cannot be guaranteed to be securely erased from the heap.
  }
}
