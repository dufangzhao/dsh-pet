import { randomUUID } from 'node:crypto';
import { makeError, type JsonValue, type MediaFrame, type Result } from '@pet/contracts';
import {
  KernelFault,
  SensitivePeer,
  type SecretRedactor,
  type SensitiveReference,
  type TaskHandle,
} from '@pet/host-kernel';
import type { LocalPluginKernel } from './kernel.js';

/** Metadata only. The receiver already registered this exact real management task before publishing it. */
export interface ManagementSecretTicket {
  readonly reference: SensitiveReference;
}
interface PendingSecret {
  readonly task: TaskHandle;
  readonly result: Promise<Result<JsonValue>>;
}
const failure = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
const errorOf = (error: unknown): Result<never> =>
  failure(error instanceof KernelFault ? error.error.code : 'unavailable');

/** Per authenticated GUI session; no owner/task, key text or provider is selected by network metadata. */
export class ManagementSecretSession {
  private readonly lifetime = new AbortController();
  private readonly pending = new Map<string, PendingSecret>();
  private readonly peer: SensitivePeer;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly options: {
      readonly runManagement: LocalPluginKernel['runManagement'];
      readonly redactor: SecretRedactor;
      write(frame: MediaFrame): Promise<Result<null>>;
    },
  ) {
    this.peer = new SensitivePeer({
      write: options.write,
      observe: (secret) => {
        options.redactor.add(secret);
        return true;
      },
    });
  }
  receive(frame: MediaFrame): Result<null> {
    return this.peer.receive(frame);
  }
  async prepare(
    operation: (secret: string, signal: AbortSignal) => Promise<JsonValue>,
  ): Promise<Result<ManagementSecretTicket>> {
    if (this.lifetime.signal.aborted) return failure('unavailable');
    if (this.pending.size >= 16) return failure('quota-exceeded');
    const streamId = randomUUID();
    let release = (): void => {};
    const start = new Promise<void>((resolve) => {
      release = resolve;
    });
    let publish = (_ticket: Result<ManagementSecretTicket>): void => {};
    const ready = new Promise<Result<ManagementSecretTicket>>((resolve) => {
      publish = resolve;
    });
    let complete = (_result: Result<JsonValue>): void => {};
    const result = new Promise<Result<JsonValue>>((resolve) => {
      complete = resolve;
    });
    let observed: Result<JsonValue> | undefined;
    let task: TaskHandle;
    try {
      task = this.options.runManagement(
        async (context) => {
          await start;
          const reference: SensitiveReference = {
            owner: { ...context.owner },
            taskId: context.taskId,
            streamId,
          };
          const incoming = this.peer.accept(reference, context.signal, async (secret, signal) => {
            try {
              signal.throwIfAborted();
              const value = await operation(secret, signal);
              // A known committed mutation remains a fact when its GUI/ACK subsequently disappears.
              observed = this.options.redactor.containsValue(value)
                ? failure('permission-denied')
                : { ok: true, value };
            } catch (error) {
              observed = errorOf(error);
            }
            return null;
          });
          if (!this.peer.registered(reference)) {
            const refused = await incoming;
            const error = refused.ok ? failure('unavailable') : refused;
            publish(error);
            complete(error);
            return null;
          }
          publish({ ok: true, value: { reference } });
          try {
            const accepted = await incoming;
            await this.peer.drain(reference);
            complete(observed ?? (accepted.ok ? { ok: true, value: null } : accepted));
          } finally {
            this.peer.discard(reference);
            await this.peer.drain(reference);
          }
          return null;
        },
        { signal: this.lifetime.signal, timeoutMs: 30000 },
      );
    } catch (error) {
      return errorOf(error);
    }
    this.pending.set(streamId, { task, result });
    void task.result.then((value) => {
      if (!value.ok) publish(value);
    });
    void task.settled.then(async () => {
      const ended = await task.result;
      complete(observed ?? (ended.ok ? { ok: true, value: null } : ended));
    });
    release();
    const issued = await ready;
    if (!issued.ok) {
      await task.settled;
      this.pending.delete(streamId);
      task.release();
    }
    return issued;
  }
  cancel(streamId: string): Result<null> {
    const pending = this.pending.get(streamId);
    if (!pending) return failure('permission-denied');
    pending.task.cancel();
    return { ok: true, value: null };
  }
  async finish(streamId: string): Promise<Result<JsonValue>> {
    const pending = this.pending.get(streamId);
    if (!pending) return failure('permission-denied');
    const result = await pending.result;
    await pending.task.settled;
    this.pending.delete(streamId);
    pending.task.release();
    return result;
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.lifetime.abort();
      this.peer.close();
      for (const { task } of this.pending.values()) task.cancel();
      await this.peer.drain();
      await Promise.all(
        [...this.pending.values()].map(async ({ task }) => {
          await task.settled;
          task.release();
        }),
      );
      this.pending.clear();
      // The daemon/root redactor and committed Source/AgentLink slots outlive this GUI session.
    })());
  }
}
