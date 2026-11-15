import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  QQ_FEATURE_PLUGIN_ID,
  LOCAL_HOST_AUTHORITY_CHECK_MAX_MS,
  makeError,
  sameQQAccount,
  type KernelError,
  type LocalHostAuthorityPermit,
  type LocalHostAuthorityRequest,
  type LocalHostSourceBinding,
  type LocalHostProcessIdentity,
  type LocalHostTaskReference,
  type QQAccountRef,
  type QQDeliveryAttempt,
  type QQDeliveryView,
  type TaskContext,
} from '@pet/contracts';
import {
  jsonPreflight,
  validateLocalHostSourceBinding,
  validateLocalHostProcessIdentity,
  validateLocalHostTaskReference,
} from '@pet/contracts/validation';
import { KernelFault, type TaskHandle } from '@pet/host-kernel';
import type { CompanionPluginHost, CompanionRuntime } from '@pet/companion-runtime';
import type { DeliveryTaskBinding, StoredDeliveryExecution } from '@pet/state-sqlite';
import type { BridgeChannel } from '@pet/local-host';
import {
  parseQQExecutionFact,
  parseQQExecutionIdentity,
  parseQQExecutionResult,
  parseQQExecutionRecoveryResult,
  qqDeliveryContentHash,
  qqExecutionJson,
} from '../../../packages/local-host/src/qq-execution.js';
import type {
  QQDeliveryOutcome,
  QQDeliveryProgress,
  QQDeliveryRequest,
  QQDeliverySource,
  QQExecutionIdentity,
  QQExecutionRequest,
  QQExecutionResult,
  QQExecutionRecoveryRequest,
} from '../../../packages/local-host/src/qq-delivery-types.js';
import type { QQDeliveryExecutionSelection } from './qq-delivery.js';

/** Supplied only by the authenticated registry, never constructed from an RPC owner label. */
export interface QQRemotePeer {
  readonly peer: BridgeChannel;
  readonly account: QQAccountRef;
  readonly binding: LocalHostSourceBinding;
  readonly processIdentity: LocalHostProcessIdentity;
  readonly signal: AbortSignal;
  check(): Promise<void>;
  /** Maps this real local TaskHandle to the peer's transport namespace. */
  registerMediaTask(handle: TaskHandle): () => void;
}
export type QQRemoteCapture =
  | { readonly kind: 'available'; readonly source: QQRemotePeer }
  | { readonly kind: 'unavailable'; readonly hostId: string | null; readonly error: KernelError };
export interface QQRemoteDeliveryOptions {
  readonly host: CompanionPluginHost;
  readonly runtime: Pick<CompanionRuntime, 'state'>;
  capture(account: QQAccountRef): QQRemoteCapture | Promise<QQRemoteCapture>;
}
interface ActiveAttempt {
  readonly endpoint: QQRemotePeer;
  readonly request: QQDeliveryRequest;
  readonly task: TaskHandle;
  readonly authorizations: Set<Promise<unknown>>;
  readonly contentHash: string;
  localTask: LocalHostTaskReference | null;
}
interface RemoteHold {
  readonly account: QQAccountRef;
  readonly identity: QQExecutionIdentity;
}
const scope = { kind: 'management' as const };
const key = (id: string, partId: string, attemptId: string): string =>
  JSON.stringify([id, partId, attemptId]);
const fault = (error: unknown): KernelError =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
const stateBinding = (identity: QQExecutionIdentity): DeliveryTaskBinding => ({
  id: identity.deliveryId,
  partId: identity.partId,
  attemptId: identity.attemptId,
  binding: identity.binding,
  task: identity.task,
  contentHash: identity.contentHash,
});
function attemptIn(delivery: QQDeliveryView, partId: string, attemptId: string): QQDeliveryAttempt {
  const part = delivery.parts.find((part) => part.id === partId);
  const attempt = [part?.upload, part?.send].find((attempt) => attempt?.id === attemptId);
  if (!attempt) throw new KernelFault('unavailable');
  return attempt;
}
function executionIdentity(
  delivery: QQDeliveryView,
  execution: StoredDeliveryExecution,
  partId: string,
  attemptId: string,
): QQExecutionIdentity | null {
  const entry = execution.attempts.find(
    (entry) => entry.partId === partId && entry.attemptId === attemptId,
  );
  if (execution.target.kind !== 'remote' || !entry?.task) return null;
  return {
    binding: execution.target.binding,
    task: entry.task,
    deliveryId: delivery.id,
    partId,
    attemptId,
    contentHash: entry.contentHash,
    operation: entry.operation,
  };
}

/** Server-side dispatch/fact owner. No native retry, outbox, replacement target or serialized grant. */
export class QQRemoteDelivery {
  private readonly lifetime = new AbortController();
  private readonly active = new Map<string, ActiveAttempt>();
  private readonly holds = new Map<string, RemoteHold>();
  private readonly work = new Set<Promise<unknown>>();
  private initialized: Promise<void> | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private localCleanupFailure = false;
  constructor(private readonly options: QQRemoteDeliveryOptions) {}
  private track<T>(work: Promise<T>): Promise<T> {
    this.work.add(work);
    void work.then(
      () => this.work.delete(work),
      () => this.work.delete(work),
    );
    return work;
  }
  private initialize(): Promise<void> {
    return (this.initialized ??= this.track(
      (async () => {
        let after: string | undefined;
        do {
          const page = await this.options.runtime.state('deliveries', {
            scope,
            ...(after ? { after } : {}),
          });
          for (const summary of page.deliveries) {
            if (summary.phase === 'blocked') continue;
            const execution = await this.options.runtime.state('getDeliveryExecution', {
              id: summary.id,
              scope,
            });
            if (execution?.target.kind !== 'remote') continue;
            const delivery = await this.options.runtime.state('getDelivery', {
              id: summary.id,
              scope,
            });
            for (const entry of execution.attempts) {
              const attempt = attemptIn(delivery, entry.partId, entry.attemptId);
              const identity = executionIdentity(
                delivery,
                execution,
                entry.partId,
                entry.attemptId,
              );
              if (identity && attempt.cleanup !== 'settled')
                this.holds.set(key(delivery.id, entry.partId, entry.attemptId), {
                  account: delivery.route.account,
                  identity,
                });
            }
          }
          after = page.next ?? undefined;
        } while (after);
      })(),
    ));
  }
  private held(account: QQAccountRef): boolean {
    return [...this.holds.values()].some((hold) => sameQQAccount(hold.account, account));
  }
  async executionFor(account: QQAccountRef): Promise<QQDeliveryExecutionSelection> {
    if (this.closed || this.localCleanupFailure) throw new KernelFault('not-ready');
    await this.initialize();
    const selected = await this.options.capture(account);
    if (selected.kind === 'unavailable')
      return {
        kind: 'unavailable',
        execution: { kind: 'unavailable', hostId: selected.hostId },
        error: selected.error,
      };
    const endpoint = selected.source;
    if (this.held(account))
      return {
        kind: 'unavailable',
        execution: { kind: 'unavailable', hostId: endpoint.binding.hostId },
        error: makeError('not-ready', false),
      };
    const checked = validateLocalHostSourceBinding(endpoint.binding);
    const processIdentity = validateLocalHostProcessIdentity(endpoint.processIdentity);
    if (
      !checked.ok ||
      !processIdentity.ok ||
      !sameQQAccount(endpoint.account, account) ||
      endpoint.binding.sourceOwner.pluginId !== account.sourcePluginId ||
      endpoint.binding.sourceOwner.instanceId !== account.instanceId ||
      endpoint.binding.hostId !== endpoint.peer.context.hostId ||
      endpoint.binding.hostBootId !== endpoint.peer.context.bootId ||
      endpoint.binding.bridgeSessionId !== endpoint.peer.context.sessionId
    )
      throw new KernelFault('stale-owner');
    const captured: QQRemotePeer = {
      ...endpoint,
      account: structuredClone(endpoint.account),
      binding: checked.value,
      processIdentity: Object.freeze(processIdentity.value),
      check: endpoint.check.bind(endpoint),
      registerMediaTask: endpoint.registerMediaTask.bind(endpoint),
    };
    const revoked = new AbortController();
    const signal = AbortSignal.any([
      endpoint.signal,
      endpoint.peer.signal,
      this.lifetime.signal,
      revoked.signal,
    ]);
    const check = async (): Promise<void> => {
      try {
        signal.throwIfAborted();
        await captured.check();
        if (this.held(account)) throw new KernelFault('not-ready');
        signal.throwIfAborted();
      } catch (error) {
        revoked.abort();
        throw error;
      }
    };
    await check();
    const source: QQDeliverySource = {
      account: captured.account,
      connectionId: captured.binding.nativeConnectionId,
      signal,
      check,
      transport: {
        execute: (request, caller, progress) =>
          this.execute(captured, request, AbortSignal.any([caller, signal]), progress),
      },
    };
    return {
      kind: 'available',
      source,
      execution: { kind: 'remote', binding: structuredClone(captured.binding) },
    };
  }
  private async current(
    entry: ActiveAttempt,
  ): Promise<{ delivery: QQDeliveryView; execution: StoredDeliveryExecution }> {
    await entry.request.check();
    entry.task.signal.throwIfAborted();
    await entry.endpoint.check();
    const delivery = await this.options.runtime.state('getDelivery', {
      id: entry.request.delivery.id,
      scope,
    });
    const execution = await this.options.runtime.state('getDeliveryExecution', {
      id: delivery.id,
      scope,
    });
    const attempt = attemptIn(delivery, entry.request.part.id, entry.request.attemptId);
    const part = delivery.parts.find((part) => part.id === entry.request.part.id);
    if (
      !execution ||
      execution.target.kind !== 'remote' ||
      !isDeepStrictEqual(execution.target.binding, entry.endpoint.binding) ||
      delivery.phase !== 'sending' ||
      delivery.outcome !== 'pending' ||
      attempt.phase === 'settled' ||
      attempt.outcome !== 'pending' ||
      attempt.operation !== entry.request.operation ||
      !part ||
      qqDeliveryContentHash(part) !== entry.contentHash ||
      !isDeepStrictEqual(part.content, entry.request.part.content) ||
      !isDeepStrictEqual(delivery.route, entry.request.delivery.route) ||
      !isDeepStrictEqual(
        { ...delivery, updatedAt: entry.request.delivery.updatedAt },
        entry.request.delivery,
      )
    )
      throw new KernelFault('permission-denied');
    await entry.request.check();
    entry.task.signal.throwIfAborted();
    return { delivery, execution };
  }
  /** Fresh business authorization; State bind-once commits before permission leaves the server. */
  authority(
    peer: BridgeChannel,
    input: LocalHostAuthorityRequest,
  ): Promise<LocalHostAuthorityPermit> {
    if (this.closed || input.kind !== 'delivery')
      return Promise.reject(new KernelFault('not-ready'));
    const binding = validateLocalHostSourceBinding(input.binding),
      task = validateLocalHostTaskReference(input.task);
    if (!binding.ok || !task.ok) return Promise.reject(new KernelFault('invalid-input'));
    const entry = this.active.get(key(input.deliveryId, input.partId, input.attemptId));
    if (
      !entry ||
      entry.endpoint.peer !== peer ||
      peer.signal.aborted ||
      !isDeepStrictEqual(binding.value, entry.endpoint.binding) ||
      !isDeepStrictEqual(task.value.owner, binding.value.sourceOwner) ||
      input.contentHash !== entry.contentHash
    )
      return Promise.reject(new KernelFault('permission-denied'));
    const work = (async () => {
      const { delivery } = await this.current(entry);
      if (entry.localTask && !isDeepStrictEqual(entry.localTask, task.value))
        throw new KernelFault('conflict');
      await this.options.runtime.state('bindDeliveryTask', {
        id: delivery.id,
        partId: input.partId,
        attemptId: input.attemptId,
        binding: binding.value,
        task: task.value,
        contentHash: input.contentHash,
        processIdentity: entry.endpoint.processIdentity,
      });
      entry.localTask = task.value;
      await entry.request.check();
      entry.task.signal.throwIfAborted();
      if (peer.signal.aborted) throw new KernelFault('stale-owner');
      const remaining =
        delivery.eligibilityExpiresAt === null
          ? LOCAL_HOST_AUTHORITY_CHECK_MAX_MS
          : delivery.eligibilityExpiresAt - Date.now();
      if (remaining < 1) throw new KernelFault('not-ready');
      return { validForMs: Math.min(LOCAL_HOST_AUTHORITY_CHECK_MAX_MS, remaining) };
    })();
    entry.authorizations.add(work);
    void work.then(
      () => entry.authorizations.delete(work),
      () => entry.authorizations.delete(work),
    );
    return this.track(work);
  }
  private async hold(entry: ActiveAttempt, outcome: QQDeliveryOutcome): Promise<void> {
    if (outcome.cleanup === 'settled') return;
    const execution = await this.options.runtime.state('getDeliveryExecution', {
      id: entry.request.delivery.id,
      scope,
    });
    if (!execution) throw new KernelFault('unavailable');
    const identity = executionIdentity(
      entry.request.delivery,
      execution,
      entry.request.part.id,
      entry.request.attemptId,
    );
    // No task bind means no positive native authority was ever issued. Keep the uncertain public
    // attempt, but do not invent a native resource/task hold from an unauthenticated wire label.
    if (identity)
      this.holds.set(key(identity.deliveryId, identity.partId, identity.attemptId), {
        account: entry.request.delivery.route.account,
        identity,
      });
  }
  private execute(
    endpoint: QQRemotePeer,
    raw: QQDeliveryRequest,
    signal: AbortSignal,
    progress: (value: QQDeliveryProgress) => Promise<void>,
  ): Promise<QQDeliveryOutcome> {
    if (
      this.closed ||
      !raw.executionBinding ||
      !isDeepStrictEqual(raw.executionBinding, endpoint.binding) ||
      raw.expectedConnectionId !== endpoint.binding.nativeConnectionId
    )
      return Promise.reject(new KernelFault('stale-owner'));
    const request = {
      ...raw,
      delivery: structuredClone(raw.delivery),
      part: structuredClone(raw.part),
      check: raw.check.bind(raw),
    };
    const id = key(request.delivery.id, request.part.id, request.attemptId);
    if (this.active.has(id)) return Promise.reject(new KernelFault('conflict'));
    let actual: QQDeliveryOutcome | undefined;
    let sent = false,
      failure: unknown;
    let release: (() => void) | undefined;
    const handle = this.options.host.runFor(
      QQ_FEATURE_PLUGIN_ID,
      async (context: TaskContext) => {
        let produced: Promise<void> | undefined;
        let cancelTransfer = (): void => {};
        try {
          await this.current(entry);
          release = endpoint.registerMediaTask(handle);
          const payload: QQExecutionRequest = {
            binding: endpoint.binding,
            delivery: request.delivery,
            partId: request.part.id,
            attemptId: request.attemptId,
            operation: request.operation,
            ...(request.uploaded === undefined
              ? {}
              : { continuation: this.continuation(request.uploaded) }),
            ...(request.operation === 'send'
              ? {}
              : {
                  stream: {
                    owner: endpoint.peer.context.owner,
                    taskId: handle.taskId,
                    streamId: randomUUID(),
                  },
                }),
          };
          const encoded = qqExecutionJson(payload);
          const opened = payload.stream
            ? endpoint.peer.media.createWriter(payload.stream)
            : undefined;
          if (opened && !opened.ok) throw new KernelFault(opened.error.code);
          const writer = opened?.ok ? opened.value : undefined;
          const transfer = new AbortController();
          const transferSignal = AbortSignal.any([context.signal, transfer.signal]);
          cancelTransfer = () => {
            transfer.abort();
            writer?.cancel();
          };
          const writing = writer
            ? (async () => {
                if (!request.bytes) throw new KernelFault('invalid-input');
                const iterator = request.bytes[Symbol.asyncIterator]();
                let readFailure: unknown;
                try {
                  while (true) {
                    transferSignal.throwIfAborted();
                    await request.check();
                    const next = await iterator.next();
                    if (next.done) break;
                    const result = await writer.write(next.value);
                    if (!result.ok) throw new KernelFault(result.error.code);
                  }
                  const end = await writer.end();
                  if (!end.ok) throw new KernelFault(end.error.code);
                } catch (error) {
                  readFailure = error;
                }
                try {
                  await iterator.return?.();
                } catch (error) {
                  this.localCleanupFailure = true;
                  throw new AggregateError(
                    [...(readFailure === undefined ? [] : [readFailure]), error],
                    'Server media reader cleanup failed',
                    { cause: error },
                  );
                }
                if (readFailure !== undefined) throw readFailure;
              })()
            : Promise.resolve();
          produced = writing;
          void writing.catch(() => transfer.abort());
          sent = true;
          const response = endpoint.peer.rpc
            .request('delivery.execute', encoded, {
              taskId: handle.taskId,
              signal: transferSignal,
              budgetMs: 300000,
            })
            .then((reply) => {
              if (!reply.ok) {
                writer?.cancel();
                return reply;
              }
              const result = parseQQExecutionResult(reply.value);
              if (result.fact.outcome.outcome !== 'accepted' || result.fact.outcome.error !== null)
                writer?.cancel();
              return { ok: true as const, value: result };
            });
          void response.catch(() => writer?.cancel());
          const both = await Promise.allSettled([response, writing]);
          transfer.abort();
          writer?.cancel();
          if (both[0]?.status !== 'fulfilled') throw new KernelFault('unavailable');
          const reply = both[0].value;
          if (reply.ok) {
            const result = reply.value;
            await this.matchResult(entry, result);
            actual = {
              ...result.fact.outcome,
              ...(result.continuation ? { uploaded: result.continuation } : {}),
            };
            await progress({
              dispatched: actual.dispatched,
              receipt: actual.receipt,
              correlationId: actual.correlationId ?? null,
            });
          } else throw new KernelFault(reply.error.code);
          const rejected = both.find((item) => item.status === 'rejected');
          if (rejected?.status === 'rejected') throw rejected.reason;
        } catch (error) {
          failure = error;
        } finally {
          cancelTransfer();
          await Promise.allSettled([...(produced ? [produced] : []), ...entry.authorizations]);
          release?.();
        }
        return null;
      },
      { signal: AbortSignal.any([signal, this.lifetime.signal]), timeoutMs: 300000 },
    );
    const entry: ActiveAttempt = {
      endpoint,
      request,
      task: handle,
      authorizations: new Set(),
      contentHash: qqDeliveryContentHash(request.part),
      localTask: null,
    };
    this.active.set(id, entry);
    const work = (async (): Promise<QQDeliveryOutcome> => {
      const logical = await handle.result;
      await handle.settled;
      if (handle.snapshot().cleanupFailed) this.localCleanupFailure = true;
      if (!actual)
        actual = {
          dispatched: sent,
          outcome: sent ? 'unknown' : signal.aborted ? 'cancelled-before-dispatch' : 'failed',
          receipt: null,
          cleanup: sent ? 'unknown' : 'settled',
          error: fault(failure ?? (logical.ok ? null : logical.error)),
        };
      else if (failure !== undefined) actual = { ...actual, error: actual.error ?? fault(failure) };
      await this.hold(entry, actual);
      return actual;
    })().finally(() => this.active.delete(id));
    return this.track(work);
  }
  private continuation(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
      throw new KernelFault('invalid-input');
    return value;
  }
  private async matchResult(entry: ActiveAttempt, result: QQExecutionResult): Promise<void> {
    const fact = result.fact;
    if (
      !isDeepStrictEqual(fact.binding, entry.endpoint.binding) ||
      fact.deliveryId !== entry.request.delivery.id ||
      fact.partId !== entry.request.part.id ||
      fact.attemptId !== entry.request.attemptId ||
      fact.operation !== entry.request.operation ||
      fact.contentHash !== entry.contentHash
    )
      throw new KernelFault('conflict');
    const execution = await this.options.runtime.state('getDeliveryExecution', {
      id: fact.deliveryId,
      scope,
    });
    const bound = execution?.attempts.find(
      (attempt) => attempt.partId === fact.partId && attempt.attemptId === fact.attemptId,
    );
    if (
      !bound ||
      (bound.task
        ? !isDeepStrictEqual(bound.task, fact.task)
        : fact.outcome.dispatched || fact.outcome.receipt !== null)
    )
      throw new KernelFault('permission-denied');
  }
  /** Terminal facts are accepted through the current authenticated reporting channel only. */
  report(peer: BridgeChannel, input: unknown): Promise<QQDeliveryView> {
    if (this.closed || peer.signal.aborted) return Promise.reject(new KernelFault('not-ready'));
    const fact = parseQQExecutionFact(input);
    if (
      fact.binding.hostId !== peer.context.hostId ||
      fact.binding.hostBootId !== peer.context.bootId
    )
      return Promise.reject(new KernelFault('permission-denied'));
    return this.track(
      (async () => {
        await this.initialize();
        const delivery = await this.options.runtime.state('enrichDeliveryAttempt', {
          ...stateBinding(fact),
          fact: {
            dispatch: fact.outcome.dispatched
              ? 'dispatched'
              : fact.outcome.outcome === 'unknown'
                ? 'unknown'
                : 'not-dispatched',
            outcome: fact.outcome.outcome,
            correlationId: fact.outcome.correlationId ?? null,
            receipt: fact.outcome.receipt,
            cleanup: fact.outcome.cleanup,
            error: fact.outcome.error,
          },
        });
        if (fact.outcome.cleanup === 'settled')
          this.holds.delete(key(fact.deliveryId, fact.partId, fact.attemptId));
        return delivery;
      })(),
    );
  }
  async reconcile(peer: BridgeChannel, input: QQExecutionIdentity): Promise<QQDeliveryView | null> {
    const identity = parseQQExecutionIdentity(input);
    if (
      this.closed ||
      peer.signal.aborted ||
      identity.binding.hostId !== peer.context.hostId ||
      identity.binding.hostBootId !== peer.context.bootId
    )
      throw new KernelFault('permission-denied');
    const result = await peer.rpc.request('delivery.inspect', qqExecutionJson(identity));
    if (!result.ok) throw new KernelFault(result.error.code);
    const value = jsonPreflight(result.value);
    if (!value.ok || !value.value || typeof value.value !== 'object' || Array.isArray(value.value))
      throw new KernelFault('invalid-input');
    if (value.value['phase'] === 'pending') {
      if (!isDeepStrictEqual(parseQQExecutionIdentity(value.value['identity']), identity))
        throw new KernelFault('conflict');
      return null;
    }
    if (value.value['phase'] !== 'settled') throw new KernelFault('invalid-input');
    const fact = parseQQExecutionFact(value.value['fact']);
    const actual = parseQQExecutionIdentity(fact, ['outcome']);
    if (!isDeepStrictEqual(actual, identity)) throw new KernelFault('conflict');
    return this.report(peer, fact);
  }
  /** A cleanup inquiry may cross daemon boots, but cannot create a claim or alter effect facts. */
  recover(
    peer: BridgeChannel,
    reference: Pick<QQExecutionIdentity, 'deliveryId' | 'partId' | 'attemptId'>,
    caller: AbortSignal = peer.signal,
  ): Promise<QQDeliveryView> {
    if (this.closed || peer.signal.aborted || caller.aborted)
      return Promise.reject(new KernelFault('not-ready'));
    return this.track(
      (async () => {
        await this.initialize();
        const delivery = await this.options.runtime.state('getDelivery', {
          id: reference.deliveryId,
          scope,
        });
        const execution = await this.options.runtime.state('getDeliveryExecution', {
          id: delivery.id,
          scope,
        });
        if (
          !execution ||
          execution.target.kind !== 'remote' ||
          !execution.processIdentity ||
          execution.target.binding.hostId !== peer.context.hostId ||
          delivery.phase !== 'terminal'
        )
          throw new KernelFault('permission-denied');
        const original = executionIdentity(
          delivery,
          execution,
          reference.partId,
          reference.attemptId,
        );
        if (
          !original ||
          attemptIn(delivery, reference.partId, reference.attemptId).phase !== 'settled'
        )
          throw new KernelFault('not-ready');
        const processIdentity = validateLocalHostProcessIdentity(execution.processIdentity);
        if (!processIdentity.ok) throw new KernelFault('not-ready');
        const request: QQExecutionRecoveryRequest = {
          original,
          processIdentity: processIdentity.value,
          challenge: randomUUID(),
        };
        const response = await peer.rpc.request('delivery.recover', qqExecutionJson(request), {
          budgetMs: 40000,
          signal: AbortSignal.any([caller, peer.signal, this.lifetime.signal]),
        });
        if (!response.ok) throw new KernelFault(response.error.code);
        const fact = parseQQExecutionRecoveryResult(response.value);
        if (
          !isDeepStrictEqual(
            {
              original: fact.original,
              processIdentity: fact.processIdentity,
              challenge: fact.challenge,
            },
            request,
          )
        )
          throw new KernelFault('permission-denied');
        const updated = await this.options.runtime.state('settleDeliveryCleanup', {
          ...stateBinding(original),
          processIdentity: request.processIdentity,
        });
        this.holds.delete(key(original.deliveryId, original.partId, original.attemptId));
        return updated;
      })(),
    );
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.lifetime.abort();
    for (const entry of this.active.values()) entry.task.cancel('shutdown');
    this.closing = (async () => {
      await Promise.allSettled([...this.work]);
      // No waiting for remote native tasks: their original uncertainty remains durable in State.
      if (this.localCleanupFailure) throw new KernelFault('unavailable');
    })();
    return this.closing;
  }
  diagnostics(): { active: number; holds: number } {
    return { active: this.active.size, holds: this.holds.size };
  }
}
