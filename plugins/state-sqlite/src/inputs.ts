import {
  companionAudienceKey,
  COMPANION_INPUT_READY_MAX,
  COMPANION_INPUT_READY_PER_AUDIENCE,
  COMPANION_INPUT_CONTEXT_MAX,
  QQ_GROUP_CONTEXT_MAX_AGE_MS,
  isCompanionInputMaterials,
  makeError,
} from '@pet/contracts';
import type {
  CompanionInputAdmission,
  CompanionConversationAudience,
  CompanionMaterialRef,
  CompanionMessage,
} from '@pet/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { StateMethodInputs, StateMethodOutputs, StoredMaterial } from './types.js';
import { decode, fingerprint, receipt, scalar } from './records.js';
import type { RecordWriter } from './records.js';
import { assertCleanup, assertVisible } from './scope.js';
import { StateFailure } from './failure.js';
import { jsonBytes } from './validation.js';
import { checkProactiveAdmission } from './judgments.js';

export function findInput(
  db: DatabaseSync,
  input: StateMethodInputs['findInput'],
): CompanionInputAdmission | null {
  const row = db.prepare('SELECT body FROM input_admissions WHERE id=?').get(input.id);
  if (row === undefined) return null;
  const admission = decode<CompanionInputAdmission>(row);
  assertVisible(admission.origin.audience, input.scope);
  return admission;
}

export function getInput(
  db: DatabaseSync,
  input: StateMethodInputs['getInput'],
): CompanionInputAdmission {
  const admission = findInput(db, input);
  if (admission === null) throw new StateFailure('unavailable');
  return admission;
}

export function inputMessage(
  db: DatabaseSync,
  input: StateMethodInputs['inputMessage'],
): CompanionMessage {
  const admission = getInput(db, input);
  if (admission.messageId === null) throw new StateFailure('not-ready');
  const message = decode<CompanionMessage>(
    db.prepare('SELECT body FROM messages WHERE id=?').get(admission.messageId),
  );
  if (
    message.id !== admission.id ||
    !message.audience ||
    companionAudienceKey(message.audience) !== companionAudienceKey(admission.origin.audience) ||
    !message.origins?.some((origin) => fingerprint(origin) === fingerprint(admission.origin))
  )
    throw new StateFailure('conflict');
  return message;
}

/** Supplemental evidence stays separate from the current author's canonical input text. */
export function inputNotices(
  db: DatabaseSync,
  input: StateMethodInputs['inputNotices'],
): StateMethodOutputs['inputNotices'] {
  const admission = getInput(db, input);
  const rows = db
    .prepare(
      `SELECT body FROM messages WHERE audience_key=?
    AND json_extract(body,'$.inputId')=? AND json_extract(body,'$.role')='notice'
    ORDER BY json_extract(body,'$.createdAt'),id LIMIT 5`,
    )
    .all(companionAudienceKey(admission.origin.audience), admission.id);
  if (rows.length > 4) throw new StateFailure('quota-exceeded');
  const notices = rows.map((row) => {
    const message = decode<CompanionMessage>(row);
    return { id: message.id, text: message.text };
  });
  if (jsonBytes(notices) > 32 * 1024) throw new StateFailure('quota-exceeded');
  return notices;
}

/** Both owner and external admissions use this predicate in their existing write transaction. */
export function assertInputCapacity(
  db: DatabaseSync,
  audience: CompanionConversationAudience,
): void {
  const queued = scalar(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM input_admissions WHERE phase IN ('preparing','ready')",
      )
      .get(),
    'count',
  );
  const scoped = scalar(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM input_admissions WHERE audience_key=? AND phase IN ('preparing','ready')",
      )
      .get(companionAudienceKey(audience)),
    'count',
  );
  if (queued >= COMPANION_INPUT_READY_MAX || scoped >= COMPANION_INPUT_READY_PER_AUDIENCE)
    throw new StateFailure('quota-exceeded');
}

export function createInput(
  writer: RecordWriter,
  input: StateMethodInputs['createInput'],
): StateMethodOutputs['createInput'] {
  const digest = fingerprint({ kind: 'input.create', payload: input });
  const known = writer.command(input.commandId, digest);
  if (known)
    return {
      receipt: known,
      admission: getInput(writer.db, { id: input.id, scope: { kind: 'management' } }),
    };
  if (
    writer.db.prepare('SELECT id FROM input_admissions WHERE id=?').get(input.id) ||
    writer.db.prepare('SELECT id FROM messages WHERE id=?').get(input.id)
  )
    throw new StateFailure('conflict');
  assertInputCapacity(writer.db, input.origin.audience);
  const audience = companionAudienceKey(input.origin.audience);
  const now =
    input.origin.kind === 'qq-proactive' ? checkProactiveAdmission(writer.db, input) : Date.now();
  const admission: CompanionInputAdmission = {
    id: input.id,
    messageId: null,
    origin: input.origin,
    materialIds: input.materialIds,
    phase: 'preparing',
    cleanup: 'pending',
    createdAt: now,
    updatedAt: now,
    error: null,
  };
  writer.db
    .prepare(
      'INSERT INTO input_admissions(id,command_id,fingerprint,audience_key,principal_id,phase,body,evidence) VALUES(?,?,?,?,?,?,?,?)',
    )
    .run(
      input.id,
      input.commandId,
      digest,
      audience,
      input.origin.principalId,
      admission.phase,
      JSON.stringify(admission),
      JSON.stringify(input.evidence),
    );
  const accepted = receipt(input.commandId, null, null);
  writer.saveCommand(digest, accepted);
  writer.event(
    'runtime',
    { inputId: input.id, inputPhase: admission.phase },
    now,
    input.origin.audience,
    input.origin.principalId,
  );
  return { receipt: accepted, admission };
}

export function commitInput(
  writer: RecordWriter,
  input: StateMethodInputs['commitInput'],
): StateMethodOutputs['commitInput'] {
  const row = writer.db
    .prepare('SELECT body,command_id FROM input_admissions WHERE id=?')
    .get(input.id);
  const current = decode<CompanionInputAdmission>(row);
  if (current.messageId) {
    const message = decode<CompanionMessage>(
      writer.db.prepare('SELECT body FROM messages WHERE id=?').get(current.messageId),
    );
    if (
      message.text !== input.text ||
      fingerprint(message.materials ?? []) !==
        fingerprint(input.materials ?? message.materials ?? []) ||
      fingerprint(message.content ?? { kind: 'inline-text' }) !==
        fingerprint(input.content ?? { kind: 'inline-text' })
    )
      throw new StateFailure('conflict');
    return { admission: current, message };
  }
  if (current.phase !== 'preparing') throw new StateFailure('conflict');
  const materials: readonly CompanionMaterialRef[] =
    input.materials ??
    current.materialIds.map((id) => {
      const material = getMaterial(writer.db, { id, scope: { kind: 'management' } });
      if (material.phase !== 'ready' || !material.reference) throw new StateFailure('not-ready');
      return material.reference;
    });
  if (!isCompanionInputMaterials(materials)) throw new StateFailure('quota-exceeded');
  if (
    current.origin.kind !== 'work-result' &&
    (materials.length !== current.materialIds.length ||
      current.materialIds.some((id) => !materials.some((material) => material.id === id)))
  )
    throw new StateFailure('conflict');
  for (const reference of materials) {
    const stored = getMaterial(writer.db, { id: reference.id, scope: { kind: 'management' } });
    if (
      !current.materialIds.includes(reference.id) ||
      stored.phase !== 'ready' ||
      fingerprint(stored.reference) !== fingerprint(reference) ||
      companionAudienceKey(reference.audience) !== companionAudienceKey(current.origin.audience)
    )
      throw new StateFailure('conflict');
  }
  const content = input.content ?? { kind: 'inline-text' as const };
  const message = writer.appendMessage({
    id: current.id,
    role:
      current.origin.kind === 'work-result' || current.origin.kind === 'qq-proactive'
        ? 'notice'
        : 'user',
    text: input.text,
    inputId: typeof row?.['command_id'] === 'string' ? row['command_id'] : current.id,
    taskId: current.origin.kind === 'work-result' ? current.origin.taskId : null,
    audience: current.origin.audience,
    origins: [current.origin],
    materials,
    content,
  });
  const admission: CompanionInputAdmission = {
    ...current,
    messageId: current.id,
    phase: 'ready',
    updatedAt: message.createdAt,
  };
  writer.db
    .prepare('UPDATE input_admissions SET phase=?,body=? WHERE id=?')
    .run(admission.phase, JSON.stringify(admission), current.id);
  return { admission, message };
}

export function claimInput(
  writer: RecordWriter,
  input: { readonly id: string },
): { admission: CompanionInputAdmission; claimed: boolean } {
  const current = getInput(writer.db, { id: input.id, scope: { kind: 'management' } });
  if (current.phase !== 'ready' || current.cleanup !== 'pending')
    return { admission: current, claimed: false };
  if (!current.messageId) throw new StateFailure('conflict');
  const active = scalar(
    writer.db.prepare("SELECT COUNT(*) AS count FROM input_admissions WHERE phase='active'").get(),
    'count',
  );
  if (active >= COMPANION_INPUT_CONTEXT_MAX) throw new StateFailure('quota-exceeded');
  const admission: CompanionInputAdmission = { ...current, phase: 'active', updatedAt: Date.now() };
  saveInput(writer, admission);
  return { admission, claimed: true };
}

function saveInput(writer: RecordWriter, input: CompanionInputAdmission): void {
  writer.db
    .prepare('UPDATE input_admissions SET phase=?,body=? WHERE id=?')
    .run(input.phase, JSON.stringify(input), input.id);
  writer.event(
    'runtime',
    { inputId: input.id, inputPhase: input.phase, cleanup: input.cleanup },
    input.updatedAt,
    input.origin.audience,
    input.origin.principalId,
  );
}

export function updateInput(
  writer: RecordWriter,
  input: StateMethodInputs['updateInput'],
): CompanionInputAdmission {
  const current = getInput(writer.db, { id: input.id, scope: { kind: 'management' } });
  const terminal = !['preparing', 'ready', 'active'].includes(current.phase);
  if (
    (terminal && input.phase !== current.phase) ||
    (input.phase !== current.phase && ['preparing', 'ready', 'active'].includes(input.phase))
  )
    throw new StateFailure('conflict');
  assertCleanup(current.cleanup, input.cleanup);
  if (input.cleanup === 'settled' && ['preparing', 'ready', 'active'].includes(input.phase))
    throw new StateFailure('conflict');
  const next = {
    ...current,
    phase: input.phase,
    cleanup: input.cleanup,
    error: input.error === undefined ? current.error : input.error,
  };
  if (fingerprint(next) === fingerprint(current)) return current;
  const updated = { ...next, updatedAt: Date.now() };
  saveInput(writer, updated);
  return updated;
}

export function findMaterial(
  db: DatabaseSync,
  input: StateMethodInputs['findMaterial'],
): StoredMaterial | null {
  const row = db.prepare('SELECT body FROM materials WHERE id=?').get(input.id);
  if (row === undefined) return null;
  const material = decode<StoredMaterial>(row);
  assertVisible(material.audience, input.scope);
  if (
    material.phase === 'preparing' &&
    material.observationId &&
    !db
      .prepare('SELECT id FROM conversation_observations WHERE id=? AND observed_at>=?')
      .get(material.observationId, Date.now() - QQ_GROUP_CONTEXT_MAX_AGE_MS)
  )
    throw new StateFailure('unavailable');
  return material;
}

export function getMaterial(
  db: DatabaseSync,
  input: StateMethodInputs['getMaterial'],
): StoredMaterial {
  const material = findMaterial(db, input);
  if (material === null) throw new StateFailure('unavailable');
  return material;
}

export function putMaterial(writer: RecordWriter, input: StoredMaterial): StoredMaterial {
  if (input.inputId) {
    const admission = getInput(writer.db, { id: input.inputId, scope: { kind: 'management' } });
    if (companionAudienceKey(admission.origin.audience) !== companionAudienceKey(input.audience))
      throw new StateFailure('conflict');
  }
  const existing = writer.db.prepare('SELECT body FROM materials WHERE id=?').get(input.id);
  const current = existing ? decode<StoredMaterial>(existing) : null;
  if (input.observationId && (!current || current.phase === 'preparing')) {
    const observation = writer.db
      .prepare('SELECT audience_key FROM conversation_observations WHERE id=? AND observed_at>=?')
      .get(input.observationId, Date.now() - QQ_GROUP_CONTEXT_MAX_AGE_MS);
    if (!observation) throw new StateFailure('unavailable');
    if (observation['audience_key'] !== companionAudienceKey(input.audience))
      throw new StateFailure('conflict');
  }
  if (
    input.reference &&
    (input.reference.id !== input.id ||
      companionAudienceKey(input.reference.audience) !== companionAudienceKey(input.audience) ||
      !input.inputId ||
      !input.reference.originInputIds.includes(input.inputId))
  )
    throw new StateFailure('conflict');
  if (input.phase === 'ready' && !input.inputId) throw new StateFailure('invalid-input');
  if (current) {
    if (
      (current.inputId !== input.inputId &&
        (current.inputId !== null || current.phase !== 'preparing')) ||
      current.observationId !== input.observationId ||
      companionAudienceKey(current.audience) !== companionAudienceKey(input.audience)
    )
      throw new StateFailure('conflict');
    assertCleanup(current.cleanup, input.cleanup);
    const allowed =
      current.phase === input.phase ||
      (current.phase === 'preparing' &&
        ['ready', 'failed', 'unknown', 'released'].includes(input.phase)) ||
      (['ready', 'failed', 'unknown'].includes(current.phase) && input.phase === 'released');
    if (
      !allowed ||
      (current.reference && fingerprint(current.reference) !== fingerprint(input.reference)) ||
      (current.storageKey !== null &&
        current.storageKey !== input.storageKey &&
        input.phase !== 'released')
    )
      throw new StateFailure('conflict');
    if (fingerprint(current) === fingerprint(input)) return current;
  }
  writer.db
    .prepare(
      'INSERT INTO materials(id,input_id,observation_id,audience_key,phase,body) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET input_id=excluded.input_id,phase=excluded.phase,body=excluded.body',
    )
    .run(
      input.id,
      input.inputId,
      input.observationId,
      companionAudienceKey(input.audience),
      input.phase,
      JSON.stringify(input),
    );
  writer.event(
    'runtime',
    { materialId: input.id, materialPhase: input.phase, cleanup: input.cleanup },
    Date.now(),
    input.audience,
  );
  return input;
}

export function recoverInputs(
  writer: RecordWriter,
  limit: number,
): { inputIds: string[]; materialIds: string[]; hasMore: boolean } {
  const inputIds: string[] = [],
    materialIds: string[] = [];
  for (const row of writer.db
    .prepare(
      "SELECT body FROM input_admissions WHERE phase IN ('preparing','ready','active') ORDER BY sequence LIMIT ?",
    )
    .all(limit)) {
    const input = decode<CompanionInputAdmission>(row);
    saveInput(writer, {
      ...input,
      phase: input.phase === 'active' ? 'unknown' : 'interrupted',
      cleanup: 'unknown',
      updatedAt: Date.now(),
      error: makeError('unavailable', false),
    });
    inputIds.push(input.id);
  }
  for (const row of writer.db
    .prepare("SELECT body FROM materials WHERE phase='preparing' ORDER BY sequence LIMIT ?")
    .all(limit - inputIds.length)) {
    const material = decode<StoredMaterial>(row);
    const next = {
      ...material,
      phase: 'unknown' as const,
      cleanup: 'unknown' as const,
      error: makeError('unavailable', false),
    };
    writer.db
      .prepare('UPDATE materials SET phase=?,body=? WHERE id=?')
      .run(next.phase, JSON.stringify(next), next.id);
    writer.event(
      'runtime',
      { materialId: next.id, materialPhase: next.phase, cleanup: next.cleanup },
      Date.now(),
      next.audience,
    );
    materialIds.push(next.id);
  }
  const hasMore = !!writer.db
    .prepare(
      "SELECT id FROM input_admissions WHERE phase IN ('preparing','ready','active') UNION ALL SELECT id FROM materials WHERE phase='preparing' LIMIT 1",
    )
    .get();
  return { inputIds, materialIds, hasMore };
}
