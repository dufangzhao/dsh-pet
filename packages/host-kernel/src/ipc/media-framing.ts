import {
  makeError,
  MEDIA_MAX_CHUNK_BYTES,
  type KernelError,
  type MediaFrame,
  type Result,
  type StreamHeader,
} from '@pet/contracts';
import { validateMediaFrame, validateStreamHeader } from '@pet/contracts/validation';
export const MEDIA_HEADER_BYTES = 4096;
export const MEDIA_READ_CHUNK_BYTES = 1024 * 1024;
export function encodeMediaFrame(value: unknown): Result<Uint8Array> {
  const parsed = validateMediaFrame(value);
  if (!parsed.ok) return parsed;
  const header = Buffer.from(JSON.stringify(parsed.value.header), 'utf8');
  if (header.length > MEDIA_HEADER_BYTES)
    return { ok: false, error: makeError('invalid-input', false) };
  const output = Buffer.alloc(8 + header.length + parsed.value.payload.byteLength);
  output.writeUInt32BE(header.length, 0);
  output.writeUInt32BE(parsed.value.payload.byteLength, 4);
  header.copy(output, 8);
  output.set(parsed.value.payload, 8 + header.length);
  return { ok: true, value: output };
}
/** Incremental parser with one bounded in-progress frame. It never stores an unbounded input concat. */
export class MediaFrameDecoder {
  #prefix = Buffer.alloc(8);
  #prefixUsed = 0;
  #headerBytes: Buffer | undefined;
  #headerUsed = 0;
  #payload: Uint8Array | undefined;
  #payloadUsed = 0;
  #expectedPayload = 0;
  #header: StreamHeader | undefined;
  #error: KernelError | undefined;
  #ended = false;
  constructor(private readonly consume: (frame: MediaFrame) => Result<null>) {}
  feed(chunk: Uint8Array): Result<null> {
    if (this.#error) return { ok: false, error: this.#error };
    if (this.#ended) return { ok: false, error: makeError('not-ready', false) };
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > MEDIA_READ_CHUNK_BYTES)
      return this.fail('invalid-input');
    let offset = 0,
      frames = 0;
    try {
      while (offset < chunk.byteLength) {
        if (this.#error) return { ok: false, error: this.#error };
        if (this.#prefixUsed < 8) {
          const n = Math.min(8 - this.#prefixUsed, chunk.byteLength - offset);
          this.#prefix.set(chunk.subarray(offset, offset + n), this.#prefixUsed);
          offset += n;
          this.#prefixUsed += n;
          if (this.#prefixUsed < 8) continue;
          const length = this.#prefix.readUInt32BE(0);
          this.#expectedPayload = this.#prefix.readUInt32BE(4);
          if (
            length < 2 ||
            length > MEDIA_HEADER_BYTES ||
            this.#expectedPayload > MEDIA_MAX_CHUNK_BYTES
          )
            return this.fail('invalid-input');
          this.#headerBytes = Buffer.alloc(length);
        }
        if (!this.#header) {
          const bytes = this.#headerBytes!;
          const n = Math.min(bytes.length - this.#headerUsed, chunk.byteLength - offset);
          bytes.set(chunk.subarray(offset, offset + n), this.#headerUsed);
          offset += n;
          this.#headerUsed += n;
          if (this.#headerUsed < bytes.length) continue;
          const value: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          );
          const parsed = validateStreamHeader(value);
          if (!parsed.ok || parsed.value.byteLength !== this.#expectedPayload)
            return this.fail('invalid-input');
          this.#header = parsed.value;
          this.#payload = new Uint8Array(this.#expectedPayload);
        }
        const payload = this.#payload!;
        const n = Math.min(payload.byteLength - this.#payloadUsed, chunk.byteLength - offset);
        payload.set(chunk.subarray(offset, offset + n), this.#payloadUsed);
        offset += n;
        this.#payloadUsed += n;
        if (this.#payloadUsed < payload.byteLength) continue;
        if (++frames > 64) return this.fail('quota-exceeded');
        const accepted = this.consume({ header: this.#header, payload });
        if (this.#error) return { ok: false, error: this.#error };
        if (!accepted.ok) {
          this.#error = makeError(accepted.error.code, false);
          this.reset();
          return { ok: false, error: this.#error };
        }
        this.reset();
      }
      return { ok: true, value: null };
    } catch {
      return this.fail('invalid-input');
    }
  }
  end(): Result<null> {
    if (this.#error) return { ok: false, error: this.#error };
    if (this.#prefixUsed !== 0) return this.fail('invalid-input');
    this.#ended = true;
    return { ok: true, value: null };
  }
  private reset(): void {
    this.#prefix = Buffer.alloc(8);
    this.#prefixUsed = 0;
    this.#headerBytes = undefined;
    this.#headerUsed = 0;
    this.#payload = undefined;
    this.#payloadUsed = 0;
    this.#expectedPayload = 0;
    this.#header = undefined;
  }
  private fail(code: KernelError['code']): Result<null> {
    this.#error = makeError(code, false);
    this.reset();
    return { ok: false, error: this.#error };
  }
  abort(error: KernelError): void {
    if (!this.#error) this.#error = makeError(error.code, false);
    this.reset();
  }
  bufferedBytes(): number {
    return (
      this.#prefixUsed + (this.#headerBytes?.byteLength ?? 0) + (this.#payload?.byteLength ?? 0)
    );
  }
}
