import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  companionAudienceKey,
  sameCompanionReplyRoute,
  isQQDeliveryView,
  isQQDeliveryPartAccepted,
  makeError,
  QQ_PAGE_MAX_ITEMS,
  QQ_REPLY_TEXT_SEPARATOR,
  QQ_OFFICIAL_C2C_PASSIVE_MAX_PARTS,
  QQ_OFFICIAL_GROUP_PASSIVE_MAX_PARTS,
  QQ_OFFICIAL_PASSIVE_WINDOW_MS,
} from '@pet/contracts';
import type {
  CompanionMessage,
  QQDeliveryAttempt,
  QQDeliveryView,
  QQReplyRoute,
} from '@pet/contracts';
import type { StateMethodInputs, StateMethodOutputs } from './types.js';
import { STATE_MAX_RESULT_BYTES } from './types.js';
import { decode, fingerprint, scalar } from './records.js';
import type { RecordWriter } from './records.js';
import { assertCleanup, assertVisible, scopeWhere } from './scope.js';
import { StateFailure } from './failure.js';
import { jsonBytes } from './validation.js';
import { getMaterial } from './inputs.js';

const sent = isQQDeliveryPartAccepted;
function frozen(delivery: QQDeliveryView, allocatingSequences = false): unknown {
  const {
    id,
    messageIds,
    origins,
    audience,
    route,
    textRepresentation,
    mode,
    eligibilityExpiresAt,
    allowedMessageParts,
    createdAt,
    parts,
  } = delivery;
  return {
    id,
    messageIds,
    origins,
    audience,
    route,
    textRepresentation,
    mode,
    eligibilityExpiresAt,
    allowedMessageParts,
    createdAt,
    parts: parts.map(({ id, index, requirement, content, msgSeq }) => ({
      id,
      index,
      requirement,
      msgSeq: allocatingSequences ? null : msgSeq,
      content:
        content.kind === 'voice' ? { kind: content.kind, messageIds: content.messageIds } : content,
    })),
  };
}
function fail(): never {
  throw new StateFailure('conflict');
}
function validateAttempt(
  previous: QQDeliveryAttempt | null,
  next: QQDeliveryAttempt | null,
  claim: boolean,
): void {
  if (!previous) {
    if (next && !claim) fail();
    return;
  }
  // A driver may publish its real wire echo only after the durable claim exists.
  if (
    !next ||
    previous.id !== next.id ||
    previous.operation !== next.operation ||
    previous.startedAt !== next.startedAt ||
    (previous.correlationId !== null && previous.correlationId !== next.correlationId)
  )
    fail();
  const ranks = { claimed: 0, dispatched: 1, settled: 2 };
  if (ranks[next.phase] < ranks[previous.phase]) fail();
  assertCleanup(previous.cleanup, next.cleanup);
  if (
    previous.phase === 'settled' &&
    fingerprint({ ...previous, cleanup: next.cleanup, correlationId: next.correlationId }) !==
      fingerprint(next)
  )
    fail();
  if (previous.phase === 'dispatched' && next.outcome === 'cancelled-before-dispatch') fail();
  if (next.settledAt !== null && next.settledAt < previous.startedAt) fail();
}

function validateContents(
  writer: RecordWriter,
  delivery: QQDeliveryView,
  requireReady = true,
): void {
  const messages: CompanionMessage[] = [];
  for (const id of delivery.messageIds) {
    const message = decode<CompanionMessage>(
      writer.db.prepare('SELECT body FROM messages WHERE id=?').get(id),
    );
    if (
      message.role !== 'assistant' ||
      !message.audience ||
      !message.origins ||
      companionAudienceKey(message.audience) !== companionAudienceKey(delivery.audience)
    )
      fail();
    if (
      message.origins.some(
        (origin) =>
          !delivery.origins.some((candidate) => fingerprint(candidate) === fingerprint(origin)),
      )
    )
      fail();
    messages.push(message);
  }
  const origins = new Set(messages.flatMap((message) => (message.origins ?? []).map(fingerprint)));
  if (
    origins.size !== delivery.origins.length ||
    delivery.origins.some(
      (origin) =>
        !origins.has(fingerprint(origin)) || !sameCompanionReplyRoute(origin.route, delivery.route),
    )
  )
    fail();
  const mandatory = delivery.parts.filter((part) => part.requirement === 'mandatory-text');
  const inline = messages.every(
    (message) => !message.content || message.content.kind === 'inline-text',
  );
  const semanticText = messages.map((message) => message.text).join(QQ_REPLY_TEXT_SEPARATOR);
  if (delivery.textRepresentation === 'inline') {
    if (
      !inline ||
      mandatory
        .map((part) => (part.content.kind === 'inline-text' ? part.content.text : ''))
        .join('') !== semanticText
    )
      fail();
  } else {
    const document = mandatory.find((part) => part.content.kind === 'material')?.content;
    if (!document || document.kind !== 'material') fail();
    if (
      inline &&
      (document.material.sha256 !== createHash('sha256').update(semanticText).digest('hex') ||
        document.material.sizeBytes !== Buffer.byteLength(semanticText))
    )
      fail();
    const only = messages.length === 1 ? messages[0]?.content : undefined;
    if (
      only?.kind === 'text-document' &&
      (only.material.sha256 !== document.material.sha256 ||
        only.material.sizeBytes !== document.material.sizeBytes)
    )
      fail();
  }
  if (
    delivery.parts.filter((part) => part.requirement !== 'optional-voice').length >
      delivery.allowedMessageParts &&
    delivery.phase !== 'blocked'
  )
    fail();
  for (let index = 0; index < mandatory.length - 1; index++) {
    const first = mandatory[index]?.content,
      second = mandatory[index + 1]?.content;
    if (
      first?.kind === 'inline-text' &&
      second?.kind === 'inline-text' &&
      first.text.endsWith('\r') &&
      second.text.startsWith('\n')
    )
      fail();
  }
  for (const part of delivery.parts) {
    if (part.content.kind === 'inline-text') {
      if (createHash('sha256').update(part.content.text).digest('hex') !== part.content.sha256)
        fail();
      continue;
    }
    const reference = part.content.material;
    if (!reference) continue;
    const stored = getMaterial(writer.db, { id: reference.id, scope: { kind: 'management' } });
    if (
      (requireReady && stored.phase !== 'ready') ||
      fingerprint(stored.reference) !== fingerprint(reference) ||
      companionAudienceKey(reference.audience) !== companionAudienceKey(delivery.audience)
    )
      fail();
  }
}

export function getDelivery(
  db: DatabaseSync,
  input: StateMethodInputs['getDelivery'],
): QQDeliveryView {
  const delivery = decode<QQDeliveryView>(
    db.prepare('SELECT body FROM qq_deliveries WHERE id=?').get(input.id),
  );
  assertVisible(delivery.audience, input.scope);
  return delivery;
}
export function createDelivery(
  writer: RecordWriter,
  input: StateMethodInputs['createDelivery'],
): QQDeliveryView {
  const delivery = input.delivery,
    digest = fingerprint(delivery);
  const row = writer.db
    .prepare('SELECT body,fingerprint FROM qq_deliveries WHERE id=?')
    .get(delivery.id);
  if (row) {
    if (row['fingerprint'] !== digest) fail();
    return decode<QQDeliveryView>(row);
  }
  if (
    !['prepared', 'blocked'].includes(delivery.phase) ||
    delivery.parts.some((part) => part.upload || part.send) ||
    (delivery.phase === 'prepared' && delivery.outcome !== 'pending')
  )
    fail();
  validateContents(writer, delivery);
  writer.db
    .prepare(
      'INSERT INTO qq_deliveries(id,audience_key,principal_id,phase,fingerprint,body) VALUES(?,?,?,?,?,?)',
    )
    .run(
      delivery.id,
      companionAudienceKey(delivery.audience),
      delivery.origins[0]?.principalId ?? null,
      delivery.phase,
      digest,
      JSON.stringify(delivery),
    );
  writer.event(
    'runtime',
    { deliveryId: delivery.id, deliveryPhase: delivery.phase, outcome: delivery.outcome },
    delivery.updatedAt,
    delivery.audience,
  );
  return delivery;
}

function saveDelivery(writer: RecordWriter, delivery: QQDeliveryView): QQDeliveryView {
  writer.db
    .prepare('UPDATE qq_deliveries SET phase=?,body=? WHERE id=?')
    .run(delivery.phase, JSON.stringify(delivery), delivery.id);
  writer.event(
    'runtime',
    { deliveryId: delivery.id, deliveryPhase: delivery.phase, outcome: delivery.outcome },
    delivery.updatedAt,
    delivery.audience,
  );
  return delivery;
}
function transition(
  writer: RecordWriter,
  next: QQDeliveryView,
  claim = false,
  allocatingSequences = false,
): QQDeliveryView {
  const current = getDelivery(writer.db, { id: next.id, scope: { kind: 'management' } });
  if (fingerprint(current) === fingerprint({ ...next, updatedAt: current.updatedAt }))
    return current;
  if (
    allocatingSequences &&
    (!claim ||
      current.mode !== 'official-passive' ||
      current.parts.some((part) => part.upload || part.send))
  )
    fail();
  if (
    fingerprint(frozen(current, allocatingSequences)) !==
      fingerprint(frozen(next, allocatingSequences)) ||
    next.updatedAt < current.updatedAt
  )
    fail();
  const ranks = { prepared: 0, sending: 1, blocked: 2, terminal: 2 };
  if (
    ranks[next.phase] < ranks[current.phase] ||
    (ranks[current.phase] === 2 &&
      (next.phase !== current.phase || next.outcome !== current.outcome))
  )
    fail();
  for (let index = 0; index < current.parts.length; index++) {
    const old = current.parts[index],
      part = next.parts[index];
    if (!old || !part) fail();
    if (old.preparation !== 'pending' && old.preparation !== part.preparation) fail();
    if (
      old.requirement === 'optional-voice' &&
      old.preparation === 'pending' &&
      part.preparation === 'ready' &&
      current.parts.some((previous) => previous.requirement === 'mandatory-text' && !sent(previous))
    )
      fail();
    if (
      old.content.kind === 'voice' &&
      old.content.material &&
      fingerprint(old.content) !== fingerprint(part.content)
    )
      fail();
    if (
      old.preparation === 'pending' &&
      part.preparation === 'ready' &&
      part.content.kind === 'voice' &&
      part.content.material &&
      getMaterial(writer.db, { id: part.content.material.id, scope: { kind: 'management' } })
        .phase !== 'ready'
    )
      fail();
    validateAttempt(old.upload, part.upload, claim);
    validateAttempt(old.send, part.send, claim);
    if (part.send && part.upload?.operation === 'upload-and-send') fail();
    if (part.send?.operation !== undefined && part.send.operation !== 'send') fail();
    if (part.upload?.operation === 'send') fail();
  }
  if (!isQQDeliveryView(next)) throw new StateFailure('invalid-input');
  // Settled receipts remain recordable after local bytes were cleaned up; metadata is retained.
  validateContents(writer, next, false);
  return saveDelivery(writer, next);
}
export function updateDelivery(
  writer: RecordWriter,
  input: StateMethodInputs['updateDelivery'],
): QQDeliveryView {
  return transition(writer, input.delivery);
}

/** The native passive allowance belongs to the reply reference, not a delivery batch. */
function officialPassiveFacts(
  db: DatabaseSync,
  route: QQReplyRoute,
): {
  now: number;
  cap: number;
  used: number;
  reserved: number;
  lastSeq: number;
  expiresAt: number | null;
} {
  const now = scalar(
    db.prepare("SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now").get(),
    'now',
  );
  const { account, scene, targetId, reference } = route;
  if (account.protocol !== 'official') throw new StateFailure('invalid-input');
  if (!reference || (reference.messageId === null && reference.eventId === null))
    throw new StateFailure('not-ready');
  // Mirrors official wire choice: msg_id first; event_id only when no message ID exists.
  // Display/occurrence metadata cannot mint another allowance for the same native reference.
  const nativeMatch =
    reference.messageId !== null
      ? "json_extract(d.body,'$.route.reference.messageId')=?"
      : "json_extract(d.body,'$.route.reference.messageId') IS NULL AND json_extract(d.body,'$.route.reference.eventId')=?";
  const totals = db
    .prepare(
      `WITH matching AS (
    SELECT d.body, EXISTS(SELECT 1 FROM json_each(d.body,'$.parts') prior
      WHERE json_type(prior.value,'$.send')='object' OR json_type(prior.value,'$.upload')='object') AS frozen
    FROM qq_deliveries d WHERE json_extract(d.body,'$.mode')='official-passive'
    AND json_extract(d.body,'$.route.account.protocol')=?
    AND json_extract(d.body,'$.route.account.sourcePluginId')=?
    AND json_extract(d.body,'$.route.account.instanceId')=?
    AND json_extract(d.body,'$.route.account.accountId')=?
    AND json_extract(d.body,'$.route.scene')=?
    AND json_extract(d.body,'$.route.targetId')=? AND ${nativeMatch}
  ) SELECT COALESCE(SUM(
      CASE WHEN json_extract(part.value,'$.send.operation')='send' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(part.value,'$.upload.operation')='upload-and-send' THEN 1 ELSE 0 END),0) AS used,
    COALESCE(SUM(CASE WHEN d.frozen AND json_type(part.value,'$.msgSeq')='integer' THEN 1 ELSE 0 END),0) AS reserved,
    COALESCE(MAX(CASE WHEN d.frozen THEN json_extract(part.value,'$.msgSeq') ELSE 0 END),0) AS last_seq,
    MIN(json_extract(d.body,'$.route.reference.occurredAt')) AS occurred_at,
    COALESCE(SUM(CASE WHEN (json_extract(part.value,'$.send.operation')='send' OR json_extract(part.value,'$.upload.operation')='upload-and-send') AND json_extract(part.value,'$.msgSeq') IS NULL THEN 1 ELSE 0 END),0) AS unsequenced
    FROM matching d, json_each(d.body,'$.parts') part`,
    )
    .get(
      account.protocol,
      account.sourcePluginId,
      account.instanceId,
      account.accountId,
      scene,
      targetId,
      reference.messageId ?? reference.eventId,
    );
  const cap =
    scene === 'private' ? QQ_OFFICIAL_C2C_PASSIVE_MAX_PARTS : QQ_OFFICIAL_GROUP_PASSIVE_MAX_PARTS;
  if (scalar(totals, 'unsequenced') > 0) throw new StateFailure('conflict');
  const recordedTime = totals?.['occurred_at'];
  const occurredAt =
    typeof recordedTime === 'number'
      ? Math.min(recordedTime, reference.occurredAt ?? recordedTime)
      : reference.occurredAt;
  const expiresAt = occurredAt === null ? null : occurredAt + QQ_OFFICIAL_PASSIVE_WINDOW_MS;
  if (expiresAt !== null && !Number.isSafeInteger(expiresAt))
    throw new StateFailure('invalid-input');
  return {
    now,
    cap,
    used: scalar(totals, 'used'),
    reserved: scalar(totals, 'reserved'),
    lastSeq: scalar(totals, 'last_seq'),
    expiresAt,
  };
}

export function passiveReplyBudget(
  db: DatabaseSync,
  input: StateMethodInputs['passiveReplyBudget'],
): StateMethodOutputs['passiveReplyBudget'] {
  const facts = officialPassiveFacts(db, input.route);
  const nextMsgSeq = facts.lastSeq + 1;
  if (!Number.isSafeInteger(nextMsgSeq)) throw new StateFailure('quota-exceeded');
  const remainingMessageParts = Math.max(0, facts.cap - facts.reserved);
  return {
    remainingMessageParts,
    nextMsgSeq,
    eligible: remainingMessageParts > 0 && facts.expiresAt !== null && facts.expiresAt > facts.now,
    expiresAt: facts.expiresAt,
  };
}

function prepareOfficialPassiveClaim(
  db: DatabaseSync,
  delivery: QQDeliveryView,
  operation: QQDeliveryAttempt['operation'],
): { now: number; delivery: QQDeliveryView; allocated: boolean } {
  const facts = officialPassiveFacts(db, delivery.route);
  if (
    facts.expiresAt === null ||
    facts.expiresAt <= facts.now ||
    delivery.eligibilityExpiresAt === null ||
    delivery.eligibilityExpiresAt <= facts.now
  )
    throw new StateFailure('not-ready');
  if (operation !== 'upload' && facts.used >= facts.cap) throw new StateFailure('quota-exceeded');
  const allocated = delivery.parts.every((part) => !part.send && !part.upload);
  if (!allocated) return { now: facts.now, delivery, allocated: false };
  const sends = delivery.parts.filter(
    (part) =>
      part.requirement !== 'optional-voice' || ['pending', 'ready'].includes(part.preparation),
  );
  if (sends.length > facts.cap - facts.reserved || sends.length > delivery.allowedMessageParts)
    throw new StateFailure('quota-exceeded');
  let sequence = facts.lastSeq;
  if (!Number.isSafeInteger(sequence + sends.length)) throw new StateFailure('quota-exceeded');
  const parts = delivery.parts.map((part) => ({
    ...part,
    msgSeq: sends.includes(part) ? ++sequence : null,
  }));
  return { now: facts.now, delivery: { ...delivery, parts }, allocated: true };
}

export function claimDeliveryAttempt(
  writer: RecordWriter,
  input: StateMethodInputs['claimDeliveryAttempt'],
): StateMethodOutputs['claimDeliveryAttempt'] {
  const current = getDelivery(writer.db, { id: input.id, scope: { kind: 'management' } });
  const part = current.parts.find((part) => part.id === input.partId);
  if (!part) throw new StateFailure('unavailable');
  const slot = input.attempt.operation === 'send' ? 'send' : 'upload';
  const known = part[slot];
  if (known) {
    if (
      known.id !== input.attempt.id ||
      known.operation !== input.attempt.operation ||
      known.startedAt !== input.attempt.startedAt ||
      (input.attempt.correlationId !== null && known.correlationId !== input.attempt.correlationId)
    )
      fail();
    return { delivery: current, claimed: false };
  }
  if (
    !['prepared', 'sending'].includes(current.phase) ||
    current.outcome !== 'pending' ||
    part.preparation !== 'ready'
  )
    fail();
  const passive =
    current.mode === 'official-passive'
      ? prepareOfficialPassiveClaim(writer.db, current, input.attempt.operation)
      : null;
  const now = passive?.now ?? Date.now();
  const plan = passive?.delivery ?? current;
  if (
    current.mode === 'official-passive' &&
    input.attempt.operation !== 'upload' &&
    plan.parts.find((candidate) => candidate.id === part.id)?.msgSeq == null
  )
    fail();
  if (current.parts.slice(0, part.index).some((previous) => !sent(previous))) fail();
  if (
    slot === 'send' &&
    part.upload &&
    (part.upload.operation !== 'upload' ||
      part.upload.outcome !== 'accepted' ||
      part.upload.cleanup !== 'settled')
  )
    fail();
  if (slot === 'upload' && part.send) fail();
  if (slot === 'upload' && part.content.kind === 'inline-text') fail();
  if (
    part.content.kind !== 'inline-text' &&
    part.content.material &&
    (slot === 'upload' || !part.upload)
  ) {
    const material = getMaterial(writer.db, {
      id: part.content.material.id,
      scope: { kind: 'management' },
    });
    if (material.phase !== 'ready') throw new StateFailure('not-ready');
  }
  const attempts = current.parts.filter(
    (part) => part.send || part.upload?.operation === 'upload-and-send',
  ).length;
  if (input.attempt.operation !== 'upload' && attempts >= current.allowedMessageParts)
    throw new StateFailure('quota-exceeded');
  const next: QQDeliveryView = {
    ...plan,
    phase: 'sending',
    updatedAt: Math.max(now, current.updatedAt),
    parts: plan.parts.map((candidate) =>
      candidate.id === part.id ? { ...candidate, [slot]: input.attempt } : candidate,
    ),
  };
  return { delivery: transition(writer, next, true, passive?.allocated ?? false), claimed: true };
}

export function deliveries(
  db: DatabaseSync,
  input: StateMethodInputs['deliveries'],
): StateMethodOutputs['deliveries'] {
  const selected = scopeWhere(input.scope, 'other');
  const after = input.after
    ? scalar(
        db.prepare('SELECT sequence FROM qq_deliveries WHERE id=?').get(input.after),
        'sequence',
      )
    : 0;
  const limit = input.limit ?? QQ_PAGE_MAX_ITEMS;
  const rows = db
    .prepare(
      `SELECT body FROM qq_deliveries WHERE sequence>? AND ${selected.sql} ORDER BY sequence LIMIT ?`,
    )
    .all(after, ...selected.params, limit + 1);
  const views: StateMethodOutputs['deliveries']['deliveries'][number][] = [];
  for (const row of rows.slice(0, limit)) {
    const { id, messageIds, audience, route, phase, outcome, createdAt, updatedAt } =
      decode<QQDeliveryView>(row);
    const item = { id, messageIds, audience, route, phase, outcome, createdAt, updatedAt };
    if (jsonBytes([...views, item]) > STATE_MAX_RESULT_BYTES - 1024) break;
    views.push(item);
  }
  return {
    deliveries: views,
    next: rows.length > views.length ? (views.at(-1)?.id ?? null) : null,
  };
}

export function recoverDeliveries(
  writer: RecordWriter,
  limit: number,
): { ids: string[]; hasMore: boolean } {
  const rows = writer.db
    .prepare(
      "SELECT body FROM qq_deliveries WHERE phase IN ('prepared','sending') ORDER BY sequence LIMIT ?",
    )
    .all(limit);
  const ids: string[] = [];
  for (const row of rows) {
    const current = decode<QQDeliveryView>(row);
    let unknown = current.parts.some(
      (part) => part.upload?.outcome === 'unknown' || part.send?.outcome === 'unknown',
    );
    const now = Date.now();
    const recovered = (attempt: QQDeliveryAttempt | null): QQDeliveryAttempt | null => {
      if (!attempt || attempt.phase === 'settled') return attempt;
      unknown = true;
      return {
        ...attempt,
        phase: 'settled',
        outcome: 'unknown',
        cleanup: 'unknown',
        settledAt: now,
        error: makeError('unavailable', false),
      };
    };
    const parts = current.parts.map((part) => ({
      ...part,
      upload: recovered(part.upload),
      send: recovered(part.send),
      preparation: part.preparation === 'pending' ? ('cancelled' as const) : part.preparation,
    }));
    const next: QQDeliveryView = {
      ...current,
      parts,
      phase: 'terminal',
      outcome: unknown
        ? 'unknown'
        : parts.every(sent)
          ? 'accepted'
          : parts.some(sent)
            ? 'partial'
            : 'cancelled',
      updatedAt: now,
      error: unknown ? makeError('unavailable', false) : current.error,
    };
    saveDelivery(writer, next);
    ids.push(current.id);
  }
  const hasMore = !!writer.db
    .prepare("SELECT id FROM qq_deliveries WHERE phase IN ('prepared','sending') LIMIT 1")
    .get();
  return { ids, hasMore };
}
