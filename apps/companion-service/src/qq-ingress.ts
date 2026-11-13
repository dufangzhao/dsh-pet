import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  COMPANION_MAX_TEXT,
  COMPANION_INPUT_READY_MAX,
  QQ_FEATURE_PLUGIN_ID,
  companionAudienceKey,
  makeError,
  sameCompanionReplyRoute,
  type CompanionCleanup,
  type CompanionInputAdmission,
  type CompanionInputOrigin,
  type CompanionMaterialRef,
  type JsonObject,
  type KernelError,
  type QQInputReceipt,
} from '@pet/contracts';
import { KernelFault, type TaskHandle } from '@pet/host-kernel';
import type {
  CompanionPluginHost,
  CompanionRuntime,
  RuntimeInputAccess,
  RuntimeInputGrant,
} from '@pet/companion-runtime';
import type { OfficialMessageEvent } from '@pet/qq-official';
import type { OneBotFrame, OneBotResponse } from '@pet/qq-onebot';
import type {
  QQController,
  CapturedQqSourceBase,
  CapturedParticipantAuthority,
  QQIngressHandlers,
} from './qq-controller.js';
import type { QQJudgeController } from './qq-judge.js';
import { mapOfficialInput, mapOneBotInput, type QQMappedInput } from './qq-input.js';
import {
  assertQQParticipantCurrent,
  qqGroupSettings,
  qqWakeTrigger,
  resolveQQParticipant,
  type QQParticipant,
} from './qq-policy.js';

export type QQInputPreparation =
  | {
      readonly ok: true;
      readonly materials: readonly CompanionMaterialRef[];
      readonly transcript: string;
      readonly notes?: readonly string[];
    }
  | { readonly ok: false; readonly error: KernelError; readonly cleanup: CompanionCleanup };
export interface QQIngressOptions {
  readonly judge: Pick<QQJudgeController, 'judge'>;
  prepareMedia?(
    input: CompanionInputAdmission,
    mapped: QQMappedInput,
    source: CapturedQqSourceBase,
    access: RuntimeInputAccess,
  ): Promise<QQInputPreparation>;
  readonly random?: () => number;
  onReceipt?(receipt: QQInputReceipt): void;
}

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fault = (error: unknown): KernelError =>
  error instanceof KernelFault
    ? error.error
    : error instanceof Error && error.name === 'AbortError'
      ? makeError('cancelled', false)
      : makeError('internal', false);
const management = { kind: 'management' as const };
const receipt = (
  eventKey: string | null,
  state: QQInputReceipt['state'],
  input: CompanionInputAdmission | null,
  error: KernelError | null = null,
): QQInputReceipt => ({
  eventKey,
  state,
  inputId: input?.id ?? null,
  messageId: input?.messageId ?? null,
  error,
});
function evidence(mapped: QQMappedInput): JsonObject {
  const parts = mapped.materials.map((part) =>
    part.protocol === 'official'
      ? {
          kind: part.kind,
          quoted: part.quoted,
          name: part.attachment.filename,
          type: part.attachment.content_type,
          size: part.attachment.size,
        }
      : {
          kind: part.kind,
          quoted: part.quoted,
          name: part.segment.data['name'] ?? part.segment.data['file_name'] ?? null,
          size: part.segment.data['file_size'] ?? part.segment.data['size'] ?? null,
          fileId: part.segment.data['file_id'] ?? null,
        },
  );
  return JSON.parse(
    JSON.stringify({
      actor: mapped.actor,
      text: mapped.text,
      quote: mapped.quote,
      messageId: mapped.route.reference?.messageId ?? null,
      parts,
    }),
  ) as JsonObject;
}

function observationText(mapped: QQMappedInput): string {
  if (!mapped.materials.length && !mapped.fileEvidence) return mapped.text;
  return JSON.stringify({
    text: mapped.text,
    media: mapped.materials.map((part) => ({
      kind: part.kind,
      quoted: part.quoted,
      name:
        part.protocol === 'official'
          ? part.attachment.filename
          : (part.segment.data['name'] ?? part.segment.data['file_name'] ?? null),
      reportedSize:
        part.protocol === 'official'
          ? part.attachment.size
          : (part.segment.data['file_size'] ?? part.segment.data['size'] ?? null),
    })),
    ...(mapped.fileEvidence
      ? {
          sharedFile: {
            materialId: mapped.observationId,
            name: mapped.fileEvidence.name,
            reportedSize: mapped.fileEvidence.reportedSize,
            availability: 'not-loaded',
          },
        }
      : {}),
  });
}

/** Bounded source admission. Model work and accepted jobs keep their own host-policy lifetime. */
export class QQIngress {
  private readonly lifetime = new AbortController();
  private readonly pending = new Map<
    TaskHandle,
    { check(): Promise<void>; readonly done: Promise<void> }
  >();
  private readonly rechecks = new Set<Promise<void>>();
  private readonly offCommit: () => void;
  private closed = false;
  private closing: Promise<void> | undefined;
  private observerFailures = 0;
  readonly handlers: QQIngressHandlers;

  constructor(
    private readonly host: CompanionPluginHost,
    private readonly runtime: CompanionRuntime,
    private readonly qq: QQController,
    private readonly options: QQIngressOptions,
  ) {
    this.handlers = {
      official: async (event, source) => {
        await this.official(event, source);
      },
      onebot: async (event, source) => {
        await this.onebot(event, source);
      },
    };
    this.offCommit = host.onConfigurationCommit((commit) => {
      if (commit.pluginId !== QQ_FEATURE_PLUGIN_ID || this.closed) return;
      const work = Promise.all(
        [...this.pending].map(async ([task, pending]) => {
          try {
            await pending.check();
          } catch {
            task.cancel();
          }
        }),
      ).then(() => {});
      this.rechecks.add(work);
      void work.then(
        () => this.rechecks.delete(work),
        () => this.rechecks.delete(work),
      );
    });
  }
  diagnostics(): { pending: number; observerFailures: number } {
    return { pending: this.pending.size, observerFailures: this.observerFailures };
  }
  private report(value: QQInputReceipt): QQInputReceipt {
    try {
      this.options.onReceipt?.(value);
    } catch {
      this.observerFailures++;
    }
    return value;
  }
  async official(
    event: OfficialMessageEvent,
    source: CapturedQqSourceBase,
  ): Promise<QQInputReceipt | null> {
    try {
      const mapped = mapOfficialInput(source.account, event, source.selfId ?? null);
      return mapped === null ? null : await this.accept(mapped, source);
    } catch (error) {
      return this.report(receipt(null, 'rejected', null, fault(error)));
    }
  }
  async onebot(
    event: Exclude<OneBotFrame, OneBotResponse>,
    source: CapturedQqSourceBase,
  ): Promise<QQInputReceipt | null> {
    try {
      const mapped = mapOneBotInput(source.account, event);
      return mapped === null ? null : await this.accept(mapped, source);
    } catch (error) {
      return this.report(receipt(null, 'rejected', null, fault(error)));
    }
  }

  private issuedGrant(
    origin: CompanionInputOrigin,
    role: RuntimeInputGrant['role'],
    authority: CapturedParticipantAuthority,
    policyCheck: () => void,
  ): RuntimeInputGrant {
    const revoked = new AbortController();
    const signal = AbortSignal.any([authority.signal, revoked.signal, this.lifetime.signal]);
    const current = (): void => {
      if (this.closed || signal.aborted) throw new KernelFault('permission-denied');
      try {
        policyCheck();
      } catch (error) {
        revoked.abort();
        throw error;
      }
    };
    return {
      origin,
      role,
      signal,
      check: async () => {
        // Run the synchronous policy predicate before yielding, so deny→restore cannot revive this grant.
        current();
        try {
          await authority.check();
        } catch (error) {
          revoked.abort();
          throw error;
        }
        current();
      },
    };
  }
  private async check(grant: RuntimeInputGrant): Promise<void> {
    if (this.closed || grant.signal.aborted) throw new KernelFault('permission-denied');
    await grant.check();
    if (this.closed || grant.signal.aborted) throw new KernelFault('permission-denied');
  }
  private access(grant: RuntimeInputGrant, signal: AbortSignal): RuntimeInputAccess {
    return {
      signal: AbortSignal.any([grant.signal, signal]),
      scope: {
        kind: 'conversation',
        audience: grant.origin.audience,
        principalId: grant.origin.principalId,
      },
      check: async () => {
        signal.throwIfAborted();
        await this.check(grant);
        signal.throwIfAborted();
      },
    };
  }
  private launch(
    eventKey: string,
    grant: RuntimeInputGrant,
    operation: (
      signal: AbortSignal,
      announce: (value: QQInputReceipt) => void,
    ) => Promise<QQInputReceipt | null>,
  ): Promise<QQInputReceipt> {
    if (this.closed || this.pending.size >= COMPANION_INPUT_READY_MAX)
      return Promise.resolve(
        this.report(
          receipt(
            eventKey,
            'rejected',
            null,
            makeError(this.closed ? 'not-ready' : 'quota-exceeded'),
          ),
        ),
      );
    let resolve: (value: QQInputReceipt) => void = () => {};
    const first = new Promise<QQInputReceipt>((done) => {
      resolve = done;
    });
    let announced = false;
    const announce = (value: QQInputReceipt): void => {
      this.report(value);
      if (!announced) {
        announced = true;
        resolve(value);
      }
    };
    let started = false;
    let observed: QQInputReceipt | null | undefined;
    let task: TaskHandle;
    try {
      task = this.host.runFor(
        QQ_FEATURE_PLUGIN_ID,
        async (context) => {
          started = true;
          try {
            context.signal.throwIfAborted();
            observed = await operation(context.signal, announce);
          } catch (error) {
            observed = receipt(eventKey, 'rejected', null, fault(error));
          }
          if (observed) announce(observed);
          return null;
        },
        { signal: grant.signal },
      );
    } catch (error) {
      announce(receipt(eventKey, 'rejected', null, fault(error)));
      return first;
    }
    const done = (async () => {
      const outcome = await task.result;
      await task.settled;
      if (!started || (!outcome.ok && !observed))
        announce(
          receipt(eventKey, 'rejected', null, outcome.ok ? makeError('not-ready') : outcome.error),
        );
      if (!announced) announce(receipt(eventKey, 'rejected', null, makeError('not-ready')));
    })()
      .catch((error: unknown) => {
        announce(receipt(eventKey, 'rejected', null, fault(error)));
      })
      .finally(() => this.pending.delete(task));
    // Registration is synchronous and precedes TaskSupervisor's callback microtask / any State write.
    this.pending.set(task, { check: () => this.check(grant), done });
    return first;
  }

  async accept(mapped: QQMappedInput, source: CapturedQqSourceBase): Promise<QQInputReceipt> {
    if (this.closed) throw new KernelFault('not-ready');
    await source.check();
    if (mapped.self || mapped.machine)
      return this.report(
        receipt(mapped.eventKey, 'rejected', null, makeError('permission-denied')),
      );
    const policy = this.qq.policy();
    const participant = resolveQQParticipant(policy.settings, mapped.actor);
    if (!participant)
      return this.report(
        receipt(mapped.eventKey, 'rejected', null, makeError('permission-denied')),
      );
    const group =
      mapped.actor.scene === 'group'
        ? qqGroupSettings(policy.settings, mapped.actor.account, mapped.actor.groupId)
        : null;
    const trigger = mapped.contextOnly
      ? null
      : group
        ? qqWakeTrigger(group, mapped.text, mapped.mentioned)
        : 'direct';
    if (!trigger || mapped.eventKey === null) {
      if (mapped.actor.scene === 'group') {
        const authority = await this.qq.captureParticipantAuthority();
        await authority.check();
        assertQQParticipantCurrent(this.qq.policy().settings, mapped.actor, participant);
        const observed = await this.runtime.state(
          'observe',
          {
            observation: {
              id: mapped.observationId,
              audience: participant.audience,
              principalId: participant.principalId,
              observedAt: mapped.observedAt,
              text: observationText(mapped),
              quotedText: mapped.quote?.quotedText ?? null,
              materialIds: [],
              fileEvidence: mapped.fileEvidence,
            },
          },
          authority.signal,
        );
        if (
          observed.retained &&
          !mapped.contextOnly &&
          mapped.eventKey &&
          group?.proactive.enabled &&
          (this.options.random ?? Math.random)() < group.proactive.probability
        ) {
          const audience = {
            kind: 'qq-group' as const,
            account: mapped.actor.account,
            groupId: mapped.actor.groupId,
          };
          const origin: CompanionInputOrigin = {
            kind: 'qq-proactive',
            inputId: `qq-proactive-${hash(mapped.eventKey)}`,
            principalId: null,
            account: mapped.actor.account,
            eventKey: mapped.eventKey,
            audience,
            route: mapped.route,
            policyRevision: policy.revision,
          };
          const grant = this.issuedGrant(origin, 'reply-only', authority, () => {
            const current = this.qq.policy().settings;
            assertQQParticipantCurrent(current, mapped.actor, participant);
            if (!qqGroupSettings(current, audience.account, audience.groupId).proactive.enabled)
              throw new KernelFault('permission-denied');
          });
          return this.launch(mapped.eventKey, grant, async (signal, announce) => {
            signal.throwIfAborted();
            announce(receipt(mapped.eventKey, 'observed', null));
            return this.proactive(mapped, source, grant, group, signal, announce);
          });
        }
      }
      return this.report(receipt(mapped.eventKey, 'observed', null));
    }
    const id = mapped.observationId;
    const known = await this.runtime.state('findInput', { id, scope: management });
    const knownProactive = await this.runtime.state('findInput', {
      id: `qq-proactive-${hash(mapped.eventKey)}`,
      scope: management,
    });
    if (knownProactive) return this.report(receipt(mapped.eventKey, 'duplicate', knownProactive));
    const origin: CompanionInputOrigin = known?.origin ?? {
      kind: 'qq',
      inputId: id,
      principalId: participant.principalId,
      actor: mapped.actor,
      eventKey: mapped.eventKey,
      messageId: mapped.route.reference?.messageId ?? null,
      trigger,
      quote: mapped.quote,
      audience: participant.audience,
      route: mapped.route,
      policyRevision: policy.revision,
    };
    if (known) {
      await source.check();
      const duplicate = await this.runtime.state('createInput', {
        id,
        commandId: `qq-admit-${hash(mapped.eventKey)}`,
        origin,
        evidence: evidence(mapped),
        materialIds: mapped.materials.map((_part, index) => `material-${hash([id, index])}`),
      });
      if (duplicate.receipt.status !== 'duplicate') throw new KernelFault('conflict');
      return this.report(receipt(mapped.eventKey, 'duplicate', duplicate.admission));
    }
    const authority = await this.qq.captureParticipantAuthority();
    const grant = this.issuedGrant(origin, participant.role, authority, () => {
      assertQQParticipantCurrent(this.qq.policy().settings, mapped.actor, participant);
    });
    // No await between issuing this grant and registering its policy watcher in launch().
    return this.launch(mapped.eventKey, grant, (signal, announce) =>
      this.admit(mapped, source, grant, mapped.text, signal, announce),
    );
  }

  private async rejected(
    eventKey: string | null,
    input: CompanionInputAdmission,
    error: KernelError,
    cleanup: CompanionCleanup,
  ): Promise<QQInputReceipt> {
    try {
      const current = await this.runtime.state('getInput', { id: input.id, scope: management });
      if (!['preparing', 'ready'].includes(current.phase))
        return receipt(eventKey, 'rejected', current, error);
      const changed = await this.runtime.state('updateInput', {
        id: input.id,
        phase: cleanup === 'settled' ? 'failed' : 'unknown',
        cleanup,
        error,
      });
      return receipt(eventKey, 'rejected', changed, error);
    } catch (storageError) {
      // Preserve the observed admission identity; a failed bookkeeping write is not a terminal receipt.
      return receipt(eventKey, 'rejected', input, fault(storageError));
    }
  }

  private async admit(
    mapped: QQMappedInput,
    source: CapturedQqSourceBase,
    grant: RuntimeInputGrant,
    text: string,
    signal: AbortSignal,
    announce: (value: QQInputReceipt) => void,
    proactiveLimits?: { readonly cooldownMs: number; readonly maxRepliesPerHour: number },
  ): Promise<QQInputReceipt> {
    const origin = grant.origin;
    if (!mapped.eventKey || !origin.inputId) throw new KernelFault('invalid-input');
    let input: CompanionInputAdmission | null = null;
    let owned = false;
    let cleanup: CompanionCleanup = 'settled';
    let handedOff: QQInputReceipt | null = null;
    const access = this.access(grant, signal);
    try {
      await access.check();
      await source.check();
      await access.check();
      // These writes use the protected runtime lane. Cancellation must join the actual DB result.
      const created = await this.runtime.state('createInput', {
        id: origin.inputId,
        commandId: `${origin.kind === 'qq-proactive' ? 'qq-proactive' : 'qq-admit'}-${hash(mapped.eventKey)}`,
        origin,
        evidence: evidence(mapped),
        materialIds: mapped.materials.map(
          (_part, index) => `material-${hash([origin.inputId, index])}`,
        ),
        ...(proactiveLimits ? { proactiveLimits } : {}),
      });
      input = created.admission;
      owned = created.receipt.status !== 'duplicate';
      await access.check();
      if (!owned) return receipt(mapped.eventKey, 'duplicate', input);
      if (mapped.materials.length) announce(receipt(mapped.eventKey, 'preparing', input));
      let materials: readonly CompanionMaterialRef[] = [];
      let transcript = '';
      let notes: readonly string[] = [];
      if (mapped.materials.length) {
        if (!this.options.prepareMedia) throw new KernelFault('not-ready');
        cleanup = 'unknown';
        const prepared = await this.options.prepareMedia(input, mapped, source, access);
        cleanup = prepared.ok ? 'settled' : prepared.cleanup;
        await access.check();
        if (!prepared.ok) return this.rejected(mapped.eventKey, input, prepared.error, cleanup);
        materials = prepared.materials;
        transcript = prepared.transcript;
        notes = prepared.notes ?? [];
      }
      const body = [text, transcript].filter((part) => part.trim()).join('\n');
      const canonicalText = body || (materials.length ? `收到 ${materials.length} 个附件。` : '');
      if (!canonicalText.trim() || canonicalText.length > COMPANION_MAX_TEXT)
        throw new KernelFault('quota-exceeded');
      await access.check();
      const committed = await this.runtime.state('commitInput', {
        id: input.id,
        text: canonicalText,
        materials,
        content: { kind: 'inline-text' },
      });
      input = committed.admission;
      await access.check();
      for (const [index, note] of notes.entries()) {
        await this.runtime.state('appendMessage', {
          id: `qq-note-${hash([input.id, index])}`,
          role: 'notice',
          text: note,
          inputId: input.id,
          audience: input.origin.audience,
          origins: [input.origin],
        });
        await access.check();
      }
      // No socket check after complete bytes: the original policy grant owns the Runtime handoff.
      await access.check();
      const dispatched = await this.runtime.dispatchReadyInput(input.id, grant);
      handedOff = receipt(mapped.eventKey, dispatched.queued ? 'accepted' : 'duplicate', input);
      await access.check();
      return handedOff;
    } catch (error) {
      if (handedOff) return handedOff; // A later task cancellation does not erase an observed handoff.
      return input && owned
        ? this.rejected(mapped.eventKey, input, fault(error), cleanup)
        : receipt(mapped.eventKey, 'rejected', input, fault(error));
    }
  }

  private async proactive(
    mapped: QQMappedInput,
    source: CapturedQqSourceBase,
    grant: RuntimeInputGrant,
    settings: ReturnType<typeof qqGroupSettings>,
    signal: AbortSignal,
    announce: (value: QQInputReceipt) => void,
  ): Promise<QQInputReceipt | null> {
    const origin = grant.origin;
    if (
      !mapped.eventKey ||
      mapped.contextOnly ||
      mapped.actor.scene !== 'group' ||
      !mapped.route.reference ||
      origin.kind !== 'qq-proactive'
    )
      return null;
    if (origin.audience.kind !== 'qq-group' || origin.policyRevision === null)
      throw new KernelFault('invalid-input');
    const audience = origin.audience;
    const access = this.access(grant, signal);
    const check = async (): Promise<void> => {
      await access.check();
      await source.check();
      await access.check();
      if (
        !isDeepStrictEqual(
          qqGroupSettings(this.qq.policy().settings, audience.account, audience.groupId),
          settings,
        )
      )
        throw new KernelFault('permission-denied');
    };
    await check();
    const direct = await this.runtime.state('findInput', {
      id: mapped.observationId,
      scope: management,
    });
    await check();
    if (direct) return null;
    const previous = await this.runtime.state('findInput', {
      id: origin.inputId,
      scope: management,
    });
    await check();
    if (previous) return null;
    const limits = {
      cooldownMs: settings.proactive.cooldownMs,
      maxRepliesPerHour: settings.proactive.maxRepliesPerHour,
    };
    const gate = await this.runtime.state('proactiveReadiness', { audience, limits });
    await check();
    if (!gate.eligible) return null;
    const text = `群聊新消息（引用资料，自主参与不代表该成员委托任务）：\n${mapped.text || '该消息含媒体附件。'}`;
    if (text.length > COMPANION_MAX_TEXT) return null;
    if (settings.proactive.mode === 'model-assisted') {
      const judgment = await this.options.judge.judge(
        {
          id: `judge-${hash(mapped.eventKey)}`,
          eventKey: mapped.eventKey,
          audience,
          policyRevision: origin.policyRevision,
          observationId: mapped.observationId,
          contextMessages: settings.contextMessages,
          contextMaxAgeMs: settings.contextMaxAgeMs,
          reference: mapped.route.reference,
          check,
        },
        access.signal,
      );
      await check();
      if (!judgment.decision) return null;
    }
    await check();
    return this.admit(mapped, source, grant, text, signal, announce, limits);
  }

  async grantForWorkResult(origin: CompanionInputOrigin): Promise<RuntimeInputGrant> {
    if (origin.kind !== 'work-result') throw new KernelFault('invalid-input');
    const task = await this.runtime.state('getTask', { id: origin.taskId, scope: management });
    const initiating = task.origin?.origins.find((candidate) => candidate.kind === 'qq');
    if (
      !initiating ||
      initiating.kind !== 'qq' ||
      task.origin?.principalId !== origin.principalId ||
      !sameCompanionReplyRoute(task.origin.route, origin.route) ||
      companionAudienceKey(task.origin.audience) !== companionAudienceKey(origin.audience)
    )
      throw new KernelFault('permission-denied');
    const participant = resolveQQParticipant(this.qq.policy().settings, initiating.actor);
    if (
      !participant ||
      participant.principalId !== origin.principalId ||
      companionAudienceKey(participant.audience) !== companionAudienceKey(origin.audience)
    )
      throw new KernelFault('permission-denied');
    const authority = await this.qq.captureParticipantAuthority();
    const captured: QQParticipant = {
      ...participant,
      role: participant.role === 'owner' ? 'owner' : 'member',
    };
    return this.issuedGrant(origin, 'reply-only', authority, () => {
      assertQQParticipantCurrent(this.qq.policy().settings, initiating.actor, captured);
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.offCommit();
    const pending = [...this.pending];
    this.lifetime.abort();
    for (const [task] of pending) task.cancel();
    this.closing = Promise.all([...pending.map(([, entry]) => entry.done), ...this.rechecks]).then(
      () => {},
    );
    return this.closing;
  }
}
