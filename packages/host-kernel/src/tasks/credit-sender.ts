import {
  makeError,
  MEDIA_MAX_CHUNKS_PER_STREAM,
  type KernelError,
  type MediaFrame,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import { validateMediaFrame, validateStreamHeader } from '@pet/contracts/validation';
import { sameOwner } from '../runtime/identity.js';
export class CreditMediaSender {
  #credits = 0;
  #debt = 0;
  #window = 0;
  #sequence = 0;
  #writing = false;
  #error: KernelError | undefined;
  #ended = false;
  #detach: (() => void) | undefined;
  readonly #waiters = new Set<() => void>();
  readonly #identity: { streamId: string; taskId: string; owner: OwnerRef };
  constructor(
    identity: { streamId: string; taskId: string; owner: OwnerRef },
    private readonly write: (frame: MediaFrame) => Promise<Result<null>>,
    signal: AbortSignal,
  ) {
    const header = validateStreamHeader({ ...identity, sequence: 0, byteLength: 0 });
    if (!header.ok) throw new Error('Invalid stream identity');
    this.#identity = {
      streamId: header.value.streamId,
      taskId: header.value.taskId,
      owner: Object.freeze({ ...header.value.owner }),
    };
    const abort = () => this.cancel();
    if (signal.aborted) this.cancel();
    else {
      signal.addEventListener('abort', abort, { once: true });
      this.#detach = () => signal.removeEventListener('abort', abort);
    }
  }
  grant(credits: number): Result<null> {
    if (this.#error) return { ok: false, error: this.#error };
    if (this.#ended) return { ok: false, error: makeError('not-ready', false) };
    if (!Number.isSafeInteger(credits) || credits < 1 || credits > MEDIA_MAX_CHUNKS_PER_STREAM)
      return { ok: false, error: makeError('invalid-input', false) };
    if (!this.#window) {
      this.#window = credits;
      this.#credits = credits;
    } else {
      if (credits > this.#debt || this.#credits + credits > this.#window)
        return { ok: false, error: makeError('invalid-input', false) };
      this.#credits += credits;
      this.#debt -= credits;
    }
    this.wake();
    return { ok: true, value: null };
  }
  async send(input: unknown): Promise<Result<null>> {
    if (this.#error) return { ok: false, error: this.#error };
    if (this.#ended) return { ok: false, error: makeError('not-ready', false) };
    const parsed = validateMediaFrame(input);
    if (!parsed.ok) return parsed;
    const frame = parsed.value;
    if (
      frame.header.streamId !== this.#identity.streamId ||
      frame.header.taskId !== this.#identity.taskId ||
      !sameOwner(frame.header.owner, this.#identity.owner) ||
      frame.header.sequence !== this.#sequence
    )
      return { ok: false, error: makeError('invalid-input', false) };
    if (!this.#credits || this.#writing)
      return { ok: false, error: makeError('quota-exceeded', true) };
    this.#credits--;
    this.#debt++;
    this.#sequence++;
    this.#writing = true;
    try {
      const result = await this.write(frame);
      if (!result.ok) this.cancel(result.error);
      return this.#error ? { ok: false, error: this.#error } : result;
    } catch {
      this.cancel(makeError('unavailable', false));
      return { ok: false, error: this.#error! };
    } finally {
      this.#writing = false;
      this.wake();
    }
  }
  waitWritable(signal?: AbortSignal): Promise<Result<null>> {
    return this.wait(false, signal);
  }
  drain(signal?: AbortSignal): Promise<Result<null>> {
    return this.wait(true, signal);
  }
  private wait(drain: boolean, signal?: AbortSignal): Promise<Result<null>> {
    const state = (): Result<null> | null =>
      this.#error
        ? { ok: false, error: this.#error }
        : this.#ended
          ? { ok: false, error: makeError('not-ready', false) }
          : signal?.aborted
            ? { ok: false, error: makeError('cancelled', false) }
            : !this.#writing && (drain ? this.#debt === 0 : this.#credits > 0)
              ? { ok: true, value: null }
              : null;
    const initial = state();
    if (initial) return Promise.resolve(initial);
    if (this.#waiters.size >= 8)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded', true) });
    return new Promise((resolve) => {
      const check = () => {
        const result = state();
        if (result) {
          this.#waiters.delete(check);
          signal?.removeEventListener('abort', check);
          resolve(result);
        }
      };
      this.#waiters.add(check);
      signal?.addEventListener('abort', check, { once: true });
    });
  }
  end(): Result<number> {
    if (this.#error) return { ok: false, error: this.#error };
    if (this.#ended || !this.#window || this.#writing || this.#debt)
      return { ok: false, error: makeError('not-ready', false) };
    this.#ended = true;
    this.#detach?.();
    this.#detach = undefined;
    this.wake();
    return { ok: true, value: this.#sequence };
  }
  cancel(error: KernelError = makeError('cancelled', false)): void {
    if (this.#error || this.#ended) return;
    this.#error = makeError(error.code, false);
    this.#detach?.();
    this.#detach = undefined;
    this.wake();
  }
  private wake(): void {
    for (const notify of [...this.#waiters]) notify();
  }
  snapshot() {
    return {
      credits: this.#credits,
      unacknowledged: this.#debt,
      nextSequence: this.#sequence,
      writing: this.#writing,
      waiters: this.#waiters.size,
      ended: this.#ended,
    };
  }
}
