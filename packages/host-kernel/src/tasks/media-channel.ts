import {
  makeError,
  MEDIA_MAX_CHUNK_BYTES,
  MEDIA_MAX_CHUNKS_PER_STREAM,
  MEDIA_MAX_STREAM_BYTES,
  type KernelError,
  type MediaFrame,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import { validateMediaFrame, validateStreamHeader } from '@pet/contracts/validation';
import { sameOwner } from '../runtime/identity.js';
export class MediaChannelError extends Error {
  constructor(readonly error: KernelError) {
    super(error.messageKey);
    this.name = 'MediaChannelError';
  }
}
interface Waiter {
  bytes: number;
  resolve: (result: Result<null>) => void;
  remove: () => void;
}
export class BoundedMediaChannel implements AsyncIterable<MediaFrame> {
  readonly #queue: MediaFrame[] = [];
  readonly #waiters = new Set<Waiter>();
  #bytes = 0;
  #next = 0;
  #closed = false;
  #finished = false;
  #error: KernelError | undefined;
  #reader: ((result: IteratorResult<MediaFrame>) => void) | undefined;
  #rejectReader: ((error: Error) => void) | undefined;
  #claimed = false;
  #detach: (() => void) | undefined;
  readonly #identity: { streamId: string; taskId: string; owner: OwnerRef };
  constructor(
    identity: { streamId: string; taskId: string; owner: OwnerRef },
    private readonly live: (owner: OwnerRef) => boolean = () => false,
    signal?: AbortSignal,
  ) {
    const checked = validateStreamHeader({ ...identity, sequence: 0, byteLength: 0 });
    if (!checked.ok) throw new MediaChannelError(checked.error);
    this.#identity = Object.freeze({
      streamId: checked.value.streamId,
      taskId: checked.value.taskId,
      owner: Object.freeze({ ...checked.value.owner }),
    });
    if (signal) {
      const abort = () => this.cancel();
      if (signal.aborted) this.cancel();
      else {
        signal.addEventListener('abort', abort, { once: true });
        this.#detach = () => signal.removeEventListener('abort', abort);
      }
    }
  }
  private valid(): boolean {
    try {
      return this.live(this.#identity.owner) === true;
    } catch {
      return false;
    }
  }
  private capacity(bytes: number): boolean {
    return (
      this.#queue.length < MEDIA_MAX_CHUNKS_PER_STREAM &&
      this.#bytes + bytes <= MEDIA_MAX_STREAM_BYTES
    );
  }
  push(input: unknown): Result<null> {
    if (this.#error) return { ok: false, error: this.#error };
    if (this.#closed) return { ok: false, error: makeError('not-ready', false) };
    if (!this.valid()) return { ok: false, error: makeError('stale-owner', false) };
    const checked = validateMediaFrame(input);
    if (!checked.ok) return checked;
    const frame = checked.value;
    if (
      frame.header.streamId !== this.#identity.streamId ||
      frame.header.taskId !== this.#identity.taskId ||
      !sameOwner(frame.header.owner, this.#identity.owner) ||
      frame.header.sequence !== this.#next
    )
      return { ok: false, error: makeError('invalid-input', false) };
    if (!this.capacity(frame.header.byteLength))
      return { ok: false, error: makeError('quota-exceeded', true) };
    this.#next++;
    if (this.#reader) {
      const resolve = this.#reader;
      this.#reader = undefined;
      this.#rejectReader = undefined;
      resolve({ done: false, value: frame });
    } else {
      this.#queue.push(frame);
      this.#bytes += frame.header.byteLength;
    }
    return { ok: true, value: null };
  }
  waitWritable(bytes: number, signal?: AbortSignal): Promise<Result<null>> {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MEDIA_MAX_CHUNK_BYTES)
      return Promise.resolve({ ok: false, error: makeError('invalid-input', false) });
    if (this.#error) return Promise.resolve({ ok: false, error: this.#error });
    if (this.#closed) return Promise.resolve({ ok: false, error: makeError('not-ready', false) });
    if (signal?.aborted)
      return Promise.resolve({ ok: false, error: makeError('cancelled', false) });
    if (!this.valid())
      return Promise.resolve({ ok: false, error: makeError('stale-owner', false) });
    if (this.capacity(bytes)) return Promise.resolve({ ok: true, value: null });
    if (this.#waiters.size >= 8)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded', true) });
    return new Promise((resolve) => {
      const waiter: Waiter = {
        bytes,
        resolve,
        remove: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        this.#waiters.delete(waiter);
        waiter.remove();
        resolve({ ok: false, error: makeError('cancelled', false) });
      };
      this.#waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  close(sequence: number): Result<null> {
    if (this.#error) return { ok: false, error: this.#error };
    if (this.#closed || sequence !== this.#next)
      return { ok: false, error: makeError('invalid-input', false) };
    if (!this.valid()) {
      this.cancel(makeError('stale-owner', false));
      return { ok: false, error: this.#error! };
    }
    this.#closed = true;
    this.wake();
    if (!this.#queue.length) this.finishNormal();
    if (!this.#queue.length && this.#reader) {
      this.#reader({ done: true, value: undefined });
      this.#reader = undefined;
      this.#rejectReader = undefined;
    }
    return { ok: true, value: null };
  }
  cancel(error: KernelError = makeError('cancelled', false)): void {
    if (this.#error || this.#finished) return;
    this.#detach?.();
    this.#detach = undefined;
    this.#error = makeError(error.code, false);
    this.#closed = true;
    this.#queue.length = 0;
    this.#bytes = 0;
    this.#rejectReader?.(new MediaChannelError(this.#error));
    this.#reader = undefined;
    this.#rejectReader = undefined;
    this.wake();
  }
  private finishNormal(): void {
    this.#finished = true;
    this.#detach?.();
    this.#detach = undefined;
  }
  private wake(): void {
    for (const waiter of [...this.#waiters]) {
      const result: Result<null> | null = this.#error
        ? { ok: false, error: this.#error }
        : this.#closed
          ? { ok: false, error: makeError('not-ready', false) }
          : this.capacity(waiter.bytes)
            ? { ok: true, value: null }
            : null;
      if (result) {
        this.#waiters.delete(waiter);
        waiter.remove();
        waiter.resolve(result);
      }
    }
  }
  private next(): Promise<IteratorResult<MediaFrame>> {
    if (this.#finished && !this.#error) return Promise.resolve({ done: true, value: undefined });
    if (!this.valid() && !this.#error) this.cancel(makeError('stale-owner', false));
    if (this.#error) return Promise.reject(new MediaChannelError(this.#error));
    const frame = this.#queue.shift();
    if (frame) {
      this.#bytes -= frame.header.byteLength;
      this.wake();
      if (this.#closed && !this.#queue.length) this.finishNormal();
      return Promise.resolve({ done: false, value: frame });
    }
    if (this.#closed) {
      this.#detach?.();
      this.#detach = undefined;
      return Promise.resolve({ done: true, value: undefined });
    }
    if (this.#reader)
      return Promise.reject(new MediaChannelError(makeError('invalid-input', false)));
    return new Promise((resolve, reject) => {
      this.#reader = resolve;
      this.#rejectReader = reject;
    });
  }
  [Symbol.asyncIterator](): AsyncIterator<MediaFrame> {
    if (this.#claimed) throw new MediaChannelError(makeError('invalid-input', false));
    this.#claimed = true;
    return {
      next: () => this.next(),
      return: async () => {
        this.cancel();
        return { done: true, value: undefined };
      },
    };
  }
  snapshot(): {
    queuedChunks: number;
    queuedBytes: number;
    nextSequence: number;
    closed: boolean;
    waiters: number;
  } {
    return {
      queuedChunks: this.#queue.length,
      queuedBytes: this.#bytes,
      nextSequence: this.#next,
      closed: this.#closed,
      waiters: this.#waiters.size,
    };
  }
}
