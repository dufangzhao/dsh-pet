import { randomUUID } from 'node:crypto';
import { KernelFault } from '../kernel-fault.js';
import { ownerFrom } from '../runtime/worker-protocol.js';
import {
  makeError,
  type CancelReason,
  type CapabilityBinding,
  type JsonValue,
  type KernelError,
  type OwnerRef,
  type Result,
  type TaskContext,
  type TaskEvent,
  type TaskState,
} from '@pet/contracts';
import { jsonPreflight, validateStreamHeader } from '@pet/contracts/validation';
import type { PluginManager } from '../runtime/plugin-manager.js';
import { freezeJson, sameOwner } from '../runtime/identity.js';
export interface TaskSnapshot {
  readonly taskId: string;
  readonly owner: OwnerRef;
  readonly state: TaskState;
  readonly workPending: boolean;
  readonly cleanupFailed: boolean;
}
export interface TaskHandle {
  readonly taskId: string;
  readonly result: Promise<Result<JsonValue>>;
  readonly settled: Promise<void>;
  readonly signal: AbortSignal;
  cancel(reason?: CancelReason): boolean;
  snapshot(): TaskSnapshot;
  release(): boolean;
}
export interface TaskOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface TaskHost {
  isActive(owner: OwnerRef): boolean;
  isLive(owner: OwnerRef): boolean;
  signal(owner: OwnerRef): AbortSignal | null;
}
interface RecordState {
  id: string;
  owner: OwnerRef;
  participants: OwnerRef[];
  state: TaskState;
  controller: AbortController;
  result: Promise<Result<JsonValue>>;
  resolve: (result: Result<JsonValue>) => void;
  workPending: boolean;
  cleanupFailed: boolean;
  removers: Array<() => void>;
  timer: ReturnType<typeof setTimeout> | undefined;
  sequence: number;
  guard: (() => KernelError | null) | undefined;
}
export interface CapabilityLease {
  isValid(): boolean;
  close(): void;
  readonly signal?: AbortSignal;
}
export type CapabilityAuthorizer = (request: {
  binding: CapabilityBinding;
  method: string;
  taskId: string;
  signal: AbortSignal;
}) => Promise<CapabilityLease | null>;
const fail = (code: KernelError['code']): Result<JsonValue> => ({
  ok: false,
  error: makeError(code, false),
});
const terminal = (state: TaskState) =>
  ['completed', 'failed', 'cancelled', 'timed-out'].includes(state);
class TaskFault extends Error {
  constructor(readonly code: KernelError['code']) {
    super(code);
  }
}

/** Host-only task registry. Data results are not copied into its event metadata. */
export class TaskSupervisor {
  readonly #records = new Map<string, RecordState>();
  readonly #listeners = new Set<(event: TaskEvent<never>) => void>();
  #pending = 0;
  #closed = false;
  #observerFailures = 0;
  #cleanupFailures = 0;
  #dispatching = false;
  #clearAfterDispatch = false;
  readonly #events: TaskEvent<never>[] = [];
  constructor(
    private readonly host: TaskHost,
    private readonly maxPending = 128,
    private readonly maxRetained = 256,
  ) {
    if (
      !Number.isSafeInteger(maxPending) ||
      maxPending < 1 ||
      maxPending > 1024 ||
      !Number.isSafeInteger(maxRetained) ||
      maxRetained < 1 ||
      maxRetained > 4096
    )
      throw new Error('Invalid task limits');
  }
  private live(owner: OwnerRef, active = false): boolean {
    try {
      return active ? this.host.isActive(owner) : this.host.isLive(owner);
    } catch {
      return false;
    }
  }
  run(
    owner: OwnerRef,
    work: (context: TaskContext) => Promise<JsonValue>,
    options: TaskOptions = {},
  ): Result<TaskHandle> {
    const checked = validateStreamHeader({
      streamId: 'owner-check',
      taskId: 'owner-check',
      owner,
      sequence: 0,
      byteLength: 0,
    });
    if (!checked.ok) return checked;
    if (this.#closed || !this.live(checked.value.owner, true))
      return { ok: false, error: makeError('not-ready', false) };
    if (this.#pending >= this.maxPending)
      return { ok: false, error: makeError('quota-exceeded', true) };
    if (
      typeof work !== 'function' ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
      (options.timeoutMs !== undefined &&
        (!Number.isSafeInteger(options.timeoutMs) ||
          options.timeoutMs < 1 ||
          options.timeoutMs > 86400000))
    )
      return { ok: false, error: makeError('invalid-input', false) };
    const ownedSignal = this.host.signal(checked.value.owner);
    if (!ownedSignal || ownedSignal.aborted)
      return { ok: false, error: makeError('stale-owner', false) };
    let resolve!: RecordState['resolve'];
    const result = new Promise<Result<JsonValue>>((r) => {
      resolve = r;
    });
    const record: RecordState = {
      id: randomUUID(),
      owner: freezeJson({ ...checked.value.owner }),
      participants: [freezeJson({ ...checked.value.owner })],
      state: 'pending',
      controller: new AbortController(),
      result,
      resolve,
      workPending: true,
      cleanupFailed: false,
      removers: [],
      timer: undefined,
      sequence: 0,
      guard: undefined,
    };
    this.#records.set(record.id, record);
    this.#pending++;
    const attach = (signal: AbortSignal, reason: CancelReason) => {
      const abort = () => this.cancel(record, reason);
      if (signal.aborted) abort();
      else {
        signal.addEventListener('abort', abort, { once: true });
        record.removers.push(() => signal.removeEventListener('abort', abort));
      }
    };
    attach(ownedSignal, 'owner-disabled');
    if (options.signal) attach(options.signal, 'user');
    const deadline =
      options.timeoutMs === undefined ? undefined : performance.now() + options.timeoutMs;
    if (options.timeoutMs !== undefined && !terminal(record.state))
      record.timer = setTimeout(() => this.cancel(record, 'deadline'), options.timeoutMs);
    if (!terminal(record.state)) {
      record.state = 'running';
      this.emit(record, 'started');
    }
    const context: TaskContext = Object.freeze({
      taskId: record.id,
      owner: record.owner,
      signal: record.controller.signal,
      ...(deadline !== undefined ? { deadline } : {}),
    });
    const settled = Promise.resolve()
      .then(async () => {
        if (terminal(record.state)) return;
        if (deadline !== undefined && performance.now() >= deadline) {
          this.cancel(record, 'deadline');
          return;
        }
        if (!this.live(record.owner)) throw new TaskFault('stale-owner');
        const output = await work(context);
        if (terminal(record.state)) return;
        if (deadline !== undefined && performance.now() >= deadline) {
          this.cancel(record, 'deadline');
          return;
        }
        if (!this.live(record.owner)) {
          this.cancel(record, 'owner-disabled');
          return;
        }
        const valid = jsonPreflight(output);
        const guarded = record.guard?.();
        if (terminal(record.state)) return;
        if (deadline !== undefined && performance.now() >= deadline) {
          this.cancel(record, 'deadline');
          return;
        }
        this.finish(
          record,
          guarded
            ? { ok: false, error: guarded }
            : valid.ok
              ? { ok: true, value: valid.value }
              : fail('invalid-input'),
          guarded || !valid.ok ? 'failed' : 'completed',
        );
      })
      .catch((error) => {
        if (!terminal(record.state))
          this.finish(
            record,
            fail(
              error instanceof TaskFault
                ? error.code
                : error instanceof KernelFault
                  ? error.error.code
                  : 'internal',
            ),
            'failed',
          );
      })
      .finally(() => {
        record.workPending = false;
        this.#pending--;
        this.trim();
      });
    return {
      ok: true,
      value: Object.freeze({
        taskId: record.id,
        result,
        settled,
        signal: record.controller.signal,
        cancel: (reason: CancelReason = 'user') => this.cancel(record, reason),
        snapshot: () => this.snapshot(record),
        release: () => this.release(record.id, record.owner),
      }),
    };
  }
  private cancel(record: RecordState, reason: CancelReason): boolean {
    if (terminal(record.state)) return false;
    const code: KernelError['code'] =
      reason === 'deadline'
        ? 'timeout'
        : reason === 'owner-disabled'
          ? 'stale-owner'
          : reason === 'permission-revoked'
            ? 'permission-denied'
            : 'cancelled';
    record.state = 'cancelling';
    this.finish(record, fail(code), reason === 'deadline' ? 'timed-out' : 'cancelled');
    return true;
  }
  private finish(record: RecordState, result: Result<JsonValue>, state: TaskState): void {
    if (terminal(record.state)) return;
    record.state = state;
    if (record.timer) clearTimeout(record.timer);
    record.timer = undefined;
    for (const remove of record.removers.splice(0)) remove();
    record.controller.abort();
    if (record.cleanupFailed) {
      record.state = 'failed';
      result = fail('internal');
    }
    this.emit(
      record,
      record.state === 'completed'
        ? 'completed'
        : record.state === 'cancelled'
          ? 'cancelled'
          : 'failed',
      result.ok ? undefined : result.error,
    );
    record.resolve(freezeJson(result));
    this.trim();
  }
  private emit(record: RecordState, kind: TaskEvent<never>['kind'], error?: KernelError): void {
    const event = freezeJson({
      taskId: record.id,
      owner: record.owner,
      sequence: record.sequence++,
      kind,
      ...(error ? { error } : {}),
    });
    this.#events.push(event);
    if (this.#dispatching) return;
    this.#dispatching = true;
    try {
      while (this.#events.length) {
        const next = this.#events.shift()!;
        for (const listener of [...this.#listeners])
          try {
            listener(next);
          } catch {
            this.#observerFailures++;
          }
      }
    } finally {
      this.#dispatching = false;
      if (this.#clearAfterDispatch) {
        this.#listeners.clear();
        this.#clearAfterDispatch = false;
      }
    }
  }
  subscribe(listener: (event: TaskEvent<never>) => void): () => void {
    if (this.#closed) throw new Error('Task supervisor closed');
    if (this.#listeners.size >= 64) throw new Error('Task observer limit');
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  private snapshot(record: RecordState): TaskSnapshot {
    return Object.freeze({
      taskId: record.id,
      owner: record.owner,
      state: record.state,
      workPending: record.workPending,
      cleanupFailed: record.cleanupFailed,
    });
  }
  get(taskId: string, owner: OwnerRef): TaskSnapshot | null {
    const record = this.#records.get(taskId);
    return record && sameOwner(record.owner, owner) ? this.snapshot(record) : null;
  }
  release(taskId: string, owner: OwnerRef): boolean {
    const record = this.#records.get(taskId);
    if (!record || !sameOwner(record.owner, owner) || !terminal(record.state) || record.workPending)
      return false;
    return this.#records.delete(taskId);
  }
  private trim(): void {
    let retained = 0;
    for (const record of this.#records.values())
      if (terminal(record.state) && !record.workPending) retained++;
    for (const [id, record] of this.#records) {
      if (retained <= this.maxRetained) break;
      if (terminal(record.state) && !record.workPending) {
        this.#records.delete(id);
        retained--;
      }
    }
  }
  cancelAll(): number {
    return [...this.#records.values()].reduce(
      (count, record) => count + Number(this.cancel(record, 'user')),
      0,
    );
  }
  shutdown(): void {
    this.#closed = true;
    for (const record of this.#records.values()) this.cancel(record, 'shutdown');
    if (this.#dispatching) this.#clearAfterDispatch = true;
    else this.#listeners.clear();
  }
  taskSignal(taskId: string, requester: OwnerRef): AbortSignal | null {
    const owner = ownerFrom(requester);
    const record = this.#records.get(taskId);
    return owner &&
      record &&
      !terminal(record.state) &&
      !record.controller.signal.aborted &&
      record.participants.some((participant) => sameOwner(participant, owner)) &&
      this.live(owner)
      ? record.controller.signal
      : null;
  }
  diagnostics(): {
    activeTasks: number;
    pendingWork: number;
    retained: number;
    observers: number;
    observerFailures: number;
    cleanupFailures: number;
  } {
    return {
      activeTasks: [...this.#records.values()].filter((record) => !terminal(record.state)).length,
      pendingWork: this.#pending,
      retained: this.#records.size,
      observers: this.#listeners.size,
      observerFailures: this.#observerFailures,
      cleanupFailures: this.#cleanupFailures,
    };
  }

  invokeCapability(
    manager: PluginManager,
    owner: OwnerRef,
    capability: string,
    method: string,
    input: unknown,
    authorize?: CapabilityAuthorizer,
    options: TaskOptions = {},
  ): Result<TaskHandle> {
    const data = jsonPreflight(input);
    if (!data.ok) return { ok: false, error: makeError('invalid-input', false) };
    const bound = manager.capabilities.bind(owner, capability);
    if (!bound.ok) return bound;
    const handler = manager.capabilities.resolveBound(bound.value, method);
    if (!handler.ok) return handler;
    const providerSignal = manager.signal(bound.value.provider);
    if (!providerSignal) return { ok: false, error: makeError('stale-owner', false) };
    const combined = options.signal
      ? AbortSignal.any([providerSignal, options.signal])
      : providerSignal;
    return this.run(
      owner,
      async (context) => {
        const scoped = this.#records.get(context.taskId)!;
        if (!scoped.participants.some((owner) => sameOwner(owner, bound.value.provider)))
          scoped.participants.push(Object.freeze({ ...bound.value.provider }));
        if (!authorize) throw new TaskFault('permission-denied');
        let lease: CapabilityLease | null = null;
        let closed = false;
        let detachLease = () => {};
        const close = (value: CapabilityLease) => {
          if (closed) return;
          closed = true;
          try {
            value.close();
          } catch {
            const record = this.#records.get(context.taskId);
            if (record) record.cleanupFailed = true;
            this.#cleanupFailures++;
            throw new TaskFault('internal');
          }
        };
        const valid = () => {
          if (context.signal.aborted) throw new TaskFault('cancelled');
          if (!manager.capabilities.resolveBound(bound.value, method).ok)
            throw new TaskFault('stale-owner');
          if (lease) {
            let allowed = false;
            try {
              allowed = !lease.signal?.aborted && lease.isValid() === true;
            } catch {
              /* denied */
            }
            if (!allowed) throw new TaskFault('permission-denied');
          }
        };
        const aborted = () => {
          detachLease();
          if (lease) {
            try {
              close(lease);
            } catch {
              /* no content logging */
            }
          }
        };
        context.signal.addEventListener('abort', aborted, { once: true });
        try {
          valid();
          const pending = authorize({
            binding: bound.value,
            method,
            taskId: context.taskId,
            signal: context.signal,
          });
          void pending.then(
            (value) => {
              if (value && context.signal.aborted)
                try {
                  close(value);
                } catch {
                  /* late cleanup failure */
                }
            },
            () => {},
          );
          lease = await pending;
          valid();
          if (!lease) throw new TaskFault('permission-denied');
          const record = this.#records.get(context.taskId)!;
          record.guard = () => {
            try {
              valid();
              return null;
            } catch (error) {
              return makeError(
                error instanceof TaskFault
                  ? error.code
                  : error instanceof KernelFault
                    ? error.error.code
                    : 'internal',
                false,
              );
            }
          };
          if (lease.signal) {
            const revoke = () => this.cancel(record, 'permission-revoked');
            if (lease.signal.aborted) revoke();
            else {
              lease.signal.addEventListener('abort', revoke, { once: true });
              const leaseSignal = lease.signal;
              detachLease = () => leaseSignal.removeEventListener('abort', revoke);
            }
          }
          valid();
          const callSignal = lease.signal
            ? AbortSignal.any([context.signal, lease.signal])
            : context.signal;
          const output = await handler.value({ ...context, signal: callSignal }, data.value);
          valid();
          return output;
        } finally {
          if (!lease) {
            context.signal.removeEventListener('abort', aborted);
          } else if (context.signal.aborted) {
            aborted();
          }
        }
      },
      { ...options, signal: combined },
    );
  }
}
