import {
  COMPANION_MATERIAL_MAX_PARTS,
  QQ_GROUP_CONTEXT_MAX_BYTES,
  companionAudienceKey,
  type JsonObject,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { CompanionRuntime } from '@pet/companion-runtime';
import type { StateGroupAudience, StateObservation, StateReadScope } from '@pet/state-sqlite';

export interface QQJudgeContextWindow {
  readonly observationId: string;
  readonly contextMessages: number;
  readonly contextMaxAgeMs: number;
}
function observationData(observation: StateObservation): JsonObject {
  return {
    id: observation.id,
    principalId: observation.principalId,
    observedAt: observation.observedAt,
    text: observation.text,
    quotedText: observation.quotedText,
    materialIds: [...observation.materialIds],
    fileEvidence: observation.fileEvidence
      ? {
          kind: 'file',
          name: observation.fileEvidence.name,
          reportedSize: observation.fileEvidence.reportedSize,
        }
      : null,
  };
}

/** Exact current candidate plus bounded group/public history; no arbitrary prompt or byte locator. */
export async function readQQJudgePrompt(
  runtime: Pick<CompanionRuntime, 'state'>,
  audience: StateGroupAudience,
  window: QQJudgeContextWindow,
  signal: AbortSignal,
): Promise<string> {
  const scope: StateReadScope = { kind: 'conversation', audience, principalId: null };
  const [candidate, history, memory] = await Promise.all([
    runtime.state('getObservation', { id: window.observationId, scope }, signal),
    window.contextMessages === 0
      ? Promise.resolve({ observations: [], hasMore: false })
      : runtime.state('observations', { scope }, signal),
    runtime.state('memorySnapshot', { scope }, signal),
  ]);
  signal.throwIfAborted();
  const key = companionAudienceKey(audience);
  if (companionAudienceKey(candidate.audience) !== key) throw new KernelFault('permission-denied');
  const current = observationData(candidate);
  const observations: JsonObject[] = [];
  const facts: JsonObject[] = [];
  const media: JsonObject[] = [];
  const omitted = { observations: history.hasMore, facts: false, media: false };
  const value = (): JsonObject => ({
    current,
    observations,
    facts,
    media,
    omitted,
    historyWindow: { messages: window.contextMessages, maxAgeMs: window.contextMaxAgeMs },
  });
  const fits = (): boolean =>
    Buffer.byteLength(JSON.stringify(value())) <= QQ_GROUP_CONTEXT_MAX_BYTES;
  if (!fits()) throw new KernelFault('quota-exceeded');
  const materialIds = new Set(candidate.materialIds);
  const minimumTime = Date.now() - window.contextMaxAgeMs;
  const visibleHistory = history.observations.filter(
    (item) => item.id !== candidate.id && item.observedAt >= minimumTime,
  );
  if (visibleHistory.length > window.contextMessages) omitted.observations = true;
  for (const observation of visibleHistory.slice(-window.contextMessages).reverse()) {
    if (companionAudienceKey(observation.audience) !== key)
      throw new KernelFault('permission-denied');
    observations.unshift(observationData(observation));
    if (!fits()) {
      observations.shift();
      omitted.observations = true;
      break;
    }
    for (const id of observation.materialIds) materialIds.add(id);
  }
  for (const fact of memory.facts) {
    if (
      !fact.audience ||
      (fact.audience.kind !== 'public' && companionAudienceKey(fact.audience) !== key)
    )
      throw new KernelFault('permission-denied');
    facts.push({ key: fact.key, value: fact.value, scope: fact.audience.kind });
    if (!fits()) {
      facts.pop();
      omitted.facts = true;
      break;
    }
  }
  for (const id of [...materialIds].slice(0, COMPANION_MATERIAL_MAX_PARTS)) {
    const material = await runtime.state('getMaterial', { id, scope }, signal);
    signal.throwIfAborted();
    const ref = material.reference;
    if (ref && companionAudienceKey(ref.audience) !== key)
      throw new KernelFault('permission-denied');
    media.push(
      ref
        ? {
            id,
            phase: material.phase,
            kind: ref.kind,
            name: ref.name,
            mediaType: ref.mediaType,
            sizeBytes: ref.sizeBytes,
            durationMs: ref.durationMs,
          }
        : { id, phase: material.phase },
    );
    if (!fits()) {
      media.pop();
      omitted.media = true;
      break;
    }
  }
  if (materialIds.size > media.length) omitted.media = true;
  const text = JSON.stringify(value());
  if (Buffer.byteLength(text) > QQ_GROUP_CONTEXT_MAX_BYTES) throw new KernelFault('quota-exceeded');
  return text;
}
