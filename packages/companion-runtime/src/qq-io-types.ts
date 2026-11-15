import type { KernelError } from '@pet/contracts';

/** Host-private native IO outcome, returned only after actual IO settlement. */
export type QQIoOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: KernelError;
      /** True once the native send/fetch may have begun, not a remote delivery receipt. */
      readonly dispatched: boolean;
    };

/** A single scoped native byte reader; callers join settled even after cancellation. */
export interface QQMediaRead {
  readonly body: AsyncIterable<Uint8Array>;
  readonly settled: Promise<void>;
  cancel(): void;
}

/** Host-bound material ranges only. No path, URL, or alternate owner can be selected. */
export interface QQMediaSource {
  readonly name: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  open(offset: number, length: number, signal: AbortSignal): Promise<QQMediaRead>;
}

export type QQMediaConsumer = (
  chunk: Uint8Array,
  offset: number,
  signal: AbortSignal,
) => Promise<void>;
