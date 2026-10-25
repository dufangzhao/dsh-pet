import { types } from 'node:util';
import {
  makeError,
  isKernelErrorCode,
  type KernelErrorCode,
  type MediaFrame,
  type Result,
} from '@pet/contracts';
import { validateMediaFrame, jsonPreflight } from '@pet/contracts/validation';
import { mediaReference, type TaskMediaReference } from '../tasks/media-peer.js';
export const SENSITIVE_MAX_BYTES = 16 * 1024;
export type SensitiveReference = TaskMediaReference;
export interface SensitivePeerOptions {
  write(frame: MediaFrame): Promise<Result<null>>;
  observe?(secret: string): boolean;
  timeoutMs?: number;
}
interface Base {
  reference: SensitiveReference;
  controller: AbortController;
  signal: AbortSignal;
  closed: boolean;
  physical: boolean;
  detach: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}
interface Outgoing extends Base {
  kind: 'out';
  sent: boolean;
  resolve: (value: Result<null>) => void;
}
interface Incoming extends Base {
  kind: 'in';
  resolve: (value: Result<unknown>) => void;
  operation: (secret: string, signal: AbortSignal) => Promise<unknown>;
  delivered: boolean;
}
type Slot = Outgoing | Incoming;
const fail = <T>(code: KernelErrorCode): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const key = (reference: SensitiveReference) =>
  JSON.stringify([
    reference.owner.pluginId,
    reference.owner.instanceId,
    reference.owner.generation,
    reference.taskId,
  ]);
function writeResult(input: unknown): Result<null> {
  const safe = jsonPreflight(input);
  if (!safe.ok || !safe.value || typeof safe.value !== 'object' || Array.isArray(safe.value))
    return fail('unavailable');
  const row = safe.value;
  if (
    row['ok'] === true &&
    Object.keys(row).sort().join(',') === 'ok,value' &&
    row['value'] === null
  )
    return { ok: true, value: null };
  const error = row['error'];
  if (
    row['ok'] === false &&
    Object.keys(row).sort().join(',') === 'error,ok' &&
    error &&
    typeof error === 'object' &&
    !Array.isArray(error) &&
    Object.keys(error).sort().join(',') === 'code,messageKey,retryable' &&
    isKernelErrorCode(error['code']) &&
    error['messageKey'] === 'errors.' + error['code'] &&
    typeof error['retryable'] === 'boolean'
  )
    return { ok: false, error: makeError(error['code'], error['retryable']) };
  return fail('unavailable');
}
function secretText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= SENSITIVE_MAX_BYTES &&
    Buffer.from(value, 'utf8').toString('utf8') === value &&
    ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}
/** Dedicated sensitive-pipe protocol, not a permission authority or a general RPC. */
export class SensitivePeer {
  readonly #active = new Map<string, Slot>();
  readonly #slots = new Set<Slot>();
  readonly #terminal = new Map<string, string>();
  readonly #lifetime = new AbortController();
  readonly #timeout: number;
  #closed = false;
  #queuedWrites = 0;
  readonly #work = new Set<Promise<void>>();
  #writes = Promise.resolve();
  constructor(private readonly options: SensitivePeerOptions) {
    this.#timeout = options.timeoutMs ?? 30000;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 30000)
      throw new Error('Invalid sensitive timeout');
  }
  private prepare(
    input: unknown,
    signal: AbortSignal,
  ): Result<{ reference: SensitiveReference; signal: AbortSignal; controller: AbortController }> {
    const reference = mediaReference(input);
    if (!reference) return fail('invalid-input');
    if (!signal || typeof signal !== 'object' || types.isProxy(signal))
      return fail('invalid-input');
    try {
      nativeAborted.call(signal);
    } catch {
      return fail('invalid-input');
    }
    if (this.#closed) return fail('unavailable');
    if (nativeAborted.call(signal)) return fail('cancelled');
    if (
      this.#active.has(reference.streamId) ||
      this.#terminal.has(reference.streamId) ||
      [...this.#slots].some((slot) => slot.reference.streamId === reference.streamId)
    )
      return fail('invalid-input');
    if (this.#slots.size >= 32 || this.#queuedWrites >= 64) return fail('quota-exceeded');
    const controller = new AbortController();
    return {
      ok: true,
      value: {
        reference,
        controller,
        signal: AbortSignal.any([signal, controller.signal, this.#lifetime.signal]),
      },
    };
  }
  private bind(slot: Slot): void {
    this.#active.set(slot.reference.streamId, slot);
    this.#slots.add(slot);
    const abort = () => this.finish(slot, fail('cancelled'), true);
    slot.signal.addEventListener('abort', abort, { once: true });
    slot.detach = () => slot.signal.removeEventListener('abort', abort);
    slot.timer = setTimeout(() => this.finish(slot, fail('timeout'), true), this.#timeout);
    if (slot.signal.aborted) abort();
  }
  private finish(slot: Slot, result: Result<unknown>, notify = false): void {
    if (slot.closed) return;
    slot.closed = true;
    slot.detach();
    if (slot.timer) clearTimeout(slot.timer);
    this.#active.delete(slot.reference.streamId);
    this.#terminal.set(slot.reference.streamId, key(slot.reference));
    while (this.#terminal.size > 256) this.#terminal.delete(this.#terminal.keys().next().value!);
    if (!slot.physical) this.#slots.delete(slot);
    slot.controller.abort();
    if (slot.kind === 'out') slot.resolve(result.ok ? { ok: true, value: null } : result);
    else slot.resolve(result);
    if (notify && !this.#closed)
      void this.write(slot.reference, 3, new Uint8Array(0)).catch(() => {});
  }
  private settled(slot: Slot): void {
    slot.physical = false;
    if (slot.closed) this.#slots.delete(slot);
  }
  private async write(
    reference: SensitiveReference,
    sequence: number,
    payload: Uint8Array,
    signal?: AbortSignal,
    started?: () => void,
  ): Promise<Result<null>> {
    if (this.#queuedWrites >= 64) return fail('quota-exceeded');
    this.#queuedWrites++;
    const before = this.#writes;
    let release!: () => void;
    this.#writes = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await before;
      if (this.#closed) return fail('unavailable');
      if (signal?.aborted) return fail('cancelled');
      started?.();
      return writeResult(
        await this.options.write({
          header: { ...reference, sequence, byteLength: payload.byteLength },
          payload,
        }),
      );
    } catch {
      return fail('unavailable');
    } finally {
      this.#queuedWrites--;
      release();
    }
  }
  send(input: SensitiveReference, secret: string, signal: AbortSignal): Promise<Result<null>> {
    if (!secretText(secret)) return Promise.resolve(fail('invalid-input'));
    const prepared = this.prepare(input, signal);
    if (!prepared.ok) return Promise.resolve(prepared);
    const payload = Uint8Array.from(Buffer.from(secret, 'utf8'));
    let slot!: Outgoing;
    const result = new Promise<Result<null>>((resolve) => {
      slot = {
        ...prepared.value,
        kind: 'out',
        sent: false,
        resolve,
        closed: false,
        physical: false,
        detach: () => {},
        timer: undefined,
      };
      this.bind(slot);
    });
    if (!slot.closed) {
      slot.physical = true;
      const work = this.write(slot.reference, 0, payload, slot.signal, () => {
        slot.sent = true;
      })
        .then((sent) => {
          if (!sent.ok) this.finish(slot, sent);
        })
        .finally(() => {
          payload.fill(0);
          this.settled(slot);
          this.#work.delete(work);
        });
      this.#work.add(work);
    } else payload.fill(0);
    return result;
  }
  accept<T>(
    input: SensitiveReference,
    signal: AbortSignal,
    operation: (secret: string, signal: AbortSignal) => Promise<T>,
  ): Promise<Result<T>> {
    if (typeof operation !== 'function') return Promise.resolve(fail('invalid-input'));
    const prepared = this.prepare(input, signal);
    if (!prepared.ok) return Promise.resolve(prepared);
    return new Promise<Result<T>>((resolve) => {
      const slot: Incoming = {
        ...prepared.value,
        kind: 'in',
        resolve: (value) => resolve(value as Result<T>),
        operation,
        delivered: false,
        closed: false,
        physical: false,
        detach: () => {},
        timer: undefined,
      };
      this.bind(slot);
    });
  }
  receive(input: MediaFrame): Result<null> {
    const parsed = validateMediaFrame(input);
    if (!parsed.ok) return parsed;
    const { header, payload } = parsed.value,
      reference = mediaReference({
        streamId: header.streamId,
        taskId: header.taskId,
        owner: header.owner,
      });
    const clear = () => {
      payload.fill(0);
      const original = Object.getOwnPropertyDescriptor(input, 'payload')?.value as unknown;
      if (types.isUint8Array(original) && !types.isProxy(original))
        Uint8Array.prototype.fill.call(original, 0);
    };
    if (!reference) {
      clear();
      return fail('invalid-input');
    }
    const slot = this.#active.get(reference.streamId);
    if (!slot) {
      const old = this.#terminal.get(reference.streamId) === key(reference);
      clear();
      return old ? { ok: true, value: null } : fail('permission-denied');
    }
    if (key(slot.reference) !== key(reference) || header.sequence > 3) {
      clear();
      return fail('permission-denied');
    }
    if (header.sequence !== 0) {
      if (payload.byteLength !== 0) {
        clear();
        return fail('invalid-input');
      }
      clear();
      if (header.sequence === 3) {
        this.finish(slot, fail('cancelled'));
        return { ok: true, value: null };
      }
      if (slot.kind !== 'out' || !slot.sent) return fail('invalid-input');
      this.finish(slot, header.sequence === 1 ? { ok: true, value: null } : fail('unavailable'));
      return { ok: true, value: null };
    }
    if (
      slot.kind !== 'in' ||
      slot.delivered ||
      slot.signal.aborted ||
      payload.byteLength < 1 ||
      payload.byteLength > SENSITIVE_MAX_BYTES
    ) {
      clear();
      return fail('invalid-input');
    }
    let secret: string;
    try {
      secret = new TextDecoder('utf-8', { fatal: true }).decode(payload);
    } catch {
      clear();
      return fail('invalid-input');
    }
    clear();
    if (!secretText(secret)) return fail('invalid-input');
    try {
      if (this.options.observe && this.options.observe(secret) !== true) {
        this.finish(slot, fail('quota-exceeded'), true);
        return { ok: true, value: null };
      }
    } catch {
      this.finish(slot, fail('unavailable'), true);
      return { ok: true, value: null };
    }
    slot.delivered = true;
    slot.physical = true;
    const work = this.operate(slot, secret).finally(() => {
      this.settled(slot);
      this.#work.delete(work);
    });
    this.#work.add(work);
    return { ok: true, value: null };
  }
  private async operate(slot: Incoming, secret: string): Promise<void> {
    let result: Result<unknown>;
    try {
      if (slot.closed || slot.signal.aborted) return;
      const value = await slot.operation(secret, slot.signal);
      if (slot.closed || slot.signal.aborted) return;
      result = { ok: true, value };
    } catch {
      result = fail('internal');
    }
    if (slot.closed) return;
    const ack = await this.write(slot.reference, result.ok ? 1 : 2, new Uint8Array(0), slot.signal);
    if (!ack.ok) this.finish(slot, ack);
    else this.finish(slot, result);
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const slot of [...this.#active.values()]) this.finish(slot, fail('unavailable'));
    this.#lifetime.abort();
  }
  async drain(): Promise<void> {
    await Promise.all([...this.#work]);
    await this.#writes;
  }
  diagnostics() {
    return {
      pending: this.#active.size,
      running: [...this.#slots].filter((slot) => slot.physical).length,
      closed: this.#closed,
    };
  }
}
