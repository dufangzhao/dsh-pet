import {
  makeError,
  type CancelReason,
  type ControlMessage,
  type JsonValue,
  type KernelError,
  type OwnerRef,
  type RequestMessage,
  type StreamCreditMessage,
  type StreamEndMessage,
  type Result,
} from '@pet/contracts';
import { jsonPreflight, validateControlMessage } from '@pet/contracts/validation';
import { sameOwner } from '../runtime/identity.js';
export interface ControlTransport {
  send(message: ControlMessage): Promise<void>;
  onMessage(listener: (value: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  close(): void;
}
export interface RpcContext {
  readonly owner: OwnerRef;
  readonly requestId: string;
  readonly taskId: string | undefined;
  readonly signal: AbortSignal;
  readonly budgetMs: number;
}
export type RpcHandler = (context: RpcContext, payload: JsonValue) => Promise<Result<JsonValue>>;
export interface RpcOptions {
  readonly sessionId: string;
  readonly owner: OwnerRef;
  readonly live: () => boolean;
  readonly handlers?: Readonly<Record<string, RpcHandler>>;
  readonly signal?: AbortSignal;
  readonly maxPending?: number;
  readonly onStreamControl?: (message: StreamCreditMessage | StreamEndMessage) => void;
}
interface Outbound {
  resolve: (result: Result<JsonValue>) => void;
  taskId: string | undefined;
  remove: () => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Inbound {
  controller: AbortController;
  taskId: string | undefined;
  timer: ReturnType<typeof setTimeout>;
  terminal: boolean;
}
export class ControlEndpoint {
  readonly #out = new Map<string, Outbound>();
  readonly #in = new Map<string, Inbound>();
  readonly #detach: Array<() => void> = [];
  readonly #handlers = new Map<string, RpcHandler>();
  #sequence = 0;
  #received = 0;
  #closed = false;
  #sending = 0;
  #late = 0;
  readonly #limit: number;
  readonly #owner: OwnerRef;
  readonly #sessionId: string;
  constructor(
    private readonly transport: ControlTransport,
    private readonly options: RpcOptions,
  ) {
    this.#limit = options.maxPending ?? 64;
    if (!Number.isSafeInteger(this.#limit) || this.#limit < 1 || this.#limit > 256)
      throw new Error('Invalid RPC limit');
    const seed = validateControlMessage({
      protocol: 1,
      sessionId: options.sessionId,
      id: 'm-1',
      owner: options.owner,
      type: 'cancel',
      taskId: 'check',
      reason: 'user',
    });
    if (!seed.ok) throw new Error('Invalid RPC identity');
    this.#owner = Object.freeze({ ...seed.value.owner });
    this.#sessionId = seed.value.sessionId;
    for (const [method, handler] of Object.entries(options.handlers ?? {})) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(method) ||
        ['constructor', 'prototype', '__proto__'].includes(method) ||
        typeof handler !== 'function'
      )
        throw new Error('Invalid RPC handler');
      this.#handlers.set(method, handler);
    }
    this.#detach.push(
      transport.onMessage((value) => this.receive(value)),
      transport.onClose(() => this.close()),
    );
    if (options.signal) {
      const abort = () => this.close();
      if (options.signal.aborted) this.close();
      else {
        options.signal.addEventListener('abort', abort, { once: true });
        this.#detach.push(() => options.signal?.removeEventListener('abort', abort));
      }
    }
  }
  private live(): boolean {
    try {
      return this.options.live() === true && !this.#closed;
    } catch {
      return false;
    }
  }
  private base() {
    return {
      protocol: 1 as const,
      sessionId: this.#sessionId,
      id: 'm-' + ++this.#sequence,
      owner: { ...this.#owner },
    };
  }
  private send(message: ControlMessage): void {
    if (this.#closed) return;
    if (this.#sending >= this.#limit * 2) {
      this.close();
      return;
    }
    const parsed = validateControlMessage(message);
    if (!parsed.ok) {
      this.close();
      return;
    }
    this.#sending++;
    void this.transport
      .send(parsed.value)
      .catch(() => this.close())
      .finally(() => {
        this.#sending--;
      });
  }
  request(
    method: string,
    payload: JsonValue,
    options: { taskId?: string; signal?: AbortSignal; budgetMs?: number } = {},
  ): Promise<Result<JsonValue>> {
    if (!this.live()) return Promise.resolve({ ok: false, error: makeError('unavailable', false) });
    if (this.#out.size >= this.#limit)
      return Promise.resolve({ ok: false, error: makeError('quota-exceeded', true) });
    if (options.signal?.aborted)
      return Promise.resolve({ ok: false, error: makeError('cancelled', false) });
    const budget = options.budgetMs ?? 30000;
    const candidate = {
      ...this.base(),
      type: 'request' as const,
      method,
      payload,
      taskId: options.taskId ?? 'rpc-' + this.#sequence,
      budgetMs: budget,
    };
    const parsed = validateControlMessage(candidate);
    if (!parsed.ok) {
      this.#sequence--;
      return Promise.resolve(parsed);
    }
    const message = parsed.value as RequestMessage;
    return new Promise((resolve) => {
      const finish = (error: KernelError, reason: CancelReason) => {
        const pending = this.#out.get(message.id);
        if (!pending) return;
        this.#out.delete(message.id);
        clearTimeout(pending.timer);
        pending.remove();
        if (message.taskId)
          this.send({ ...this.base(), type: 'cancel', taskId: message.taskId, reason });
        resolve({ ok: false, error });
      };
      const abort = () => finish(makeError('cancelled', false), 'user');
      const timer = setTimeout(() => finish(makeError('timeout', false), 'deadline'), budget);
      this.#out.set(message.id, {
        resolve,
        taskId: message.taskId,
        remove: () => options.signal?.removeEventListener('abort', abort),
        timer,
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      this.send(message);
    });
  }
  streamControl(
    message:
      | Omit<StreamCreditMessage, 'protocol' | 'id' | 'sessionId' | 'owner'>
      | Omit<StreamEndMessage, 'protocol' | 'id' | 'sessionId' | 'owner'>,
  ): Result<null> {
    if (!this.live()) return { ok: false, error: makeError('unavailable', false) };
    const safe = jsonPreflight(message);
    if (!safe.ok || !safe.value || typeof safe.value !== 'object' || Array.isArray(safe.value))
      return { ok: false, error: makeError('invalid-input', false) };
    const body = safe.value;
    if (
      ['protocol', 'id', 'sessionId', 'owner'].some((key) => Object.hasOwn(body, key)) ||
      !['stream-credit', 'stream-end'].includes(String(body['type']))
    )
      return { ok: false, error: makeError('invalid-input', false) };
    const candidate = { ...body, ...this.base() };
    const parsed = validateControlMessage(candidate);
    if (!parsed.ok) {
      this.#sequence--;
      return parsed;
    }
    this.send(parsed.value);
    return { ok: true, value: null };
  }
  private receive(input: unknown): void {
    if (this.#closed) return;
    const parsed = validateControlMessage(input);
    if (!parsed.ok) {
      this.close();
      return;
    }
    const message = parsed.value;
    const expected = 'm-' + (this.#received + 1);
    if (
      message.sessionId !== this.#sessionId ||
      !sameOwner(message.owner, this.#owner) ||
      message.id !== expected
    ) {
      this.close();
      return;
    }
    this.#received++;
    if (message.type === 'response') {
      const pending = this.#out.get(message.replyTo);
      if (!pending) {
        this.#late++;
        return;
      }
      this.#out.delete(message.replyTo);
      clearTimeout(pending.timer);
      pending.remove();
      pending.resolve(
        this.live() ? message.result : { ok: false, error: makeError('stale-owner', false) },
      );
      return;
    }
    if (message.type === 'cancel') {
      for (const [id, pending] of this.#in)
        if (pending.taskId === message.taskId && !pending.terminal) {
          pending.terminal = true;
          clearTimeout(pending.timer);
          pending.controller.abort();
          this.send({
            ...this.base(),
            type: 'response',
            replyTo: id,
            result: {
              ok: false,
              error: makeError(message.reason === 'deadline' ? 'timeout' : 'cancelled', false),
            },
          });
        }
      return;
    }
    if (message.type === 'stream-credit' || message.type === 'stream-end') {
      if (!this.live() || !this.options.onStreamControl) {
        this.close();
        return;
      }
      try {
        this.options.onStreamControl(message);
      } catch {
        this.close();
      }
      return;
    }
    if (message.type !== 'request') {
      this.close();
      return;
    }
    if (!this.live()) {
      this.send({
        ...this.base(),
        type: 'response',
        replyTo: message.id,
        result: { ok: false, error: makeError('stale-owner', false) },
      });
      return;
    }
    const handler = this.#handlers.get(message.method);
    if (!handler) {
      this.send({
        ...this.base(),
        type: 'response',
        replyTo: message.id,
        result: { ok: false, error: makeError('permission-denied', false) },
      });
      return;
    }
    if (this.#in.size >= this.#limit) {
      this.send({
        ...this.base(),
        type: 'response',
        replyTo: message.id,
        result: { ok: false, error: makeError('quota-exceeded', true) },
      });
      return;
    }
    const controller = new AbortController();
    const budget = message.budgetMs ?? 30000;
    const deadline = performance.now() + budget;
    const pending: Inbound = {
      controller,
      taskId: message.taskId,
      timer: setTimeout(() => {
        if (pending.terminal) return;
        pending.terminal = true;
        controller.abort();
        this.send({
          ...this.base(),
          type: 'response',
          replyTo: message.id,
          result: { ok: false, error: makeError('timeout', false) },
        });
      }, budget),
      terminal: false,
    };
    this.#in.set(message.id, pending);
    void Promise.resolve()
      .then(async () => {
        if (pending.terminal || this.#closed) return;
        if (!this.live()) {
          pending.terminal = true;
          this.send({
            ...this.base(),
            type: 'response',
            replyTo: message.id,
            result: { ok: false, error: makeError('stale-owner', false) },
          });
          return;
        }
        let result: Result<JsonValue>;
        try {
          result = await handler(
            Object.freeze({
              owner: Object.freeze({ ...message.owner }),
              requestId: message.id,
              taskId: message.taskId,
              signal: controller.signal,
              budgetMs: budget,
            }),
            message.payload,
          );
        } catch {
          result = { ok: false, error: makeError('internal', false) };
        }
        if (pending.terminal || this.#closed) return;
        pending.terminal = true;
        if (performance.now() >= deadline)
          result = { ok: false, error: makeError('timeout', false) };
        else if (!this.live()) result = { ok: false, error: makeError('stale-owner', false) };
        const response = { ...this.base(), type: 'response' as const, replyTo: message.id, result };
        const checked = validateControlMessage(response);
        this.send(
          checked.ok
            ? checked.value
            : { ...response, result: { ok: false, error: makeError('internal', false) } },
        );
      })
      .catch(() => this.close())
      .finally(() => {
        clearTimeout(pending.timer);
        controller.abort();
        this.#in.delete(message.id);
      });
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const detach of this.#detach.splice(0)) detach();
    for (const pending of this.#out.values()) {
      clearTimeout(pending.timer);
      pending.remove();
      pending.resolve({ ok: false, error: makeError('unavailable', false) });
    }
    this.#out.clear();
    for (const pending of this.#in.values()) {
      pending.terminal = true;
      clearTimeout(pending.timer);
      pending.controller.abort();
    }
    this.transport.close();
  }
  diagnostics(): {
    closed: boolean;
    pendingRequests: number;
    runningHandlers: number;
    lateResponses: number;
    sending: number;
  } {
    return {
      closed: this.#closed,
      pendingRequests: this.#out.size,
      runningHandlers: this.#in.size,
      lateResponses: this.#late,
      sending: this.#sending,
    };
  }
}
