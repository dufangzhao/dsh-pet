import { randomUUID } from 'node:crypto';
import {
  COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE,
  makeError,
  type KernelError,
  type Result,
} from '@pet/contracts';
import type { QQMediaConsumer } from '@pet/companion-runtime';
import { downloadSnowMedia, snowStagedSend, uploadSnowMedia } from './media.js';
import { SNOW_MEDIA_ECHO_PREFIX } from './media-wire.js';
import type {
  SnowDownloadedMedia,
  SnowMediaDownloadInput,
  SnowMediaLookup,
  SnowMediaOutcome,
  SnowMediaUploadInput,
  SnowStagedMedia,
} from './media-types.js';
import { KernelFault } from '@pet/host-kernel';
import type { OneBotDriverObserver, OneBotDriverStatus, OneBotIo, OneBotPeer } from './ports.js';
import {
  decodeOneBotFrame,
  encodeOneBotAction,
  type OneBotAction,
  type OneBotActionFrame,
  type OneBotResponse,
} from './wire.js';

export interface OneBotDriverOptions {
  readonly requestTimeoutMs?: number;
  readonly maxPending?: number;
}
export type OneBotCallOutcome =
  | {
      readonly kind: 'response';
      readonly connectionId: string;
      readonly echo: string;
      readonly response: OneBotResponse;
    }
  | {
      readonly kind: 'unknown';
      readonly connectionId: string;
      readonly echo: string;
      readonly error: KernelError;
    };
interface Epoch {
  readonly peer: OneBotPeer;
  readonly abort: AbortController;
  readonly signal: AbortSignal;
  readonly operationAbort: AbortController;
  readonly operationSignal: AbortSignal;
  readonly mediaNonce: string;
  mediaSequence: number;
}
interface Pending {
  readonly epoch: Epoch;
  response: OneBotResponse | null;
  finish(outcome: OneBotCallOutcome): void;
}
function safeError(error: unknown, fallback: KernelError['code'] = 'network'): KernelError {
  return error instanceof KernelFault ? error.error : makeError(fallback, false);
}
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new KernelFault('invalid-input');
  return number;
}

/** One authenticated reverse Universal peer at a time; this driver never opens a QQ login client. */
export class OneBotQqDriver {
  private readonly abort = new AbortController();
  private readonly pending = new Map<string, Pending>();
  private readonly operations = new Set<Promise<unknown>>();
  private mediaOperations = 0;
  private readonly stagedMedia = new WeakSet<SnowStagedMedia>();
  private readonly echoPrefix = `qq-${randomUUID()}`;
  private readonly requestTimeoutMs: number;
  private readonly maxPending: number;
  private sequence = 0;
  private current: Epoch | null = null;
  private running: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private ioClosing: Promise<void> | null = null;
  private cleanupError: unknown;
  private stopped = false;
  private statusValue: OneBotDriverStatus = { phase: 'idle', connectionId: null, error: null };

  constructor(
    private readonly expectedSelfId: string,
    private readonly io: OneBotIo,
    private readonly observer: OneBotDriverObserver,
    options: OneBotDriverOptions = {},
  ) {
    if (!/^[1-9]\d{0,19}$/u.test(expectedSelfId)) throw new KernelFault('invalid-input');
    this.requestTimeoutMs = bounded(options.requestTimeoutMs, 30_000, 1, 300_000);
    this.maxPending = bounded(options.maxPending, 32, 1, 128);
  }
  get status(): OneBotDriverStatus {
    return { ...this.statusValue };
  }
  get pendingCount(): number {
    return this.pending.size;
  }
  start(signal: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped || signal.aborted) return Promise.reject(new KernelFault('cancelled'));
    this.running = this.run(AbortSignal.any([signal, this.abort.signal]));
    void this.running.catch(() => {});
    return this.running;
  }
  private publish(phase: OneBotDriverStatus['phase'], error: KernelError | null = null): void {
    this.statusValue = { phase, error, connectionId: this.current?.peer.id ?? null };
    this.observer.onStatus(this.status);
  }
  private closeIo(): Promise<void> {
    this.ioClosing ??= Promise.resolve()
      .then(() => this.io.close())
      .catch((error: unknown) => {
        this.cleanupError = error;
        throw error;
      });
    return this.ioClosing;
  }
  /** Cleanup failure is retained separately from an ordinary connection/call failure. */
  private async drain(work: readonly Promise<unknown>[]): Promise<void> {
    const results = await Promise.allSettled(work);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      this.cleanupError ??= failure.reason;
      throw failure.reason;
    }
  }
  private async run(signal: AbortSignal): Promise<void> {
    const abortIo = (): void => {
      void this.closeIo().catch(() => {});
    };
    signal.addEventListener('abort', abortIo, { once: true });
    try {
      while (!signal.aborted) {
        this.publish('waiting');
        signal.throwIfAborted();
        const peer = await this.io.nextPeer(signal);
        const abort = new AbortController();
        const operationAbort = new AbortController();
        const live = AbortSignal.any([signal, abort.signal, peer.signal]);
        const epoch: Epoch = {
          peer,
          abort,
          signal: live,
          operationAbort,
          operationSignal: AbortSignal.any([live, operationAbort.signal]),
          mediaNonce: randomUUID(),
          mediaSequence: 0,
        };
        this.current = epoch;
        try {
          await this.serve(epoch);
        } finally {
          this.current = null;
        }
        if (!signal.aborted) this.publish('offline', makeError('network', false));
      }
    } catch (error) {
      if (!signal.aborted || this.cleanupError !== undefined) {
        this.publish('failed', safeError(error));
        throw error;
      }
    } finally {
      signal.removeEventListener('abort', abortIo);
      this.current = null;
      await this.drain([this.closeIo(), ...this.operations]);
      if (signal.aborted) this.publish('stopped');
    }
  }
  private async serve(epoch: Epoch): Promise<void> {
    const { peer, signal } = epoch;
    let closing: Promise<void> | null = null;
    const retire = (): Promise<void> => {
      epoch.operationAbort.abort(new KernelFault('stale-owner'));
      closing ??= this.drain([Promise.resolve().then(() => peer.close()), peer.settled]);
      return closing;
    };
    const stop = (): void => {
      void retire().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    const iterator = peer.frames[Symbol.asyncIterator]();
    try {
      if (signal.aborted) return;
      if (peer.selfId !== this.expectedSelfId) throw new KernelFault('auth-failed');
      if (!peer.id) throw new KernelFault('invalid-input');
      this.publish('ready');
      while (!signal.aborted) {
        const next = await iterator.next();
        if (next.done || signal.aborted || this.current !== epoch) break;
        const decoded = decodeOneBotFrame(next.value, this.expectedSelfId);
        if (!decoded.ok) throw new KernelFault(decoded.error.code);
        const frame = decoded.value;
        if (frame.kind === 'response') {
          const request = this.pending.get(frame.echo);
          if (request?.epoch === epoch && request.response === null) {
            request.response = frame;
            request.finish({
              kind: 'response',
              connectionId: peer.id,
              echo: frame.echo,
              response: frame,
            });
          }
          // Unknown/late/duplicate echoes cannot settle a different operation.
        } else await this.observer.onEvent(frame, peer.id, epoch.operationSignal);
      }
    } finally {
      epoch.abort.abort(new KernelFault('network'));
      signal.removeEventListener('abort', stop);
      for (const [echo, request] of this.pending) {
        if (request.epoch === epoch)
          request.finish({
            kind: 'unknown',
            connectionId: peer.id,
            echo,
            error: makeError(this.abort.signal.aborted ? 'cancelled' : 'network', false),
          });
      }
      await this.drain([retire(), Promise.resolve().then(() => iterator.return?.())]);
    }
  }
  /** One call on the caller's captured connection, one fresh echo; never refresh the ID after awaits. */
  call(
    action: OneBotAction,
    params: unknown,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<Result<OneBotCallOutcome>> {
    const epoch = this.current;
    if (this.stopped || signal.aborted)
      return Promise.resolve({ ok: false, error: makeError('cancelled', false) });
    if (typeof expectedConnectionId !== 'string' || !expectedConnectionId)
      return Promise.resolve({ ok: false, error: makeError('invalid-input', false) });
    if (!epoch || epoch.peer.id !== expectedConnectionId || epoch.operationSignal.aborted)
      return Promise.resolve({ ok: false, error: makeError('stale-owner', false) });
    if (this.statusValue.phase !== 'ready')
      return Promise.resolve({ ok: false, error: makeError('not-ready', false) });
    if (this.pending.size >= this.maxPending || this.sequence >= Number.MAX_SAFE_INTEGER)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded', false) });
    const echo = `${this.echoPrefix}-${++this.sequence}`;
    const frame = encodeOneBotAction(action, params, echo);
    if (!frame.ok) return Promise.resolve(frame);
    const segments = frame.value.params['message'];
    if (
      Array.isArray(segments) &&
      segments.length !== 1 &&
      segments.some(
        (segment) =>
          typeof segment === 'object' &&
          segment !== null &&
          !Array.isArray(segment) &&
          segment['type'] === 'file',
      )
    )
      return Promise.resolve({ ok: false, error: makeError('invalid-input', false) });
    const operation = this.perform(epoch, frame.value, signal);
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }
  private async perform(
    epoch: Epoch,
    frame: OneBotActionFrame,
    callerSignal: AbortSignal,
  ): Promise<Result<OneBotCallOutcome>> {
    const abort = new AbortController();
    const signal = AbortSignal.any([epoch.operationSignal, callerSignal, abort.signal]);
    let finished = false;
    let handedToIo = false;
    let resolve: (outcome: OneBotCallOutcome) => void = () => {};
    const response = new Promise<OneBotCallOutcome>((done) => {
      resolve = done;
    });
    const unknown = (error: KernelError): OneBotCallOutcome => ({
      kind: 'unknown',
      connectionId: epoch.peer.id,
      echo: frame.echo,
      error,
    });
    const pending: Pending = {
      epoch,
      response: null,
      finish: (outcome) => {
        if (!finished) {
          finished = true;
          resolve(outcome);
        }
      },
    };
    this.pending.set(frame.echo, pending);
    const cancelled = (): void => {
      pending.finish(unknown(safeError(signal.reason, 'cancelled')));
    };
    signal.addEventListener('abort', cancelled, { once: true });
    const timer = setTimeout(() => abort.abort(new KernelFault('timeout')), this.requestTimeoutMs);
    const known = (): OneBotCallOutcome | null =>
      pending.response === null
        ? null
        : {
            kind: 'response',
            connectionId: epoch.peer.id,
            echo: frame.echo,
            response: pending.response,
          };
    try {
      await Promise.resolve();
      if (signal.aborted) return { ok: false, error: makeError('cancelled', false) };
      handedToIo = true;
      // Join physical write settlement even if the response watchdog/caller has already aborted.
      const write = await epoch.peer.send(frame, signal);
      if (!write.ok) {
        if (!write.dispatched) return { ok: false, error: write.error };
        pending.finish(unknown(write.error));
      }
      return { ok: true, value: known() ?? (await response) };
    } catch (error) {
      const failure = safeError(error, signal.aborted ? 'cancelled' : 'network');
      pending.finish(unknown(failure));
      return handedToIo
        ? { ok: true, value: known() ?? (await response) }
        : { ok: false, error: failure };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      if (this.pending.get(frame.echo) === pending) this.pending.delete(frame.echo);
    }
  }
  private media<T>(
    expectedConnectionId: string,
    signal: AbortSignal,
    run: (epoch: Epoch, live: AbortSignal, echo: () => string) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    const epoch = this.current;
    if (this.stopped || signal.aborted)
      return Promise.resolve({ ok: false, error: makeError('cancelled', false) });
    if (
      !expectedConnectionId ||
      !epoch ||
      epoch.peer.id !== expectedConnectionId ||
      epoch.operationSignal.aborted
    )
      return Promise.resolve({ ok: false, error: makeError('stale-owner', false) });
    if (this.statusValue.phase !== 'ready' || typeof epoch.peer.openMedia !== 'function')
      return Promise.resolve({ ok: false, error: makeError('not-ready', false) });
    if (this.mediaOperations >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded', false) });
    const nextEcho = (): string => {
      if (epoch.operationSignal.aborted || this.current !== epoch)
        throw new KernelFault('stale-owner');
      if (epoch.mediaSequence >= Number.MAX_SAFE_INTEGER) throw new KernelFault('quota-exceeded');
      return `${SNOW_MEDIA_ECHO_PREFIX}${epoch.mediaNonce}:${++epoch.mediaSequence}`;
    };
    this.mediaOperations++;
    const work = Promise.resolve()
      .then(() => run(epoch, AbortSignal.any([epoch.operationSignal, signal]), nextEcho))
      .finally(() => {
        this.mediaOperations--;
      });
    this.operations.add(work);
    void work.finally(() => this.operations.delete(work)).catch(() => {});
    return work;
  }
  uploadMedia(
    input: SnowMediaUploadInput,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<Result<SnowMediaOutcome<SnowStagedMedia>>> {
    return this.media(expectedConnectionId, signal, async (epoch, live, echo) => {
      const result = await uploadSnowMedia(epoch.peer, input, epoch.peer.id, echo, live);
      if (result.ok && result.value.kind === 'complete')
        this.stagedMedia.add(Object.freeze(result.value.value));
      return result;
    });
  }
  downloadMedia(
    input: SnowMediaDownloadInput,
    consumer: QQMediaConsumer,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<Result<SnowMediaOutcome<SnowDownloadedMedia>>> {
    return this.media(expectedConnectionId, signal, (epoch, live, echo) => {
      const lookup: SnowMediaLookup = async (action, params, caller) => {
        const result = await this.call(action, params, caller, expectedConnectionId);
        if (!result.ok) return { ok: false, error: result.error, dispatched: false };
        if (result.value.kind === 'unknown')
          return { ok: false, error: result.value.error, dispatched: true };
        return { ok: true, value: result.value.response };
      };
      return downloadSnowMedia(epoch.peer, lookup, input, consumer, epoch.peer.id, echo, live);
    });
  }
  /** Only an actual stage handle issued here can select a gateway path for one explicit publish. */
  sendStaged(
    staged: SnowStagedMedia,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<Result<OneBotCallOutcome>> {
    if (!this.stagedMedia.has(staged) || staged.connectionId !== expectedConnectionId)
      return Promise.resolve({ ok: false, error: makeError('stale-owner', false) });
    const encoded = snowStagedSend(staged);
    if (!encoded.ok) return Promise.resolve(encoded);
    return this.call(encoded.value.action, encoded.value.params, signal, expectedConnectionId);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    this.closing = Promise.resolve().then(async () => {
      await Promise.allSettled([
        this.running ?? Promise.resolve(),
        this.closeIo(),
        ...this.operations,
      ]);
      if (this.cleanupError !== undefined) {
        this.publish('failed', makeError('internal', false));
        throw this.cleanupError;
      }
      this.current = null;
      this.publish('stopped');
    });
    this.abort.abort(new KernelFault('cancelled'));
    this.current?.abort.abort(new KernelFault('cancelled'));
    this.publish('retiring');
    return this.closing;
  }
}
