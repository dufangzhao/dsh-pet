import {
  COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE,
  makeError,
  type KernelError,
  type Result,
} from '@pet/contracts';
import type { QQMediaConsumer } from '@pet/companion-runtime';
import { readOfficialAttachment, uploadOfficialMedia } from './media.js';
import type {
  OfficialAttachmentInput,
  OfficialDownloadedMedia,
  OfficialMediaInput,
  OfficialMediaResult,
  OfficialMediaOperationResult,
} from './media-types.js';
import { KernelFault } from '@pet/host-kernel';
import type {
  OfficialDriverObserver,
  OfficialDriverStatus,
  OfficialGateway,
  OfficialIo,
} from './ports.js';
import {
  decodeOfficialGatewayFrame,
  decodeOfficialHttpReceipt,
  encodeOfficialMediaUpload,
  encodeOfficialMessage,
  type OfficialHttpReceipt,
  type OfficialMessageRequest,
} from './wire.js';

export interface OfficialDriverOptions {
  /** Reopens per start, not retries of any message/upload operation. */
  readonly reconnectAttempts?: number;
  readonly reconnectDelayMs?: number;
  readonly handshakeTimeoutMs?: number;
}
export interface OfficialDriverHttpResult {
  readonly connectionId: string;
  readonly receipt: OfficialHttpReceipt;
  readonly error: KernelError | null;
}
interface Epoch {
  readonly connection: OfficialGateway;
  readonly abort: AbortController;
  readonly signal: AbortSignal;
  readonly operationAbort: AbortController;
  readonly operationSignal: AbortSignal;
  ready: boolean;
  sequence: number | null;
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
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new KernelFault('cancelled'));
      return;
    }
    const finish = (): void => {
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const cancel = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new KernelFault('cancelled'));
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** Native protocol lifecycle only. The host owns source tasks, authority, credentials and HTTP/WSS. */
export class OfficialQqDriver {
  private readonly abort = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();
  private mediaOperations = 0;
  private readonly reconnectAttempts: number;
  private readonly reconnectDelayMs: number;
  private readonly handshakeTimeoutMs: number;
  private current: Epoch | null = null;
  private resumeState: { sessionId: string; sequence: number } | null = null;
  private running: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private ioClosing: Promise<void> | null = null;
  private cleanupError: unknown;
  private stopped = false;
  private statusValue: OfficialDriverStatus = {
    phase: 'idle',
    connectionId: null,
    selfId: null,
    error: null,
  };

  constructor(
    private readonly io: OfficialIo,
    private readonly observer: OfficialDriverObserver,
    options: OfficialDriverOptions = {},
  ) {
    this.reconnectAttempts = bounded(options.reconnectAttempts, 3, 0, 10);
    this.reconnectDelayMs = bounded(options.reconnectDelayMs, 500, 0, 30_000);
    this.handshakeTimeoutMs = bounded(options.handshakeTimeoutMs, 30_000, 1, 120_000);
  }
  get status(): OfficialDriverStatus {
    return { ...this.statusValue };
  }

  /** Long-lived root promise. Call only after PluginManager admits this source as active. */
  start(signal: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped || signal.aborted) return Promise.reject(new KernelFault('cancelled'));
    this.running = this.run(AbortSignal.any([signal, this.abort.signal]));
    void this.running.catch(() => {}); // The original promise remains rejected for its supervisor.
    return this.running;
  }
  private publish(phase: OfficialDriverStatus['phase'], error: KernelError | null = null): void {
    this.statusValue = {
      phase,
      error,
      connectionId: this.current?.connection.id ?? null,
      selfId: this.statusValue.selfId,
    };
    this.observer.onStatus(this.status);
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
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
  /** Join every child even when one close fails; an unconfirmed cleanup prevents replacement. */
  private async drain(work: readonly Promise<unknown>[]): Promise<void> {
    const results = await Promise.allSettled(work);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      this.cleanupError ??= failure.reason;
      throw failure.reason;
    }
    if (this.cleanupError !== undefined) throw this.cleanupError;
  }
  private async run(signal: AbortSignal): Promise<void> {
    const abortIo = (): void => {
      void this.closeIo().catch(() => {});
    };
    signal.addEventListener('abort', abortIo, { once: true });
    try {
      for (let attempt = 0; !signal.aborted; attempt++) {
        try {
          this.publish('connecting');
          signal.throwIfAborted();
          const connection = await this.io.openGateway(signal);
          const abort = new AbortController();
          const operationAbort = new AbortController();
          const live = AbortSignal.any([signal, abort.signal, connection.signal]);
          const epoch: Epoch = {
            connection,
            abort,
            signal: live,
            operationAbort,
            operationSignal: AbortSignal.any([live, operationAbort.signal]),
            ready: false,
            sequence: this.resumeState?.sequence ?? null,
          };
          this.current = epoch;
          await this.serve(epoch);
          if (!signal.aborted) throw new KernelFault('network');
        } catch (error) {
          this.current = null;
          if (signal.aborted && this.cleanupError === undefined) break;
          const failure = safeError(error);
          if (
            this.cleanupError !== undefined ||
            !['network', 'timeout', 'unavailable'].includes(failure.code) ||
            attempt >= this.reconnectAttempts
          )
            throw error;
          this.publish('offline', failure);
          await wait(this.reconnectDelayMs, signal);
        }
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
    const { connection, signal } = epoch;
    let closing: Promise<void> | null = null;
    const retire = (): Promise<void> => {
      epoch.ready = false;
      epoch.operationAbort.abort(new KernelFault('stale-owner'));
      closing ??= this.drain([
        Promise.resolve().then(() => connection.close()),
        connection.settled,
      ]);
      return closing;
    };
    const stop = (): void => {
      void retire().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    let hello = false;
    let resumed = false;
    let awaitingAck = false;
    let heartbeats: Promise<void> | null = null;
    let reason: unknown = new KernelFault('network');
    const fail = (error: unknown): void => {
      reason = error;
      epoch.abort.abort(error);
    };
    const timeout = setTimeout(() => fail(new KernelFault('timeout')), this.handshakeTimeoutMs);
    const heartbeat = async (): Promise<void> => {
      if (signal.aborted || this.current !== epoch) return;
      awaitingAck = true;
      await connection.heartbeat(epoch.sequence, signal);
    };
    const iterator = connection.frames[Symbol.asyncIterator]();
    try {
      if (signal.aborted) return;
      if (!connection.id) throw new KernelFault('invalid-input');
      while (!signal.aborted) {
        const next = await iterator.next();
        if (next.done || signal.aborted || this.current !== epoch) break;
        const decoded = decodeOfficialGatewayFrame(next.value);
        if (!decoded.ok) throw new KernelFault(decoded.error.code);
        const frame = decoded.value;
        if (frame.kind === 'hello') {
          if (hello) throw new KernelFault('invalid-input');
          hello = true;
          this.publish('authenticating');
          heartbeats = (async () => {
            while (!signal.aborted) {
              await wait(frame.heartbeat_interval, signal);
              if (signal.aborted) break;
              if (awaitingAck) throw new KernelFault('timeout');
              await heartbeat();
            }
          })().catch((error: unknown) => {
            if (!signal.aborted) fail(error);
          });
          if (this.resumeState) {
            resumed = true;
            await connection.resume({ ...this.resumeState }, signal);
          } else await connection.identify(signal);
        } else if (frame.kind === 'heartbeat-ack') {
          if (!hello) throw new KernelFault('invalid-input');
          awaitingAck = false;
        } else if (frame.kind === 'heartbeat') {
          if (!hello) throw new KernelFault('invalid-input');
          await heartbeat();
        } else if (frame.kind === 'ready') {
          if (!hello || epoch.ready) throw new KernelFault('invalid-input');
          this.resumeState = { sessionId: frame.session_id, sequence: frame.s };
          epoch.sequence = frame.s;
          epoch.ready = true;
          clearTimeout(timeout);
          this.statusValue = { ...this.statusValue, selfId: frame.user_id };
          this.publish('ready');
        } else if (frame.kind === 'resumed') {
          if (!hello || !resumed || !this.resumeState || epoch.ready)
            throw new KernelFault('invalid-input');
          epoch.sequence = Math.max(this.resumeState.sequence, frame.s);
          this.resumeState.sequence = epoch.sequence;
          epoch.ready = true;
          clearTimeout(timeout);
          this.publish('ready');
        } else if (frame.kind === 'invalid-session') {
          this.resumeState = null;
          fail(new KernelFault('network'));
        } else if (frame.kind === 'reconnect') {
          fail(new KernelFault('network'));
        } else if (frame.kind === 'message' || frame.kind === 'unhandled-event') {
          if (!epoch.ready || !this.resumeState) throw new KernelFault('invalid-input');
          if (frame.kind === 'message')
            await this.observer.onEvent(frame.event, connection.id, epoch.operationSignal);
          if (signal.aborted || this.current !== epoch) break;
          epoch.sequence = Math.max(
            epoch.sequence ?? 0,
            frame.kind === 'message' ? frame.event.s : frame.s,
          );
          this.resumeState.sequence = epoch.sequence;
        }
      }
      if (!this.abort.signal.aborted && epoch.abort.signal.aborted) throw reason;
    } finally {
      clearTimeout(timeout);
      epoch.ready = false;
      epoch.abort.abort(new KernelFault('cancelled'));
      signal.removeEventListener('abort', stop);
      await this.drain([
        retire(),
        heartbeats ?? Promise.resolve(),
        Promise.resolve().then(() => iterator.return?.()),
      ]);
    }
  }
  /** The expected ID is captured before caller awaits; never refresh it to the replacement gateway. */
  send(
    scene: 'c2c' | 'group',
    target: string,
    payload: unknown,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<Result<OfficialDriverHttpResult>> {
    return this.http(
      'message',
      encodeOfficialMessage(scene, target, payload),
      signal,
      expectedConnectionId,
    );
  }
  upload(
    scene: 'c2c' | 'group',
    target: string,
    payload: unknown,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<Result<OfficialDriverHttpResult>> {
    return this.http(
      'media-upload',
      encodeOfficialMediaUpload(scene, target, payload),
      signal,
      expectedConnectionId,
    );
  }
  private http(
    operation: 'message' | 'media-upload',
    request: Result<OfficialMessageRequest>,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<Result<OfficialDriverHttpResult>> {
    if (!request.ok) return Promise.resolve(request);
    const epoch = this.current;
    if (this.stopped || signal.aborted)
      return Promise.resolve({ ok: false, error: makeError('cancelled', false) });
    if (typeof expectedConnectionId !== 'string' || !expectedConnectionId)
      return Promise.resolve({ ok: false, error: makeError('invalid-input', false) });
    if (!epoch || epoch.connection.id !== expectedConnectionId || epoch.operationSignal.aborted)
      return Promise.resolve({ ok: false, error: makeError('stale-owner', false) });
    if (!epoch.ready) return Promise.resolve({ ok: false, error: makeError('not-ready', false) });
    const combined = AbortSignal.any([epoch.operationSignal, signal]);
    return this.track(
      (async (): Promise<Result<OfficialDriverHttpResult>> => {
        try {
          if (combined.aborted) return { ok: false, error: makeError('cancelled', false) };
          const outcome = await (operation === 'message'
            ? this.io.send(request.value, combined)
            : this.io.upload(request.value, combined));
          if (!outcome.ok) {
            if (!outcome.dispatched) return { ok: false, error: outcome.error };
            return {
              ok: true,
              value: {
                connectionId: epoch.connection.id,
                receipt: { kind: 'unknown', httpStatus: 0, reason: 'invalid-response' },
                error: outcome.error,
              },
            };
          }
          return {
            ok: true,
            value: {
              connectionId: epoch.connection.id,
              receipt: decodeOfficialHttpReceipt(
                outcome.value.status,
                outcome.value.body,
                operation,
              ),
              error: null,
            },
          };
        } catch (error) {
          return {
            ok: true,
            value: {
              connectionId: epoch.connection.id,
              receipt: { kind: 'unknown', httpStatus: 0, reason: 'invalid-response' },
              error: safeError(error, combined.aborted ? 'cancelled' : 'network'),
            },
          };
        }
      })(),
    );
  }
  private media<T extends OfficialMediaResult | OfficialDownloadedMedia>(
    expectedConnectionId: string,
    signal: AbortSignal,
    run: (epoch: Epoch, live: AbortSignal) => Promise<OfficialMediaOperationResult<T>>,
  ): Promise<OfficialMediaOperationResult<T>> {
    const epoch = this.current;
    if (this.stopped || signal.aborted)
      return Promise.resolve({ ok: false, error: makeError('cancelled', false) });
    if (
      !expectedConnectionId ||
      !epoch ||
      epoch.connection.id !== expectedConnectionId ||
      epoch.operationSignal.aborted
    )
      return Promise.resolve({ ok: false, error: makeError('stale-owner', false) });
    if (!epoch.ready || !this.io.media)
      return Promise.resolve({ ok: false, error: makeError('not-ready', false) });
    if (this.mediaOperations >= COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded', false) });
    this.mediaOperations++;
    let retained = false;
    return this.track(
      Promise.resolve()
        .then(async () => {
          const result = await run(epoch, AbortSignal.any([epoch.operationSignal, signal]));
          const failed = result.ok
            ? 'cleanup' in result.value && result.value.cleanup === 'failed'
            : result.cleanup === 'failed';
          if (failed) {
            retained = true;
            this.cleanupError ??= new KernelFault('internal');
          }
          return result;
        })
        .finally(() => {
          if (!retained) this.mediaOperations--;
        }),
    );
  }
  uploadMedia(
    input: OfficialMediaInput,
    signal: AbortSignal,
    expectedConnectionId: string,
  ): Promise<OfficialMediaOperationResult<OfficialMediaResult>> {
    return this.media(expectedConnectionId, signal, (epoch, live) =>
      uploadOfficialMedia(this.io.media, input, epoch.connection.id, live),
    );
  }
  downloadAttachment(
    input: OfficialAttachmentInput,
    consumer: QQMediaConsumer,
    signal: AbortSignal,
    expectedConnectionId: string,
    check: () => Promise<void>,
  ): Promise<OfficialMediaOperationResult<OfficialDownloadedMedia>> {
    if (typeof check !== 'function')
      return Promise.resolve({ ok: false, error: makeError('invalid-input', false) });
    return this.media(expectedConnectionId, signal, (epoch, live) => {
      const verify = async (): Promise<void> => {
        if (this.current !== epoch || live.aborted) throw new KernelFault('stale-owner');
        await check();
        if (this.current !== epoch || live.aborted) throw new KernelFault('stale-owner');
      };
      return readOfficialAttachment(
        this.io.media,
        input,
        consumer,
        epoch.connection.id,
        live,
        verify,
      );
    });
  }
  /** Fence synchronously; return only after protocol callbacks, HTTP work and physical IO settle. */
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
