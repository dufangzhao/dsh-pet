import type { Duplex } from 'node:stream';
import { makeError, type KernelError, type MediaFrame, type Result } from '@pet/contracts';
import { encodeMediaFrame, MediaFrameDecoder } from './media-framing.js';
export class FramedMediaPort {
  readonly #decoder: MediaFrameDecoder;
  #closed = false;
  #writing = false;
  readonly #detach: Array<() => void> = [];
  #resolveWrite: ((result: Result<null>) => void) | undefined;
  constructor(
    private readonly stream: Duplex,
    onFrame: (frame: MediaFrame) => Result<null>,
    private readonly onClose: (error: KernelError) => void,
  ) {
    this.#decoder = new MediaFrameDecoder(onFrame);
    const data = (chunk: Buffer) => {
      const result = this.#decoder.feed(chunk);
      if (!result.ok) this.close(result.error);
    };
    const end = () => {
      const result = this.#decoder.end();
      this.close(result.ok ? makeError('unavailable', false) : result.error);
    };
    const error = () => this.close(makeError('unavailable', false));
    stream.on('data', data);
    stream.on('end', end);
    stream.on('close', error);
    stream.on('error', error);
    this.#detach.push(() => {
      stream.off('data', data);
      stream.off('end', end);
      stream.off('close', error);
      stream.off('error', error);
    });
  }
  write(frame: unknown): Promise<Result<null>> {
    if (this.#closed) return Promise.resolve({ ok: false, error: makeError('unavailable', false) });
    if (this.#writing)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded', true) });
    const encoded = encodeMediaFrame(frame);
    if (!encoded.ok) return Promise.resolve(encoded);
    this.#writing = true;
    return new Promise((resolve) => {
      this.#resolveWrite = resolve;
      try {
        this.stream.write(encoded.value, (error) => {
          if (!this.#resolveWrite) return;
          const done = this.#resolveWrite;
          this.#resolveWrite = undefined;
          this.#writing = false;
          if (error) {
            done({ ok: false, error: makeError('unavailable', false) });
            this.close(makeError('unavailable', false));
          } else done({ ok: true, value: null });
        });
      } catch {
        this.close(makeError('unavailable', false));
      }
    });
  }
  close(error: KernelError = makeError('unavailable', false)): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#decoder.abort(error);
    for (const detach of this.#detach.splice(0)) detach();
    this.#resolveWrite?.({ ok: false, error: makeError(error.code, false) });
    this.#resolveWrite = undefined;
    this.#writing = false;
    this.stream.destroy();
    try {
      this.onClose(makeError(error.code, false));
    } catch {
      /* metadata-only closure */
    }
  }
  snapshot(): { closed: boolean; writing: boolean; bufferedBytes: number } {
    return {
      closed: this.#closed,
      writing: this.#writing,
      bufferedBytes: this.#decoder.bufferedBytes(),
    };
  }
}
