import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_FULL_TEXT_MAX_BYTES,
  QQ_FEATURE_PLUGIN_ID,
  QQ_DELIVERY_MAX_MESSAGES,
  QQ_DELIVERY_MAX_PARTS,
  QQ_REPLY_TEXT_SEPARATOR,
  isCompanionMaterialRef,
  isQQDeliveryAttempt,
  isQQDeliveryPartAccepted,
  sameQQAccount,
  makeError,
  isKernelErrorCode,
  type CompanionCleanup,
  type CompanionMaterialRef,
  type CompanionMessage,
  type KernelError,
  type QQAccountRef,
  type QQDeliveryAttempt,
  type QQDeliveryPart,
  type QQDeliveryView,
  type QQPolicySettings,
  type QQRemoteReceipt,
  type QQReplyRoute,
} from '@pet/contracts';
import { KernelFault, type TaskHandle } from '@pet/host-kernel';
import {
  captureInputGrant,
  checkInputGrant,
  inputScope,
  type CompanionPluginHost,
  type CompanionRuntime,
  type RuntimeInputAccess,
  type RuntimeInputGrant,
  type RuntimeInputTerminal,
} from '@pet/companion-runtime';
import type { QQAudio } from './qq-audio.js';
import type { HostMaterialStore } from './material-store.js';
import { qqGroupSettings } from './qq-policy.js';
import {
  deliveryId,
  deliveryOrigins,
  deliveryParts,
  inlineText,
  requiredMedia,
  textHash,
} from './qq-delivery-plan.js';

export interface QQDeliveryProgress {
  readonly dispatched: boolean;
  readonly receipt: QQRemoteReceipt | null;
  /** Actual native correlation only; unknown until observed is null/absent. */
  readonly correlationId?: string | null;
}
export interface QQDeliveryOutcome extends QQDeliveryProgress {
  readonly outcome: Exclude<QQDeliveryAttempt['outcome'], 'pending'>;
  /** Local native/key work settlement; never a claim that remote stage bytes were deleted. */
  readonly cleanup: CompanionCleanup;
  readonly error: KernelError | null;
  /** Opaque private file_info/remote staging handle, never stored in State/SSE. */
  readonly uploaded?: unknown;
}
export interface QQDeliveryRequest {
  /** Captured grant plus exact source; adapters recheck at every native/range/chunk boundary. */
  check(): Promise<void>;
  readonly expectedConnectionId: string;
  readonly attemptId: string;
  readonly operation: QQDeliveryAttempt['operation'];
  readonly delivery: QQDeliveryView;
  readonly part: QQDeliveryPart;
  readonly material?: CompanionMaterialRef;
  readonly bytes?: AsyncIterable<Uint8Array>;
  readonly uploaded?: unknown;
}
export interface QQDeliveryTransport {
  /** One attempt; resolves only after actual IO settlement, preserving any known post-dispatch receipt. */
  execute(
    request: QQDeliveryRequest,
    signal: AbortSignal,
    progress: (value: QQDeliveryProgress) => Promise<void>,
  ): Promise<QQDeliveryOutcome>;
}
export interface QQDeliverySource {
  readonly account: QQAccountRef;
  readonly connectionId: string;
  readonly signal: AbortSignal;
  readonly transport: QQDeliveryTransport;
  check(): Promise<void>;
}
export interface QQDeliveryTerminal extends RuntimeInputTerminal {
  readonly grant: RuntimeInputGrant;
}
export interface QQDeliveryOptions {
  readonly host: CompanionPluginHost;
  readonly runtime: CompanionRuntime;
  readonly materials: HostMaterialStore;
  readonly audio: Pick<QQAudio, 'exportVoice'>;
  policy(): Promise<{ readonly revision: number; readonly settings: QQPolicySettings }>;
  sourceFor(account: QQAccountRef): QQDeliverySource;
  /** Explicit current wire-active permission, separate from app-level proactive eligibility. */
  allowOfficialProactive?(grant: RuntimeInputGrant): Promise<boolean>;
  onError?(error: KernelError, event: QQDeliveryTerminal): void | Promise<void>;
}
interface Pending {
  readonly event: QQDeliveryTerminal;
  readonly fingerprint: string;
  readonly grant: RuntimeInputGrant;
  readonly voiceAbort: AbortController;
  handle: TaskHandle | null;
  work: Promise<QQDeliveryView | null> | null;
}
interface Batch {
  delivery: QQDeliveryView;
  readonly source: QQDeliverySource;
  readonly access: RuntimeInputAccess;
}
const failed = (value: unknown): KernelError => {
  if (value instanceof KernelFault) return value.error;
  if (value && typeof value === 'object' && 'code' in value && isKernelErrorCode(value.code))
    return makeError(value.code, false);
  return makeError(
    value instanceof DOMException && value.name === 'AbortError' ? 'cancelled' : 'unavailable',
    false,
  );
};
const absent = (value: unknown): boolean =>
  value instanceof KernelFault && value.error.code === 'unavailable';
const routeKey = (route: QQReplyRoute): string =>
  JSON.stringify([
    route.account.protocol,
    route.account.sourcePluginId,
    route.account.instanceId,
    route.account.accountId,
    route.scene,
    route.targetId,
    route.reference?.messageId ? 'message' : 'event',
    route.reference?.messageId ?? route.reference?.eventId ?? null,
  ]);
function mergeReceipt(
  previous: QQRemoteReceipt | null,
  next: QQRemoteReceipt | null,
): QQRemoteReceipt | null {
  if (!previous) return next;
  if (!next) return previous;
  const merge = <T>(a: T | null, b: T | null): T | null => {
    if (a !== null && b !== null && a !== b) throw new KernelFault('conflict');
    return b ?? a;
  };
  return {
    messageId: merge(previous.messageId, next.messageId),
    fileId: merge(previous.fileId, next.fileId),
    transferId: merge(previous.transferId, next.transferId),
    sequence: merge(previous.sequence, next.sequence),
    sequenceAuthoritative: merge(previous.sequenceAuthoritative, next.sequenceAuthoritative),
  };
}

/** One frozen delivery per terminal input; State owns every dispatch claim and passive reservation. */
export class QQDeliveryController {
  private readonly pending = new Map<string, Pending>();
  private readonly routes = new Map<string, Promise<void>>();
  private readonly reports = new Set<Promise<void>>();
  private reportError: KernelError | null = null;
  private readonly lifetime = new AbortController();
  private readonly offCommit: () => void;
  private rechecking: Promise<void> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  private cleanupFailure: KernelError | null = null;
  constructor(private readonly options: QQDeliveryOptions) {
    this.offCommit = options.host.onConfigurationCommit((commit) => {
      if (commit.pluginId !== QQ_FEATURE_PLUGIN_ID || commit.instanceId !== 'default') return;
      const entries = [...this.pending.values()];
      // Start every captured predicate now; a slow first lease must not hide another actor's withdrawal.
      const checks = entries.map((item) =>
        checkInputGrant(item.grant).catch(() => {
          item.handle?.cancel('permission-revoked');
          item.voiceAbort.abort();
        }),
      );
      // The committed QQ config is exact; a rapid off/on must not revive already cancelled voice.
      if (commit.data['voiceOutputEnabled'] !== true)
        for (const item of entries) item.voiceAbort.abort();
      this.rechecking = Promise.all([this.rechecking, ...checks]).then(() => {});
    });
  }
  enqueue(event: QQDeliveryTerminal): void {
    if (this.closed) throw new KernelFault('not-ready');
    // Also observe failures before a source task can start (for example a revoked feature lease).
    const report = Promise.resolve()
      .then(() => this.onTerminal(event))
      .then(
        async (value) => {
          if (value?.error) await this.options.onError?.(value.error, event);
        },
        (error: unknown) => this.notice(event, failed(error)),
      );
    this.reports.add(report);
    void report.then(
      () => this.reports.delete(report),
      (error: unknown) => {
        this.reportError ??= failed(error);
        this.reports.delete(report);
      },
    );
  }
  onTerminal(event: QQDeliveryTerminal): Promise<QQDeliveryView | null> {
    return this.start(event);
  }
  private start(value: QQDeliveryTerminal): Promise<QQDeliveryView | null> {
    if (this.closed || this.cleanupFailure) return Promise.reject(new KernelFault('not-ready'));
    if (!value.outputs.length || value.admission.origin.route.kind === 'owner-private')
      return Promise.resolve(null);
    const grant = captureInputGrant(value.grant, value.admission.origin);
    const event: QQDeliveryTerminal = {
      ...structuredClone({
        admission: value.admission,
        contextId: value.contextId,
        outputs: value.outputs,
      }),
      grant,
    };
    const id = deliveryId(event.admission.id);
    const fingerprint = textHash(JSON.stringify([event.admission.origin, event.outputs]));
    const existing = this.pending.get(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.reject(new KernelFault('conflict'));
      if (!existing.work) return Promise.reject(new KernelFault('not-ready'));
      return existing.work;
    }
    const route = event.admission.origin.route;
    if (route.kind !== 'qq') return Promise.resolve(null);
    const key = routeKey(route),
      predecessor = this.routes.get(key) ?? Promise.resolve();
    const entry: Pending = {
      event,
      fingerprint,
      grant,
      voiceAbort: new AbortController(),
      handle: null,
      work: null,
    };
    let result: QQDeliveryView | null | undefined;
    let failure: unknown;
    const handle = this.options.host.runFor(
      QQ_FEATURE_PLUGIN_ID,
      async (context) => {
        try {
          await predecessor;
          context.signal.throwIfAborted();
          result = await this.deliver(entry, context.signal);
        } catch (error) {
          failure = error;
          throw new KernelFault(failed(error).code);
        }
        return null;
      },
      { signal: AbortSignal.any([grant.signal, this.lifetime.signal]) },
    );
    entry.handle = handle;
    const work = (async () => {
      const logical = await handle.result;
      await handle.settled;
      if (failure !== undefined) throw failure;
      if (result !== undefined) return result;
      throw new KernelFault(logical.ok ? 'unavailable' : logical.error.code);
    })();
    entry.work = work;
    this.pending.set(id, entry);
    const tail = work.then(
      () => {},
      () => {},
    );
    this.routes.set(key, tail);
    void tail.then(() => {
      if (this.pending.get(id) === entry) this.pending.delete(id);
      if (this.routes.get(key) === tail) this.routes.delete(key);
    });
    return work;
  }
  private async notice(event: QQDeliveryTerminal, error: KernelError): Promise<void> {
    try {
      await this.options.runtime.state('appendMessage', {
        id: `qq-notice-${textHash(event.admission.id)}`,
        role: 'notice',
        text: `QQ delivery unavailable (${error.code}).`,
        inputId: event.admission.id,
        audience: event.admission.origin.audience,
        origins: [event.admission.origin],
      });
    } finally {
      await this.options.onError?.(error, event);
    }
  }
  private access(
    entry: Pending,
    signal: AbortSignal,
    source?: QQDeliverySource,
  ): RuntimeInputAccess {
    const combined = AbortSignal.any([
      signal,
      entry.grant.signal,
      this.lifetime.signal,
      ...(source ? [source.signal] : []),
    ]);
    return {
      signal: combined,
      scope: inputScope(entry.grant.origin),
      check: async () => {
        combined.throwIfAborted();
        await checkInputGrant(entry.grant);
        if (source) await source.check();
        combined.throwIfAborted();
      },
    };
  }
  private async semantic(
    messages: readonly CompanionMessage[],
    access: RuntimeInputAccess,
  ): Promise<string> {
    const result: string[] = [];
    let bytes = 0;
    for (const message of messages) {
      let text = message.text;
      if (message.content?.kind === 'text-document') {
        const expected = message.content.material;
        text = await this.options.materials.withMaterial(
          expected.id,
          access,
          async (reference, source) => {
            if (
              !isDeepStrictEqual(reference, expected) ||
              reference.kind !== 'text' ||
              reference.sizeBytes > COMPANION_FULL_TEXT_MAX_BYTES
            )
              throw new KernelFault('conflict');
            const chunks: Uint8Array[] = [];
            for await (const chunk of source) chunks.push(chunk);
            return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          },
        );
      }
      if (!text.length || Buffer.from(text).toString('utf8') !== text)
        throw new KernelFault('invalid-input');
      bytes +=
        Buffer.byteLength(text) + (result.length ? Buffer.byteLength(QQ_REPLY_TEXT_SEPARATOR) : 0);
      if (bytes > COMPANION_FULL_TEXT_MAX_BYTES) throw new KernelFault('quota-exceeded');
      result.push(text);
    }
    return result.join(QQ_REPLY_TEXT_SEPARATOR);
  }
  private async prepare(
    entry: Pending,
    access: RuntimeInputAccess,
  ): Promise<{ delivery: QQDeliveryView; source?: QQDeliverySource }> {
    const { admission, outputs } = entry.event;
    const route = admission.origin.route;
    if (
      route.kind !== 'qq' ||
      !outputs.length ||
      outputs.length > QQ_DELIVERY_MAX_MESSAGES ||
      outputs.some((message) => message.role !== 'assistant')
    )
      throw new KernelFault('invalid-input');
    await access.check();
    // This private terminal contains exact canonical rows; createDelivery rechecks their State identity/content.
    const messages = outputs;
    const id = deliveryId(admission.id),
      origins = deliveryOrigins(messages);
    const text = await this.semantic(messages, access);
    const media = requiredMedia(messages);
    for (const reference of media)
      await this.options.materials.withMaterial(reference.id, access, async (actual, bytes) => {
        if (!isDeepStrictEqual(actual, reference)) throw new KernelFault('conflict');
        for await (const chunk of bytes) {
          void chunk; /* Exhaust this verified read before any text send. */
        }
      });
    let document: CompanionMaterialRef | undefined;
    if (
      messages.some((message) => message.content?.kind === 'text-document') ||
      !inlineText(text)
    ) {
      const only = messages.length === 1 ? messages[0]?.content : undefined;
      document =
        only?.kind === 'text-document'
          ? only.material
          : await this.options.materials.storeFullText(
              { id, text, origin: admission.origin },
              access,
            );
    }
    const policy = await this.options.policy();
    await access.check();
    let parts = deliveryParts(
      id,
      text,
      messages,
      media,
      document,
      policy.settings.voiceOutputEnabled,
    );
    let mode: QQDeliveryView['mode'] =
      route.account.protocol === 'onebot-v11' ? 'onebot' : 'official-passive';
    let allowed = QQ_DELIVERY_MAX_PARTS,
      expiresAt: number | null = null,
      error: KernelError | null = null;
    if (mode === 'official-passive') {
      const proactive =
        admission.origin.kind === 'qq-proactive' &&
        route.scene === 'group' &&
        qqGroupSettings(policy.settings, route.account, route.targetId).proactive.enabled &&
        (await this.options.allowOfficialProactive?.(entry.grant)) === true;
      if (proactive) mode = 'official-proactive';
      else {
        const budget = await this.options.runtime.state('passiveReplyBudget', { route });
        allowed = budget.remainingMessageParts;
        expiresAt = budget.expiresAt;
        if (!budget.eligible)
          error = makeError(allowed === 0 ? 'quota-exceeded' : 'not-ready', false);
      }
    }
    const required = parts.filter((part) => part.requirement !== 'optional-voice').length;
    if (required > allowed) error = makeError('quota-exceeded', false);
    if (parts.length > allowed)
      parts = parts.map((part) =>
        part.requirement === 'optional-voice'
          ? { ...part, preparation: 'unavailable', error: makeError('quota-exceeded', false) }
          : part,
      );
    if (admission.cleanup !== 'settled' || admission.phase !== 'completed')
      error = admission.error ?? makeError('unavailable', false);
    let source: QQDeliverySource | undefined;
    try {
      source = this.options.sourceFor(route.account);
      if (!sameQQAccount(source.account, route.account) || !source.connectionId)
        throw new KernelFault('stale-owner');
      await source.check();
      if (source.signal.aborted) throw new KernelFault('stale-owner');
    } catch (cause) {
      error ??= failed(cause);
    }
    if (error)
      parts = parts.map((part) =>
        part.requirement === 'optional-voice' && part.preparation === 'pending'
          ? { ...part, preparation: 'unavailable', error }
          : part,
      );
    const now = Date.now();
    const delivery: QQDeliveryView = {
      id,
      messageIds: messages.map((message) => message.id),
      origins,
      audience: admission.origin.audience,
      route,
      textRepresentation: document ? 'text-document' : 'inline',
      mode,
      eligibilityExpiresAt: expiresAt,
      allowedMessageParts: allowed,
      phase: error ? 'blocked' : 'prepared',
      outcome: error ? 'failed' : 'pending',
      parts,
      createdAt: now,
      updatedAt: now,
      error,
    };
    return {
      delivery: await this.options.runtime.state('createDelivery', { delivery }),
      ...(source ? { source } : {}),
    };
  }
  private async update(batch: Batch, parts: readonly QQDeliveryPart[]): Promise<void> {
    batch.delivery = await this.options.runtime.state('updateDelivery', {
      delivery: {
        ...batch.delivery,
        parts,
        updatedAt: Math.max(Date.now(), batch.delivery.updatedAt),
      },
    });
  }
  private part(batch: Batch, id: string): QQDeliveryPart {
    const part = batch.delivery.parts.find((value) => value.id === id);
    if (!part) throw new KernelFault('conflict');
    return part;
  }
  private async attempt(
    batch: Batch,
    partId: string,
    operation: QQDeliveryAttempt['operation'],
    uploaded?: unknown,
  ): Promise<{ outcome: QQDeliveryOutcome; interruption: KernelError | null }> {
    await batch.access.check();
    const initial: QQDeliveryAttempt = {
      id: `${partId}-${operation}`,
      operation,
      phase: 'claimed',
      outcome: 'pending',
      correlationId: null,
      receipt: null,
      cleanup: 'pending',
      startedAt: Date.now(),
      settledAt: null,
      error: null,
    };
    const claim = await this.options.runtime.state('claimDeliveryAttempt', {
      id: batch.delivery.id,
      partId,
      attempt: initial,
    });
    batch.delivery = claim.delivery;
    if (!claim.claimed) throw new KernelFault('conflict');
    const slot = operation === 'send' ? 'send' : 'upload';
    let invoked = false;
    let actual: QQDeliveryOutcome | undefined;
    let interruption: KernelError | null = null;
    const progress = async (value: QQDeliveryProgress): Promise<void> => {
      const part = this.part(batch, partId),
        current = part[slot];
      if (!current) throw new KernelFault('conflict');
      const next: QQDeliveryAttempt = {
        ...current,
        phase: value.dispatched ? 'dispatched' : current.phase,
        receipt: mergeReceipt(current.receipt, value.receipt),
        correlationId: value.correlationId ?? current.correlationId,
      };
      if (!isQQDeliveryAttempt(next)) throw new KernelFault('invalid-input');
      await this.update(
        batch,
        batch.delivery.parts.map((candidate) =>
          candidate.id === partId ? { ...candidate, [slot]: next } : candidate,
        ),
      );
    };
    try {
      await batch.access.check();
      const part = this.part(batch, partId);
      const base: QQDeliveryRequest = {
        check: batch.access.check,
        expectedConnectionId: batch.source.connectionId,
        attemptId: initial.id,
        operation,
        delivery: batch.delivery,
        part,
        ...(uploaded !== undefined ? { uploaded } : {}),
      };
      if (operation === 'send') {
        invoked = true;
        actual = await batch.source.transport.execute(base, batch.access.signal, progress);
      } else {
        const reference = part.content.kind === 'inline-text' ? null : part.content.material;
        if (!reference) throw new KernelFault('not-ready');
        await this.options.materials.withMaterial(
          reference.id,
          batch.access,
          async (material, bytes, signal) => {
            if (!isDeepStrictEqual(material, reference)) throw new KernelFault('conflict');
            invoked = true;
            actual = await batch.source.transport.execute(
              { ...base, material, bytes },
              signal,
              progress,
            );
          },
        );
      }
    } catch (cause) {
      interruption = failed(cause);
      if (!actual)
        actual = {
          dispatched: invoked,
          outcome: invoked
            ? 'unknown'
            : batch.access.signal.aborted
              ? 'cancelled-before-dispatch'
              : 'failed',
          receipt: null,
          cleanup: 'settled',
          error: interruption,
        };
    }
    if (!actual) throw new KernelFault('unavailable');
    const part = this.part(batch, partId),
      current = part[slot];
    if (!current) throw new KernelFault('conflict');
    let receipt = current.receipt;
    try {
      receipt =
        actual.outcome === 'cancelled-before-dispatch'
          ? null
          : mergeReceipt(current.receipt, actual.receipt);
    } catch (cause) {
      actual = { ...actual, outcome: 'unknown', error: failed(cause) };
    }
    let settled: QQDeliveryAttempt = {
      ...current,
      phase: 'settled',
      outcome: actual.outcome,
      correlationId: actual.correlationId ?? current.correlationId,
      receipt,
      cleanup: actual.cleanup,
      error: actual.error,
      settledAt: Math.max(Date.now(), current.startedAt),
    };
    if (
      !isQQDeliveryAttempt(settled) ||
      (!actual.dispatched && actual.outcome === 'accepted') ||
      (current.phase === 'dispatched' && actual.outcome === 'cancelled-before-dispatch')
    ) {
      actual = {
        dispatched: true,
        outcome: 'unknown',
        receipt: current.receipt,
        cleanup: 'unknown',
        error: makeError('unavailable', false),
      };
      settled = {
        ...current,
        phase: 'settled',
        outcome: 'unknown',
        receipt: current.receipt,
        cleanup: 'unknown',
        error: actual.error,
        settledAt: Math.max(Date.now(), current.startedAt),
      };
    }
    if (actual.cleanup !== 'settled') this.cleanupFailure = makeError('unavailable', false);
    await this.update(
      batch,
      batch.delivery.parts.map((candidate) =>
        candidate.id === partId ? { ...candidate, [slot]: settled } : candidate,
      ),
    );
    return { outcome: actual, interruption };
  }
  private async sendPart(batch: Batch, id: string): Promise<KernelError | null> {
    const part = this.part(batch, id);
    let uploaded: unknown;
    if (part.content.kind !== 'inline-text') {
      const material = part.content.material;
      if (!material) return makeError('not-ready', false);
      const compound =
        batch.delivery.mode === 'onebot' &&
        part.content.kind === 'material' &&
        ['file', 'text'].includes(material.kind);
      const result = await this.attempt(batch, id, compound ? 'upload-and-send' : 'upload');
      if (
        result.interruption ||
        result.outcome.error ||
        result.outcome.outcome !== 'accepted' ||
        result.outcome.cleanup !== 'settled'
      )
        return result.interruption ?? result.outcome.error ?? makeError('unavailable', false);
      if (compound)
        return isQQDeliveryPartAccepted(this.part(batch, id))
          ? null
          : makeError('unavailable', false);
      uploaded = result.outcome.uploaded;
      if (uploaded === undefined) return makeError('unavailable', false);
    }
    const result = await this.attempt(batch, id, 'send', uploaded);
    return (
      result.interruption ??
      result.outcome.error ??
      (result.outcome.cleanup === 'settled' && isQQDeliveryPartAccepted(this.part(batch, id))
        ? null
        : (result.outcome.error ?? makeError('unavailable', false)))
    );
  }
  private async finish(batch: Batch, error: KernelError | null): Promise<QQDeliveryView> {
    const parts = batch.delivery.parts.map((part) =>
      part.preparation === 'pending'
        ? {
            ...part,
            preparation: 'cancelled' as const,
            error: error ?? makeError('cancelled', false),
          }
        : part,
    );
    const unknown = parts.some((part) =>
      [part.upload, part.send].some(
        (attempt) =>
          attempt &&
          (['pending', 'unknown'].includes(attempt.outcome) || attempt.cleanup !== 'settled'),
      ),
    );
    const complete = !unknown && parts.every(isQQDeliveryPartAccepted);
    const some = parts.some(isQQDeliveryPartAccepted);
    const outcome: QQDeliveryView['outcome'] = unknown
      ? 'unknown'
      : complete
        ? 'accepted'
        : some
          ? 'partial'
          : error?.code === 'cancelled'
            ? 'cancelled'
            : 'failed';
    const lastError = complete
      ? null
      : (error ?? parts.find((part) => part.error)?.error ?? makeError('unavailable', false));
    batch.delivery = await this.options.runtime.state('updateDelivery', {
      delivery: {
        ...batch.delivery,
        parts,
        phase: 'terminal',
        outcome,
        error: lastError,
        updatedAt: Math.max(Date.now(), batch.delivery.updatedAt),
      },
    });
    return batch.delivery;
  }
  private async deliver(entry: Pending, signal: AbortSignal): Promise<QQDeliveryView> {
    const baseAccess = this.access(entry, signal),
      id = deliveryId(entry.event.admission.id);
    try {
      const known = await this.options.runtime.state('getDelivery', {
        id,
        scope: baseAccess.scope,
      });
      if (
        !isDeepStrictEqual(
          known.messageIds,
          entry.event.outputs.map((message) => message.id),
        )
      )
        throw new KernelFault('conflict');
      return known;
    } catch (error) {
      if (!absent(error)) throw error;
    }
    const prepared = await this.prepare(entry, baseAccess);
    if (prepared.delivery.phase === 'blocked') return prepared.delivery;
    if (!prepared.source) throw new KernelFault('not-ready');
    const expiry =
      prepared.delivery.mode === 'official-passive' ? prepared.delivery.eligibilityExpiresAt : null;
    const eligibilitySignal =
      expiry === null
        ? signal
        : AbortSignal.any([signal, AbortSignal.timeout(Math.max(0, expiry - Date.now()))]);
    const batch: Batch = {
      delivery: prepared.delivery,
      source: prepared.source,
      access: this.access(entry, eligibilitySignal, prepared.source),
    };
    let error: KernelError | null = null;
    try {
      for (const planned of batch.delivery.parts) {
        let part = this.part(batch, planned.id);
        if (part.requirement === 'optional-voice') {
          if (part.preparation !== 'pending') {
            error = part.error;
            break;
          }
          if (
            batch.delivery.parts.some(
              (previous) =>
                previous.requirement === 'mandatory-text' && !isQQDeliveryPartAccepted(previous),
            )
          )
            throw new KernelFault('permission-denied');
          const voiceAccess = this.access(
            entry,
            AbortSignal.any([batch.access.signal, entry.voiceAbort.signal]),
            batch.source,
          );
          try {
            await voiceAccess.check();
            if (!(await this.options.policy()).settings.voiceOutputEnabled)
              throw new KernelFault('permission-denied');
            const material = await this.options.audio.exportVoice(
              {
                inputId: entry.event.admission.id,
                deliveryId: batch.delivery.id,
                messages: entry.event.outputs,
              },
              voiceAccess,
            );
            await voiceAccess.check();
            if (
              !isCompanionMaterialRef(material) ||
              material.kind !== 'voice' ||
              material.mediaType !== 'audio/silk'
            )
              throw new KernelFault('invalid-input');
            if (part.content.kind !== 'voice') throw new KernelFault('conflict');
            part = { ...part, preparation: 'ready', content: { ...part.content, material } };
            await this.update(
              batch,
              batch.delivery.parts.map((value) => (value.id === part.id ? part : value)),
            );
            const voiceBatch = { ...batch, access: voiceAccess };
            try {
              error = await this.sendPart(voiceBatch, part.id);
            } finally {
              batch.delivery = voiceBatch.delivery;
            }
          } catch (cause) {
            error = failed(cause);
            part = this.part(batch, part.id);
            if (part.preparation === 'pending')
              await this.update(
                batch,
                batch.delivery.parts.map((value) =>
                  value.id === part.id
                    ? {
                        ...value,
                        preparation: voiceAccess.signal.aborted ? 'cancelled' : 'failed',
                        error,
                      }
                    : value,
                ),
              );
          }
        } else error = await this.sendPart(batch, part.id);
        if (error) break;
      }
    } catch (cause) {
      error = failed(cause);
    }
    return this.finish(batch, error);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.offCommit();
    this.lifetime.abort();
    for (const entry of this.pending.values()) {
      entry.handle?.cancel('shutdown');
      entry.voiceAbort.abort();
    }
    this.closing = (async () => {
      await this.rechecking;
      await Promise.allSettled([...this.pending.values()].map((entry) => entry.work));
      await Promise.allSettled([...this.reports]);
      const error = this.cleanupFailure ?? this.reportError;
      if (error) throw new KernelFault(error.code);
    })();
    return this.closing;
  }
}
