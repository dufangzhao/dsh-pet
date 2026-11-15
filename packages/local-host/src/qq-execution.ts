import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_INPUT_READY_MAX,
  COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE,
  QQ_DELIVERY_MAX_PARTS,
  isCompanionRecordId,
  isQQDeliveryAttempt,
  isQQDeliveryView,
  sameQQAccount,
  makeError,
  type JsonValue,
  type LocalHostSourceBinding,
  type LocalHostProcessIdentity,
  type OwnerRef,
  type QQDeliveryPart,
  type TaskContext,
} from '@pet/contracts';
import {
  isRecord,
  jsonPreflight,
  validateLocalHostSourceBinding,
  validateLocalHostProcessIdentity,
  validateLocalHostTaskReference,
} from '@pet/contracts/validation';
import { KernelFault, mediaReference, type TaskHandle } from '@pet/host-kernel';
import type { BridgeChannel } from './bridge-channel.js';
import { checkRemoteAuthority } from './authority-check.js';
import type { LocalPluginKernel, LocalQQSourceId } from './kernel.js';
import type { LocalQQSourceController, LocalCapturedSource } from './qq-source.js';
import { withQqOperationCheck } from './qq-native/index.js';
import { createQQDeliverySource } from './qq-delivery-transport.js';
import { ownedProcessDeathFact, type OwnedProcessProvider } from './owned-process.js';
import type {
  QQDeliveryOutcome,
  QQDeliverySource,
  QQExecutionFact,
  QQExecutionIdentity,
  QQExecutionInspection,
  QQExecutionRequest,
  QQExecutionResult,
  QQExecutionRecoveryRequest,
  QQExecutionRecoveryResult,
} from './qq-delivery-types.js';

const MAX_RECORDS = COMPANION_INPUT_READY_MAX * QQ_DELIVERY_MAX_PARTS;
const operationNames = ['upload', 'send', 'upload-and-send'];
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));
const record = (input: unknown): Record<string, unknown> => {
  const safe = jsonPreflight(input);
  if (!safe.ok || !isRecord(safe.value)) throw new KernelFault('invalid-input');
  return safe.value;
};
export function qqDeliveryContentHash(part: QQDeliveryPart): string {
  if (part.content.kind === 'inline-text') return part.content.sha256;
  if (!part.content.material) throw new KernelFault('not-ready');
  return part.content.material.sha256;
}
export function parseQQExecutionRequest(input: unknown): QQExecutionRequest {
  const value = record(input);
  const binding = validateLocalHostSourceBinding(value['binding']);
  if (
    !keys(value, [
      'binding',
      'delivery',
      'partId',
      'attemptId',
      'operation',
      'stream',
      'continuation',
    ]) ||
    !binding.ok ||
    !isQQDeliveryView(value['delivery']) ||
    !isCompanionRecordId(value['partId']) ||
    !isCompanionRecordId(value['attemptId']) ||
    !operationNames.includes(String(value['operation']))
  )
    throw new KernelFault('invalid-input');
  const delivery = value['delivery'];
  const part = delivery.parts.find((candidate) => candidate.id === value['partId']);
  const operation = value['operation'] as QQExecutionRequest['operation'];
  const attempt = part?.[operation === 'send' ? 'send' : 'upload'];
  if (
    delivery.phase !== 'sending' ||
    delivery.outcome !== 'pending' ||
    !part ||
    part.preparation !== 'ready' ||
    !attempt ||
    attempt.id !== value['attemptId'] ||
    attempt.operation !== operation ||
    attempt.phase !== 'claimed' ||
    binding.value.sourceOwner.pluginId !== delivery.route.account.sourcePluginId ||
    binding.value.sourceOwner.instanceId !== delivery.route.account.instanceId
  )
    throw new KernelFault('permission-denied');
  const stream = value['stream'] === undefined ? undefined : mediaReference(value['stream']);
  const continuation = value['continuation'];
  if (
    (operation !== 'send') !== Boolean(stream) ||
    stream === null ||
    (continuation !== undefined && !isCompanionRecordId(continuation)) ||
    (operation !== 'send' && continuation !== undefined) ||
    (operation === 'send' && (part.content.kind !== 'inline-text') !== (continuation !== undefined))
  )
    throw new KernelFault('invalid-input');
  return {
    binding: binding.value,
    delivery,
    partId: part.id,
    attemptId: attempt.id,
    operation,
    ...(stream ? { stream } : {}),
    ...(typeof continuation === 'string' ? { continuation } : {}),
  };
}
export function parseQQExecutionIdentity(
  input: unknown,
  extra: readonly string[] = [],
): QQExecutionIdentity {
  const value = record(input);
  const binding = validateLocalHostSourceBinding(value['binding']),
    task = validateLocalHostTaskReference(value['task']);
  if (
    !keys(value, [
      'binding',
      'task',
      'deliveryId',
      'partId',
      'attemptId',
      'contentHash',
      'operation',
      ...extra,
    ]) ||
    !binding.ok ||
    !task.ok ||
    !isDeepStrictEqual(binding.value.sourceOwner, task.value.owner) ||
    !isCompanionRecordId(value['deliveryId']) ||
    !isCompanionRecordId(value['partId']) ||
    !isCompanionRecordId(value['attemptId']) ||
    !digest(value['contentHash']) ||
    !operationNames.includes(String(value['operation']))
  )
    throw new KernelFault('invalid-input');
  return {
    binding: binding.value,
    task: task.value,
    deliveryId: value['deliveryId'],
    partId: value['partId'],
    attemptId: value['attemptId'],
    contentHash: value['contentHash'],
    operation: value['operation'] as QQExecutionIdentity['operation'],
  };
}
export function parseQQExecutionFact(input: unknown): QQExecutionFact {
  const value = record(input),
    identity = parseQQExecutionIdentity(value, ['outcome']);
  const outcome = value['outcome'];
  if (
    !isRecord(outcome) ||
    !keys(outcome, ['dispatched', 'outcome', 'receipt', 'correlationId', 'cleanup', 'error']) ||
    typeof outcome['dispatched'] !== 'boolean' ||
    outcome['cleanup'] === 'pending' ||
    !isQQDeliveryAttempt({
      id: identity.attemptId,
      operation: identity.operation,
      phase: 'settled',
      outcome: outcome['outcome'],
      receipt: outcome['receipt'],
      correlationId: outcome['correlationId'] ?? null,
      cleanup: outcome['cleanup'],
      error: outcome['error'],
      startedAt: 0,
      settledAt: 0,
    }) ||
    (outcome['outcome'] === 'accepted' && outcome['dispatched'] !== true) ||
    (outcome['outcome'] === 'cancelled-before-dispatch' && outcome['dispatched'] !== false)
  )
    throw new KernelFault('invalid-input');
  return { ...identity, outcome: outcome as unknown as QQExecutionFact['outcome'] };
}
export function parseQQExecutionResult(input: unknown): QQExecutionResult {
  const value = record(input);
  if (
    !keys(value, ['fact', 'continuation']) ||
    (value['continuation'] !== undefined && !isCompanionRecordId(value['continuation']))
  )
    throw new KernelFault('invalid-input');
  const fact = parseQQExecutionFact(value['fact']);
  if (
    value['continuation'] !== undefined &&
    (fact.operation !== 'upload' ||
      fact.outcome.outcome !== 'accepted' ||
      fact.outcome.cleanup !== 'settled' ||
      fact.outcome.error !== null)
  )
    throw new KernelFault('invalid-input');
  return {
    fact,
    ...(typeof value['continuation'] === 'string' ? { continuation: value['continuation'] } : {}),
  };
}
export function parseQQExecutionRecoveryRequest(
  input: unknown,
  extra: readonly string[] = [],
): QQExecutionRecoveryRequest {
  const value = record(input),
    processIdentity = validateLocalHostProcessIdentity(value['processIdentity']);
  if (
    !keys(value, ['original', 'processIdentity', 'challenge', ...extra]) ||
    !processIdentity.ok ||
    typeof value['challenge'] !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value['challenge'])
  )
    throw new KernelFault('invalid-input');
  return {
    original: parseQQExecutionIdentity(value['original']),
    processIdentity: processIdentity.value,
    challenge: value['challenge'],
  };
}
export function parseQQExecutionRecoveryResult(input: unknown): QQExecutionRecoveryResult {
  const value = record(input),
    reference = parseQQExecutionRecoveryRequest(value, ['reason']);
  const reason = value['reason'];
  if (reason !== 'not-found' && reason !== 'pid-reused' && reason !== 'process-exited')
    throw new KernelFault('invalid-input');
  return { ...reference, reason };
}
const keyOf = (value: { deliveryId: string; partId: string; attemptId: string }): string =>
  JSON.stringify([value.deliveryId, value.partId, value.attemptId]);
const failure = (error: unknown): ReturnType<typeof makeError> =>
  error instanceof KernelFault ? error.error : makeError('unavailable', false);
function localBinding(source: LocalCapturedSource, peer: BridgeChannel): LocalHostSourceBinding {
  return {
    hostId: peer.context.hostId,
    hostBootId: peer.context.bootId,
    bridgeSessionId: peer.context.sessionId,
    sourceOwner: source.owner,
    sourceConfigRevision: source.configRevision,
    sourcePermissionEpoch: source.permissionEpoch,
    sourceCredentialVersion: source.credentialVersion,
    nativeConnectionId: source.connectionId,
  };
}
interface ExecutionRecord {
  readonly request: QQExecutionRequest;
  readonly peer: BridgeChannel;
  readonly native: QQDeliverySource;
  readonly identity: QQExecutionIdentity;
  readonly handle: TaskHandle;
  readonly settled: Promise<QQExecutionResult>;
  fact: QQExecutionFact | null;
  continuation: string | null;
  authorized: boolean;
}
interface Continuation {
  readonly record: ExecutionRecord;
  readonly native: QQDeliverySource;
  readonly uploaded: unknown;
}
export interface LocalQQExecutionOptions {
  readonly kernel: LocalPluginKernel;
  readonly sources: Pick<LocalQQSourceController, 'captureSource'>;
  readonly ownedProcess: OwnedProcessProvider;
}

/** Actual local tasks/native work. Records retain observations, never queued execution or grants. */
export class LocalQQExecutionOwner {
  private readonly records = new Map<string, ExecutionRecord>();
  private readonly continuations = new Map<string, Continuation>();
  private readonly lifetime = new AbortController();
  private readonly processIdentity: LocalHostProcessIdentity;
  private readonly recoveryTasks = new Set<TaskHandle>();
  private readonly recoveries = new Set<Promise<QQExecutionRecoveryResult>>();
  private recoveryCleanupFailed = false;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: LocalQQExecutionOptions) {
    const identity = validateLocalHostProcessIdentity(options.ownedProcess.identity());
    if (!identity.ok) throw new KernelFault(identity.error.code);
    this.processIdentity = Object.freeze(identity.value);
  }
  private room(media: boolean): void {
    for (const [id, continuation] of this.continuations)
      if (continuation.record.peer.signal.aborted) {
        this.continuations.delete(id);
        continuation.record.continuation = null;
      }
    const live = [...this.records.values()].filter((item) => item.handle.snapshot().workPending);
    if (
      live.length >= COMPANION_INPUT_READY_MAX ||
      (media &&
        live.filter((item) => item.request.operation !== 'send').length >=
          COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE)
    )
      throw new KernelFault('quota-exceeded');
    // Eviction loses only a settled observation. State's task bind-once fence still prevents replay.
    for (const [key, item] of this.records) {
      if (this.records.size < MAX_RECORDS) break;
      if (
        item.fact?.outcome.cleanup === 'settled' &&
        !item.continuation &&
        !item.handle.snapshot().workPending
      )
        this.records.delete(key);
    }
    if (
      this.records.size >= MAX_RECORDS ||
      (media && this.continuations.size >= COMPANION_INPUT_READY_MAX)
    )
      throw new KernelFault('quota-exceeded');
  }
  signalFor(peer: BridgeChannel, owner: OwnerRef, wireTaskId: string): AbortSignal | null {
    if (this.closed || peer.signal.aborted || !isDeepStrictEqual(owner, peer.context.owner))
      return null;
    const item = [...this.records.values()].find(
      (record) =>
        record.peer === peer &&
        record.authorized &&
        record.request.stream?.taskId === wireTaskId &&
        record.handle.snapshot().workPending,
    );
    if (!item) return null;
    return this.options.kernel.host.tasks.taskSignal(
      item.identity.task.taskId,
      item.identity.task.owner,
    ) === item.handle.signal
      ? item.handle.signal
      : null;
  }
  async execute(
    peer: BridgeChannel,
    input: unknown,
    caller: AbortSignal = peer.signal,
  ): Promise<QQExecutionResult> {
    if (this.closed) throw new KernelFault('not-ready');
    const request = parseQQExecutionRequest(input);
    if (
      request.binding.hostId !== peer.context.hostId ||
      request.binding.hostBootId !== peer.context.bootId ||
      request.binding.bridgeSessionId !== peer.context.sessionId ||
      peer.signal.aborted ||
      caller.aborted
    )
      throw new KernelFault('stale-owner');
    const part = request.delivery.parts.find((part) => part.id === request.partId);
    if (!part) throw new KernelFault('invalid-input');
    const key = keyOf({
      deliveryId: request.delivery.id,
      partId: request.partId,
      attemptId: request.attemptId,
    });
    if (
      this.records.has(key) ||
      (request.stream &&
        [...this.records.values()].some(
          (record) =>
            record.peer === peer &&
            record.request.stream?.taskId === request.stream?.taskId &&
            record.handle.snapshot().workPending,
        ))
    )
      throw new KernelFault('conflict');
    this.room(request.operation !== 'send');
    if (
      [...this.records.values()].some(
        (record) =>
          sameQQAccount(record.request.delivery.route.account, request.delivery.route.account) &&
          ((record.fact !== null && record.fact.outcome.cleanup !== 'settled') ||
            (record.peer.signal.aborted && record.handle.snapshot().workPending)),
      )
    )
      throw new KernelFault('not-ready');
    const captured = this.options.sources.captureSource(request.delivery.route.account);
    if (!isDeepStrictEqual(localBinding(captured, peer), request.binding))
      throw new KernelFault('stale-owner');
    let native = createQQDeliverySource(captured),
      uploaded: unknown;
    let previous: Continuation | undefined;
    if (request.continuation) {
      previous = this.continuations.get(request.continuation);
      const parent = previous?.record;
      if (
        !parent ||
        !previous ||
        !isDeepStrictEqual(parent.request.binding, request.binding) ||
        parent.request.delivery.id !== request.delivery.id ||
        parent.request.partId !== part.id ||
        parent.request.attemptId !== part.upload?.id ||
        part.upload.outcome !== 'accepted' ||
        part.upload.cleanup !== 'settled' ||
        parent.identity.contentHash !== qqDeliveryContentHash(part) ||
        !isDeepStrictEqual(parent.request.delivery.route, request.delivery.route) ||
        request.operation !== 'send'
      )
        throw new KernelFault('permission-denied');
      native = previous.native;
      uploaded = previous.uploaded;
    }
    let observed: QQDeliveryOutcome | undefined, thrown: unknown;

    const signal = AbortSignal.any([caller, peer.signal, this.lifetime.signal, captured.signal]);
    const handle = this.options.kernel.runFor(
      captured.owner.pluginId as LocalQQSourceId,
      async (task: TaskContext) => {
        const checkLocal = async (): Promise<void> => {
          task.signal.throwIfAborted();
          await native.check();
          task.signal.throwIfAborted();
        };
        const remote = async (): Promise<number> => {
          const result = await checkRemoteAuthority({
            peer,
            signal: task.signal,
            checkLocal,
            request: {
              kind: 'delivery',
              binding: request.binding,
              task: { owner: task.owner, taskId: task.taskId },
              deliveryId: request.delivery.id,
              partId: part.id,
              attemptId: request.attemptId,
              contentHash: qqDeliveryContentHash(part),
            },
          });
          if (!result.ok) throw new KernelFault(result.error.code);
          item.authorized = true;
          return result.value;
        };
        let cancelReader: (() => void) | undefined;
        try {
          await this.options.ownedProcess.check();
          if (!isDeepStrictEqual(this.options.ownedProcess.identity(), this.processIdentity))
            throw new KernelFault('stale-owner');
          // Task binding also authorizes accepting the frozen output stream before native upload.
          await remote();
          if (request.continuation && previous) {
            this.continuations.delete(request.continuation);
            previous.record.continuation = null;
          }
          let bytes: AsyncIterable<Uint8Array> | undefined;
          if (request.stream) {
            if (!isDeepStrictEqual(request.stream.owner, peer.context.owner))
              throw new KernelFault('permission-denied');
            const reader = peer.media.createReader(request.stream);
            if (!reader.ok) throw new KernelFault(reader.error.code);
            cancelReader = reader.value.cancel;
            const granted = peer.media.grantInitial(request.stream);
            if (!granted.ok) {
              reader.value.cancel();
              throw new KernelFault(granted.error.code);
            }
            bytes = reader.value;
          }
          observed = await withQqOperationCheck(this.options.kernel.host, task, remote, () =>
            native.transport.execute(
              {
                delivery: request.delivery,
                part,
                attemptId: request.attemptId,
                operation: request.operation,
                expectedConnectionId: request.binding.nativeConnectionId,
                check: checkLocal,
                ...(bytes && part.content.kind !== 'inline-text' && part.content.material
                  ? { bytes, material: part.content.material }
                  : {}),
                ...(uploaded === undefined ? {} : { uploaded }),
              },
              task.signal,
              async () => {},
            ),
          );
        } catch (error) {
          thrown = error;
        } finally {
          cancelReader?.();
        }
        return null;
      },
      { signal },
    );
    const identity: QQExecutionIdentity = {
      binding: request.binding,
      task: { owner: handle.snapshot().owner, taskId: handle.taskId },
      deliveryId: request.delivery.id,
      partId: part.id,
      attemptId: request.attemptId,
      operation: request.operation,
      contentHash: qqDeliveryContentHash(part),
    };
    const settled = handle.settled.then(async (): Promise<QQExecutionResult> => {
      const logical = await handle.result;
      const cause = thrown === undefined ? (logical.ok ? null : logical.error) : failure(thrown);
      let outcome: QQDeliveryOutcome = observed ?? {
        dispatched: false,
        outcome: signal.aborted ? 'cancelled-before-dispatch' : 'failed',
        receipt: null,
        cleanup: handle.snapshot().cleanupFailed ? 'failed' : 'settled',
        error: cause ?? makeError('unavailable', false),
      };
      if (cause && !outcome.error) outcome = { ...outcome, error: cause };
      if (handle.snapshot().cleanupFailed)
        outcome = {
          ...outcome,
          cleanup: 'failed',
          error: outcome.error ?? makeError('unavailable', false),
        };
      const { uploaded: privateUpload, ...publicOutcome } = outcome;
      const fact = parseQQExecutionFact({ ...identity, outcome: publicOutcome });
      if (!item) throw new KernelFault('internal');
      item.fact = structuredClone(fact); // Retain settlement independently of the RPC caller's copy.
      if (
        privateUpload !== undefined &&
        fact.outcome.outcome === 'accepted' &&
        fact.outcome.cleanup === 'settled' &&
        fact.outcome.error === null &&
        !native.signal.aborted &&
        !peer.signal.aborted
      ) {
        const continuation = randomUUID();
        item.continuation = continuation;
        this.continuations.set(continuation, { record: item, native, uploaded: privateUpload });
        return { fact, continuation };
      }
      return { fact };
    });
    const item: ExecutionRecord = {
      request,
      peer,
      native,
      identity,
      handle,
      settled,
      authorized: false,
      fact: null,
      continuation: null,
    };
    this.records.set(key, item);
    void settled.catch(() => {}); // The record retains the rejecting operation until its owner closes.
    return settled;
  }
  inspect(peer: BridgeChannel, input: unknown): QQExecutionInspection {
    const identity = parseQQExecutionIdentity(input);
    if (
      peer.signal.aborted ||
      peer.context.hostId !== identity.binding.hostId ||
      peer.context.bootId !== identity.binding.hostBootId
    )
      throw new KernelFault('permission-denied');
    const item = this.records.get(keyOf(identity));
    if (!item || !isDeepStrictEqual(item.identity, identity)) throw new KernelFault('unavailable');
    if (
      peer.context.agentId !== item.peer.context.agentId ||
      peer.context.agentEpoch !== item.peer.context.agentEpoch
    )
      throw new KernelFault('permission-denied');
    return item.fact
      ? { phase: 'settled', fact: structuredClone(item.fact) }
      : { phase: 'pending', identity: structuredClone(item.identity) };
  }
  /** Only a real management task may observe OS death; it cannot enter QQ business execution. */
  recover(
    peer: BridgeChannel,
    input: unknown,
    caller: AbortSignal = peer.signal,
  ): Promise<QQExecutionRecoveryResult> {
    if (this.closed || peer.signal.aborted || caller.aborted)
      return Promise.reject(new KernelFault('not-ready'));
    const request = parseQQExecutionRecoveryRequest(input);
    if (request.original.binding.hostId !== peer.context.hostId)
      return Promise.reject(new KernelFault('permission-denied'));
    let observed: QQExecutionRecoveryResult | undefined;
    const task = this.options.kernel.runManagement(
      async (context) => {
        context.signal.throwIfAborted();
        await this.options.ownedProcess.check();
        const proof = await this.options.ownedProcess.gone(request.processIdentity);
        context.signal.throwIfAborted();
        if (proof.status !== 'gone') throw new KernelFault('not-ready');
        const fact = ownedProcessDeathFact(proof);
        if (!isDeepStrictEqual(fact.identity, request.processIdentity))
          throw new KernelFault('permission-denied');
        observed = { ...request, reason: fact.reason };
        return null;
      },
      { signal: AbortSignal.any([caller, peer.signal, this.lifetime.signal]), timeoutMs: 35000 },
    );
    this.recoveryTasks.add(task);
    const work = task.settled.then(async () => {
      const result = await task.result;
      if (task.snapshot().cleanupFailed) this.recoveryCleanupFailed = true;
      if (!result.ok || task.snapshot().cleanupFailed || !observed)
        throw new KernelFault(result.ok ? 'unavailable' : result.error.code);
      return observed;
    });
    this.recoveries.add(work);
    void work.then(
      () => {
        this.recoveries.delete(work);
        this.recoveryTasks.delete(task);
      },
      () => {
        this.recoveries.delete(work);
        this.recoveryTasks.delete(task);
      },
    );
    return work;
  }
  /** Connection retirement loses continuation usability, not retained effect observations. */
  retire(peer: BridgeChannel): void {
    for (const [id, value] of this.continuations)
      if (value.record.peer === peer) {
        this.continuations.delete(id);
        value.record.continuation = null;
      }
    for (const item of this.records.values())
      if (item.peer === peer && item.handle.snapshot().workPending) item.handle.cancel('shutdown');
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.lifetime.abort();
    for (const item of this.records.values()) item.handle.cancel('shutdown');
    for (const task of this.recoveryTasks) task.cancel('shutdown');
    this.closing = (async () => {
      const results = await Promise.allSettled(
        [...this.records.values()].map((item) => item.settled),
      );
      await Promise.allSettled([...this.recoveries]);
      this.continuations.clear();
      if (
        this.recoveryCleanupFailed ||
        results.some((value) => value.status === 'rejected') ||
        [...this.records.values()].some((item) => item.fact?.outcome.cleanup !== 'settled')
      )
        throw new KernelFault('unavailable');
    })();
    return this.closing;
  }
  diagnostics(): { records: number; active: number; continuations: number } {
    return {
      records: this.records.size,
      active: [...this.records.values()].filter((item) => item.handle.snapshot().workPending)
        .length,
      continuations: this.continuations.size,
    };
  }
}

/** Explicit serialization adapter; private callbacks/handles never cross the control plane. */
export function qqExecutionJson(
  value:
    | QQExecutionRequest
    | QQExecutionIdentity
    | QQExecutionResult
    | QQExecutionInspection
    | QQExecutionRecoveryRequest
    | QQExecutionRecoveryResult,
): JsonValue {
  const parsed = jsonPreflight(value);
  if (!parsed.ok)
    throw new KernelFault(parsed.code === 'bytes-exceeded' ? 'quota-exceeded' : 'invalid-input');
  return parsed.value;
}
