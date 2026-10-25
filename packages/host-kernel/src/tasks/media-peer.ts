import { types } from 'node:util';
import {
  makeError,
  type KernelError,
  type MediaFrame,
  type OwnerRef,
  type Result,
  type StreamCreditMessage,
  type StreamEndMessage,
} from '@pet/contracts';
import { jsonPreflight, validateMediaFrame, validateStreamHeader } from '@pet/contracts/validation';
import { sameOwner } from '../runtime/identity.js';
import { BoundedMediaChannel } from './media-channel.js';
import { CreditMediaSender } from './credit-sender.js';
export interface TaskMediaReference {
  streamId: string;
  taskId: string;
  owner: OwnerRef;
}
export interface MediaReadEndpoint extends AsyncIterable<Uint8Array> {
  readonly reference: TaskMediaReference;
  cancel(): void;
}
export interface MediaWriteEndpoint {
  readonly reference: TaskMediaReference;
  write(payload: Uint8Array): Promise<Result<null>>;
  end(): Promise<Result<null>>;
  cancel(): void;
}
export type MediaControl =
  | Omit<StreamCreditMessage, 'protocol' | 'id' | 'sessionId' | 'owner'>
  | Omit<StreamEndMessage, 'protocol' | 'id' | 'sessionId' | 'owner'>;
export interface MediaPeerOptions {
  signalFor: (owner: OwnerRef, taskId: string) => AbortSignal | null;
  write: (frame: MediaFrame) => Promise<Result<null>>;
  control: (message: MediaControl) => Result<null>;
}
interface RecordBase {
  reference: TaskMediaReference;
  detach: () => void;
}
type StreamRecord = RecordBase &
  (
    { kind: 'reader'; channel: BoundedMediaChannel } | { kind: 'writer'; sender: CreditMediaSender }
  );
const fail = <T>(code: KernelError['code']): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const byteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)!.get!;
export function mediaReference(input: unknown): TaskMediaReference | null {
  const safe = jsonPreflight(input);
  if (
    !safe.ok ||
    !safe.value ||
    typeof safe.value !== 'object' ||
    Array.isArray(safe.value) ||
    Object.keys(safe.value).sort().join(',') !== 'owner,streamId,taskId'
  )
    return null;
  const checked = validateStreamHeader({ ...safe.value, sequence: 0, byteLength: 0 });
  return checked.ok
    ? Object.freeze({
        streamId: checked.value.streamId,
        taskId: checked.value.taskId,
        owner: Object.freeze({ ...checked.value.owner }),
      })
    : null;
}
/** One exact peer. Lower-layer control envelope provenance must already be checked. */
export class TaskMediaPeer {
  readonly #streams = new Map<string, StreamRecord>();
  readonly #terminal = new Map<string, string>();
  #closed = false;
  #rxFrames = 0;
  #rxCredits = 0;
  #writeQueued = 0;
  #writeStarted = 0;
  #writeDone = 0;
  #writeTail = Promise.resolve();
  constructor(private readonly options: MediaPeerOptions) {}
  private prepare(input: unknown): Result<{ reference: TaskMediaReference; signal: AbortSignal }> {
    const ref = mediaReference(input);
    if (!ref) return fail('invalid-input');
    if (this.#closed) return fail('unavailable');
    if (this.#streams.has(ref.streamId) || this.#terminal.has(ref.streamId))
      return fail('invalid-input');
    let signal: AbortSignal | null;
    try {
      signal = this.options.signalFor(ref.owner, ref.taskId);
    } catch {
      return fail('permission-denied');
    }
    if (!signal || signal.aborted) return fail('stale-owner');
    if (
      this.#streams.size >= 64 ||
      [...this.#streams.values()].filter(
        (r) => sameOwner(r.reference.owner, ref.owner) && r.reference.taskId === ref.taskId,
      ).length >= 4
    )
      return fail('quota-exceeded');
    return { ok: true, value: { reference: ref, signal } };
  }
  private active(record: StreamRecord): boolean {
    if (this.#closed || this.#streams.get(record.reference.streamId) !== record) return false;
    try {
      return (
        this.options.signalFor(record.reference.owner, record.reference.taskId)?.aborted === false
      );
    } catch {
      return false;
    }
  }
  private remember(record: StreamRecord): void {
    record.detach();
    this.#streams.delete(record.reference.streamId);
    this.#terminal.set(record.reference.streamId, record.reference.taskId);
    while (this.#terminal.size > 256) this.#terminal.delete(this.#terminal.keys().next().value!);
  }
  private send(message: MediaControl): Result<null> {
    try {
      return this.options.control(message);
    } catch {
      return fail('unavailable');
    }
  }
  private bind(record: StreamRecord, signal: AbortSignal): void {
    const abort = () => this.cancel(record, makeError('cancelled', false));
    signal.addEventListener('abort', abort, { once: true });
    record.detach = () => signal.removeEventListener('abort', abort);
    this.#streams.set(record.reference.streamId, record);
  }
  private cancel(record: StreamRecord, error: KernelError, notify = true): void {
    if (this.#streams.get(record.reference.streamId) !== record) return;
    const sequence =
      record.kind === 'writer'
        ? record.sender.snapshot().nextSequence
        : record.channel.snapshot().nextSequence;
    if (record.kind === 'writer') record.sender.cancel(error);
    else record.channel.cancel(error);
    this.remember(record);
    if (notify)
      this.send({
        type: 'stream-end',
        streamId: record.reference.streamId,
        taskId: record.reference.taskId,
        sequence,
        error: makeError(error.code, false),
      });
  }
  createReader(input: unknown): Result<MediaReadEndpoint> {
    const prepared = this.prepare(input);
    if (!prepared.ok) return prepared;
    const { reference, signal } = prepared.value;
    const channel = new BoundedMediaChannel(reference, () => this.active(record), signal);
    const record: StreamRecord = { kind: 'reader', reference, channel, detach: () => {} };
    this.bind(record, signal);
    const iterator = channel[Symbol.asyncIterator]();
    let used = false;
    const endpoint: MediaReadEndpoint = Object.freeze({
      reference,
      cancel: () => this.cancel(record, makeError('cancelled', false)),
      [Symbol.asyncIterator]: () => {
        if (used) throw new Error('Media has one consumer');
        used = true;
        return {
          next: async () => {
            const next = await iterator.next();
            if (next.done) {
              if (this.#streams.get(reference.streamId) === record) this.remember(record);
              return { done: true as const, value: undefined };
            }
            const credit = this.send({
              type: 'stream-credit',
              streamId: reference.streamId,
              taskId: reference.taskId,
              credits: 1,
            });
            if (!credit.ok) {
              this.cancel(record, credit.error);
              throw new Error(credit.error.messageKey);
            }
            return { done: false as const, value: Uint8Array.from(next.value.payload) };
          },
          return: async () => {
            this.cancel(record, makeError('cancelled', false));
            return { done: true as const, value: undefined };
          },
        };
      },
    });
    return { ok: true, value: endpoint };
  }
  grantInitial(input: TaskMediaReference): Result<null> {
    const record = this.#streams.get(input.streamId);
    if (
      !record ||
      record.kind !== 'reader' ||
      record.reference.taskId !== input.taskId ||
      !sameOwner(record.reference.owner, input.owner)
    )
      return fail('invalid-input');
    return this.send({
      type: 'stream-credit',
      streamId: input.streamId,
      taskId: input.taskId,
      credits: 8,
    });
  }
  createWriter(input: unknown): Result<MediaWriteEndpoint> {
    const prepared = this.prepare(input);
    if (!prepared.ok) return prepared;
    const { reference, signal } = prepared.value;
    const sender = new CreditMediaSender(
      reference,
      (frame) => this.serialWrite(record, frame),
      signal,
    );
    const record: StreamRecord = { kind: 'writer', reference, sender, detach: () => {} };
    this.bind(record, signal);
    return {
      ok: true,
      value: Object.freeze({
        reference,
        write: async (payload: Uint8Array): Promise<Result<null>> => {
          if (!this.active(record)) return fail('stale-owner');
          if (!types.isUint8Array(payload) || types.isProxy(payload)) return fail('invalid-input');
          let size: number;
          try {
            size = byteLength.call(payload) as number;
          } catch {
            return fail('invalid-input');
          }
          const parsed = validateMediaFrame({
            header: { ...reference, sequence: sender.snapshot().nextSequence, byteLength: size },
            payload,
          });
          if (!parsed.ok) return parsed;
          const writable = await sender.waitWritable(signal);
          if (!writable.ok) return writable;
          return sender.send(parsed.value);
        },
        end: async (): Promise<Result<null>> => {
          if (!this.active(record)) return fail('stale-owner');
          const drained = await sender.drain(signal);
          if (!drained.ok) return drained;
          const ended = sender.end();
          if (!ended.ok) return ended;
          const sent = this.send({
            type: 'stream-end',
            streamId: reference.streamId,
            taskId: reference.taskId,
            sequence: ended.value,
          });
          if (!sent.ok) {
            this.cancel(record, sent.error, false);
            return sent;
          }
          this.remember(record);
          return { ok: true, value: null };
        },
        cancel: () => this.cancel(record, makeError('cancelled', false)),
      }),
    };
  }
  private async serialWrite(record: StreamRecord, frame: MediaFrame): Promise<Result<null>> {
    this.#writeQueued++;
    const before = this.#writeTail;
    let release!: () => void;
    this.#writeTail = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await before;
      if (!this.active(record)) return fail('cancelled');
      this.#writeStarted++;
      const result = await this.options.write(frame);
      this.#writeDone++;
      return result;
    } catch {
      return fail('unavailable');
    } finally {
      release();
    }
  }
  receive(frame: MediaFrame): Result<null> {
    this.#rxFrames++;
    const record = this.#streams.get(frame.header.streamId);
    if (!record || record.kind !== 'reader') return fail('invalid-input');
    const accepted = record.channel.push(frame);
    if (!accepted.ok) this.cancel(record, accepted.error);
    return accepted;
  }
  control(message: StreamCreditMessage | StreamEndMessage): Result<null> {
    const record = this.#streams.get(message.streamId);
    if (!record)
      return this.#terminal.get(message.streamId) === message.taskId
        ? { ok: true, value: null }
        : fail('invalid-input');
    if (record.reference.taskId !== message.taskId) return fail('invalid-input');
    if (message.type === 'stream-credit') {
      this.#rxCredits += message.credits;
      if (record.kind !== 'writer') return fail('invalid-input');
      return record.sender.grant(message.credits);
    }
    if (message.error) {
      this.cancel(record, message.error, false);
      return { ok: true, value: null };
    }
    if (record.kind !== 'reader') return fail('invalid-input');
    const closed = record.channel.close(message.sequence);
    if (!closed.ok) this.cancel(record, closed.error, false);
    return closed;
  }
  close(error: KernelError = makeError('unavailable', false)): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const record of [...this.#streams.values()]) this.cancel(record, error, false);
  }
  snapshot() {
    return {
      writesQueued: this.#writeQueued,
      writesStarted: this.#writeStarted,
      writesDone: this.#writeDone,
      framesReceived: this.#rxFrames,
      creditsReceived: this.#rxCredits,
      writerCredits: [...this.#streams.values()].reduce(
        (sum, r) => sum + (r.kind === 'writer' ? r.sender.snapshot().credits : 0),
        0,
      ),
      readerQueued: [...this.#streams.values()].reduce(
        (sum, r) => sum + (r.kind === 'reader' ? r.channel.snapshot().queuedChunks : 0),
        0,
      ),
      streams: this.#streams.size,
      terminalReferences: this.#terminal.size,
      closed: this.#closed,
    };
  }
}
