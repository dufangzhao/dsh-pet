import type { DatabaseSync } from 'node:sqlite';
import {
  companionAudienceKey,
  makeError,
  QQ_JUDGE_MAX_ATTEMPTS_HOUR,
  QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
  QQ_JUDGE_MAX_CONCURRENT,
  QQ_PROACTIVE_DEFAULT_COOLDOWN_MS,
  QQ_PROACTIVE_DEFAULT_REPLIES_HOUR,
} from '@pet/contracts';
import type {
  StateJudgmentAttempt,
  StateMethodInputs,
  StateMethodOutputs,
  StateGroupAudience,
  StateProactiveLimits,
} from './types.js';
import type { RecordWriter } from './records.js';
import { decode, fingerprint, scalar } from './records.js';
import { assertCleanup } from './scope.js';
import { StateFailure } from './failure.js';

const HOUR_MS = 60 * 60 * 1000;

/** Admission time comes from SQLite, never a caller timestamp or a process-local budget. */
function clock(db: DatabaseSync): number {
  return scalar(
    db.prepare("SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now").get(),
    'now',
  );
}

export function claimJudgment(
  writer: RecordWriter,
  input: StateMethodInputs['claimJudgment'],
): StateMethodOutputs['claimJudgment'] {
  const request = {
    ...input,
    limits: input.limits ?? {
      maxAttemptsPerHour: QQ_JUDGE_MAX_ATTEMPTS_HOUR,
      perGroupIntervalMs: QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
    },
  };
  const digest = fingerprint(request);
  const known = writer.db
    .prepare('SELECT body,fingerprint FROM qq_judgments WHERE id=?')
    .get(input.id);
  if (known) {
    if (known['fingerprint'] !== digest) throw new StateFailure('conflict');
    return { claimed: false, attempt: decode<StateJudgmentAttempt>(known), reason: 'duplicate' };
  }
  const audience = companionAudienceKey(input.audience);
  const event = writer.db
    .prepare('SELECT body FROM qq_judgments WHERE audience_key=? AND event_key=?')
    .get(audience, input.eventKey);
  if (event)
    return { claimed: false, attempt: decode<StateJudgmentAttempt>(event), reason: 'duplicate' };
  const now = clock(writer.db);
  const count = scalar(
    writer.db
      .prepare('SELECT COUNT(*) AS count FROM qq_judgments WHERE claimed_at>=?')
      .get(now - HOUR_MS),
    'count',
  );
  if (count >= request.limits.maxAttemptsPerHour)
    return { claimed: false, attempt: null, reason: 'hourly-limit' };
  const last = writer.db
    .prepare('SELECT MAX(claimed_at) AS last FROM qq_judgments WHERE audience_key=?')
    .get(audience)?.['last'];
  if (typeof last === 'number' && now - last < request.limits.perGroupIntervalMs)
    return { claimed: false, attempt: null, reason: 'group-cooldown' };
  const active = scalar(
    writer.db.prepare("SELECT COUNT(*) AS count FROM qq_judgments WHERE phase='claimed'").get(),
    'count',
  );
  if (active >= QQ_JUDGE_MAX_CONCURRENT) return { claimed: false, attempt: null, reason: 'busy' };
  const attempt: StateJudgmentAttempt = {
    ...request,
    phase: 'claimed',
    decision: null,
    inputTokens: null,
    outputTokens: null,
    error: null,
    cleanup: 'pending',
    claimedAt: now,
    settledAt: null,
  };
  writer.db
    .prepare(
      'INSERT INTO qq_judgments(id,event_key,audience_key,claimed_at,phase,fingerprint,body) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      attempt.id,
      attempt.eventKey,
      audience,
      now,
      attempt.phase,
      digest,
      JSON.stringify(attempt),
    );
  writer.event(
    'runtime',
    { judgmentId: attempt.id, judgmentPhase: attempt.phase },
    now,
    attempt.audience,
    null,
  );
  return { claimed: true, attempt };
}

export function finishJudgment(
  writer: RecordWriter,
  input: StateMethodInputs['finishJudgment'],
): StateJudgmentAttempt {
  const current = decode<StateJudgmentAttempt>(
    writer.db.prepare('SELECT body FROM qq_judgments WHERE id=?').get(input.id),
  );
  assertCleanup(current.cleanup, input.cleanup);
  if (current.phase !== 'claimed') {
    const unchanged =
      current.decision === input.decision &&
      current.inputTokens === input.inputTokens &&
      current.outputTokens === input.outputTokens &&
      fingerprint(current.error) === fingerprint(input.error);
    if (!unchanged) throw new StateFailure('conflict');
    if (current.cleanup === input.cleanup) return current;
    const cleaned = { ...current, cleanup: input.cleanup };
    save(writer, cleaned);
    return cleaned;
  }
  const next: StateJudgmentAttempt = {
    ...current,
    ...input,
    phase: 'settled',
    settledAt: clock(writer.db),
  };
  save(writer, next);
  return next;
}

function save(writer: RecordWriter, attempt: StateJudgmentAttempt): void {
  writer.db
    .prepare('UPDATE qq_judgments SET phase=?,body=? WHERE id=?')
    .run(attempt.phase, JSON.stringify(attempt), attempt.id);
  writer.event(
    'runtime',
    { judgmentId: attempt.id, judgmentPhase: attempt.phase, cleanup: attempt.cleanup },
    clock(writer.db),
    attempt.audience,
    null,
  );
}

export function judgmentUsage(
  db: DatabaseSync,
  input: StateMethodInputs['judgmentUsage'],
): StateMethodOutputs['judgmentUsage'] {
  const now = clock(db),
    since = input.since ?? now - HOUR_MS;
  if (since > now) throw new StateFailure('invalid-input');
  const filter = input.audience ? ' AND audience_key=?' : '';
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
    COALESCE(SUM(phase='claimed'),0) AS active,
    COALESCE(SUM(phase='settled'),0) AS settled,
    COALESCE(SUM(phase='unknown'),0) AS unknown,
    COUNT(json_extract(body,'$.inputTokens')) AS input_known,
    COUNT(json_extract(body,'$.outputTokens')) AS output_known,
    SUM(json_extract(body,'$.inputTokens')) AS input_tokens,
    SUM(json_extract(body,'$.outputTokens')) AS output_tokens
    FROM qq_judgments WHERE claimed_at>=?${filter}`,
    )
    .get(since, ...(input.audience ? [companionAudienceKey(input.audience)] : []));
  const count = scalar(row, 'count');
  return {
    since,
    now,
    admittedAttempts: count,
    active: scalar(row, 'active'),
    settled: scalar(row, 'settled'),
    unknown: scalar(row, 'unknown'),
    inputTokens:
      count > 0 && scalar(row, 'input_known') === count ? scalar(row, 'input_tokens') : null,
    outputTokens:
      count > 0 && scalar(row, 'output_known') === count ? scalar(row, 'output_tokens') : null,
  };
}

export function recoverJudgments(
  writer: RecordWriter,
  limit: number,
): { ids: string[]; hasMore: boolean } {
  const ids: string[] = [];
  for (const row of writer.db
    .prepare("SELECT body FROM qq_judgments WHERE phase='claimed' ORDER BY claimed_at,id LIMIT ?")
    .all(limit)) {
    const current = decode<StateJudgmentAttempt>(row);
    save(writer, {
      ...current,
      phase: 'unknown',
      cleanup: 'unknown',
      error: makeError('unavailable', false),
      settledAt: clock(writer.db),
    });
    ids.push(current.id);
  }
  return {
    ids,
    hasMore: !!writer.db.prepare("SELECT id FROM qq_judgments WHERE phase='claimed' LIMIT 1").get(),
  };
}

function proactiveBudget(
  db: DatabaseSync,
  group: StateGroupAudience,
  configured?: StateProactiveLimits,
): { now: number; readiness: StateMethodOutputs['proactiveReadiness'] } {
  const now = clock(db);
  const limits = configured ?? {
    cooldownMs: QQ_PROACTIVE_DEFAULT_COOLDOWN_MS,
    maxRepliesPerHour: QQ_PROACTIVE_DEFAULT_REPLIES_HOUR,
  };
  const audience = companionAudienceKey(group);
  const last = db
    .prepare(
      `SELECT MAX(json_extract(body,'$.createdAt')) AS last
    FROM input_admissions WHERE audience_key=? AND json_extract(body,'$.origin.kind')='qq-proactive'
    AND json_extract(body,'$.createdAt')>=?`,
    )
    .get(audience, now - Math.max(HOUR_MS, limits.cooldownMs))?.['last'];
  const cooldownAt =
    typeof last === 'number' && now - last < limits.cooldownMs ? last + limits.cooldownMs : null;
  // The Mth newest admitted input must leave the inclusive rolling hour before count < M.
  // This also handles lowering a policy below the number already admitted.
  const boundary = db
    .prepare(
      `SELECT json_extract(body,'$.createdAt') AS admitted_at
    FROM input_admissions WHERE audience_key=? AND json_extract(body,'$.origin.kind')='qq-proactive'
    AND json_extract(body,'$.createdAt')>=? ORDER BY admitted_at DESC LIMIT 1 OFFSET ?`,
    )
    .get(audience, now - HOUR_MS, limits.maxRepliesPerHour - 1)?.['admitted_at'];
  const hourlyAt = typeof boundary === 'number' ? boundary + HOUR_MS + 1 : null;
  if (cooldownAt === null && hourlyAt === null)
    return { now, readiness: { eligible: true, reason: 'ready', nextAt: null } };
  return {
    now,
    readiness: {
      eligible: false,
      reason: cooldownAt !== null ? 'group-cooldown' : 'hourly-limit',
      nextAt: Math.max(cooldownAt ?? 0, hourlyAt ?? 0),
    },
  };
}

/** A read-only hint; it never reserves a reply or judgment attempt. */
export function proactiveReadiness(
  db: DatabaseSync,
  input: StateMethodInputs['proactiveReadiness'],
): StateMethodOutputs['proactiveReadiness'] {
  return proactiveBudget(db, input.audience, input.limits).readiness;
}

/** Called only for a new proactive intent inside createInput's existing transaction. */
export function checkProactiveAdmission(
  db: DatabaseSync,
  input: StateMethodInputs['createInput'],
): number {
  if (input.origin.audience.kind !== 'qq-group') throw new StateFailure('invalid-input');
  const { now, readiness } = proactiveBudget(db, input.origin.audience, input.proactiveLimits);
  if (!readiness.eligible)
    throw new StateFailure(
      readiness.reason === 'group-cooldown' ? 'rate-limited' : 'quota-exceeded',
    );
  return now;
}
