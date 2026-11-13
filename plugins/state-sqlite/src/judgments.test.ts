import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import {
  makeError,
  QQ_JUDGE_MAX_ATTEMPTS_HOUR,
  QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
  QQ_JUDGE_PROVIDER_REF,
  QQ_PROACTIVE_DEFAULT_COOLDOWN_MS,
} from '@pet/contracts';
import type { CompanionInputOrigin, Result } from '@pet/contracts';
import { SqliteState } from './state.js';
import type { ClaimJudgmentRequest, CreateInputRequest, StateGroupAudience } from './types.js';

const roots: string[] = [],
  stores: SqliteState[] = [];
function open(directory?: string): { state: SqliteState; directory: string } {
  const root = directory ?? mkdtempSync(join(tmpdir(), 'pet-judgment-test-'));
  if (!directory) roots.push(root);
  const state = new SqliteState({ dataDirectory: root });
  stores.push(state);
  return { state, directory: root };
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function audience(groupId: string): StateGroupAudience {
  return {
    kind: 'qq-group',
    account: {
      protocol: 'official',
      sourcePluginId: 'pet.qq-official',
      instanceId: 'default',
      accountId: 'account',
    },
    groupId,
  };
}
function request(id: string, groupId = 'group'): ClaimJudgmentRequest {
  return {
    id,
    eventKey: `event-${id}`,
    audience: audience(groupId),
    providerRef: QQ_JUDGE_PROVIDER_REF,
    policyRevision: 1,
    configRevision: 1,
  };
}
function failed(id: string) {
  return {
    id,
    decision: null,
    inputTokens: null,
    outputTokens: null,
    error: makeError('unavailable'),
    cleanup: 'settled' as const,
  };
}
function proactive(id: string, groupId = 'group'): CreateInputRequest {
  const group = audience(groupId);
  const origin: CompanionInputOrigin = {
    kind: 'qq-proactive',
    inputId: id,
    principalId: null,
    audience: group,
    account: group.account,
    eventKey: `event-${id}`,
    policyRevision: 1,
    route: {
      kind: 'qq',
      account: group.account,
      scene: 'group',
      targetId: groupId,
      reference: {
        eventId: null,
        messageId: `native-${id}`,
        occurredAt: null,
        displayReference: null,
      },
    },
  };
  return {
    id,
    commandId: `command-${id}`,
    origin,
    evidence: { text: 'proactive evidence' },
    materialIds: [],
  };
}
function sql(directory: string, operation: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(join(directory, 'state.sqlite'));
  try {
    operation(db);
  } finally {
    db.close();
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const state of stores.splice(0)) state.close();
  for (const directory of roots.splice(0)) {
    const target = realpathSync(directory);
    if (
      dirname(target) !== realpathSync(tmpdir()) ||
      !basename(target).startsWith('pet-judgment-test-')
    )
      throw new Error('unexpected fixture directory');
    rmSync(target, { recursive: true });
  }
});

it('reserves one durable attempt per native event and preserves exact request conflicts and real usage', () => {
  const { state } = open();
  const input = request('first');
  const first = value(state.claimJudgment(input));
  expect(first).toMatchObject({
    claimed: true,
    attempt: {
      limits: {
        maxAttemptsPerHour: QQ_JUDGE_MAX_ATTEMPTS_HOUR,
        perGroupIntervalMs: QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
      },
      phase: 'claimed',
    },
  });
  expect(value(state.claimJudgment(input))).toEqual({
    claimed: false,
    attempt: first.attempt,
    reason: 'duplicate',
  });
  expect(value(state.claimJudgment({ ...input, id: 'another-id', configRevision: 2 }))).toEqual({
    claimed: false,
    attempt: first.attempt,
    reason: 'duplicate',
  });
  expect(state.claimJudgment({ ...input, policyRevision: 2 })).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(value(state.claimJudgment(request('parallel', 'another-group')))).toEqual({
    claimed: false,
    attempt: null,
    reason: 'busy',
  });
  const completed = {
    id: input.id,
    decision: false,
    inputTokens: 17,
    outputTokens: 3,
    error: null,
    cleanup: 'settled' as const,
  };
  const finish = value(state.finishJudgment(completed));
  const cursor = value(state.snapshot({ scope: { kind: 'management' } })).cursor;
  expect(value(state.finishJudgment(completed))).toEqual(finish);
  expect(value(state.snapshot({ scope: { kind: 'management' } })).cursor).toBe(cursor);
  expect(state.finishJudgment({ ...completed, decision: true })).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(value(state.judgmentUsage())).toMatchObject({
    admittedAttempts: 1,
    active: 0,
    settled: 1,
    unknown: 0,
    inputTokens: 17,
    outputTokens: 3,
  });
  expect(value(state.judgmentUsage({ audience: audience('absent') }))).toMatchObject({
    admittedAttempts: 0,
    inputTokens: null,
    outputTokens: null,
  });
  expect(
    state.invoke('claimJudgment', { ...request('bad'), audience: { kind: 'owner-private' } }).ok,
  ).toBe(false);
  expect(
    state.invoke('finishJudgment', { ...completed, prompt: 'forbidden stored prompt' }).ok,
  ).toBe(false);
});

it('uses the SQLite clock for group cooldown and retains failed budget across restart/config changes', () => {
  const initial = open();
  const first = value(initial.state.claimJudgment(request('first'))).attempt;
  if (!first) throw new Error('missing claimed attempt');
  value(initial.state.finishJudgment(failed(first.id)));
  initial.state.close();
  const { state } = open(initial.directory);
  const actualNow = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(actualNow + 2 * 60 * 60 * 1000);
  expect(
    value(state.claimJudgment({ ...request('next'), policyRevision: 2, configRevision: 2 })),
  ).toEqual({ claimed: false, attempt: null, reason: 'group-cooldown' });
  const second = value(state.claimJudgment(request('second', 'second-group')));
  expect(second.claimed).toBe(true);
  expect(second.attempt?.claimedAt).toBeLessThan(actualNow + 5000);
  const usage = value(state.judgmentUsage());
  expect(usage).toMatchObject({
    admittedAttempts: 2,
    active: 1,
    settled: 1,
    inputTokens: null,
    outputTokens: null,
  });
  expect(usage.now).toBeLessThan(actualNow + 5000);
  expect(value(state.claimJudgment(request('first'))).reason).toBe('duplicate');
});

it('enforces the shared global hourly ceiling even for failed attempts and different providers/groups', () => {
  const { state } = open();
  for (let index = 0; index < QQ_JUDGE_MAX_ATTEMPTS_HOUR; index++) {
    const input = request(`attempt-${index}`, `group-${index}`);
    expect(value(state.claimJudgment(input)).claimed).toBe(true);
    value(state.finishJudgment(failed(input.id)));
  }
  expect(value(state.judgmentUsage())).toMatchObject({
    admittedAttempts: QQ_JUDGE_MAX_ATTEMPTS_HOUR,
    active: 0,
    settled: QQ_JUDGE_MAX_ATTEMPTS_HOUR,
    inputTokens: null,
    outputTokens: null,
  });
  expect(
    value(
      state.claimJudgment({
        ...request('overflow', 'new-group'),
        providerRef: 'pet.other-judge/model',
        configRevision: 99,
      }),
    ),
  ).toEqual({ claimed: false, attempt: null, reason: 'hourly-limit' });
  expect(
    state.claimJudgment({
      ...request('invalid'),
      limits: {
        maxAttemptsPerHour: QQ_JUDGE_MAX_ATTEMPTS_HOUR + 1,
        perGroupIntervalMs: QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
      },
    }).ok,
  ).toBe(false);
  expect(value(state.claimJudgment(request('attempt-0', 'group-0'))).reason).toBe('duplicate');
});

it('expires old attempt charges from the rolling hour without allowing the old event to run again', () => {
  const initial = open();
  const input = {
    ...request('first'),
    limits: { maxAttemptsPerHour: 1, perGroupIntervalMs: QQ_JUDGE_MIN_GROUP_INTERVAL_MS },
  };
  const claimed = value(initial.state.claimJudgment(input)).attempt;
  if (!claimed) throw new Error('missing attempt');
  value(initial.state.finishJudgment(failed(input.id)));
  expect(
    value(initial.state.claimJudgment({ ...input, id: 'second', eventKey: 'event-second' })).reason,
  ).toBe('hourly-limit');
  initial.state.close();
  sql(initial.directory, (db) => {
    const old = claimed.claimedAt - 60 * 60 * 1000 - 1000;
    db.prepare(
      "UPDATE qq_judgments SET claimed_at=?,body=json_set(body,'$.claimedAt',?) WHERE id=?",
    ).run(old, old, input.id);
  });
  const { state } = open(initial.directory);
  expect(value(state.judgmentUsage()).admittedAttempts).toBe(0);
  expect(value(state.claimJudgment(input)).reason).toBe('duplicate');
  expect(
    value(state.claimJudgment({ ...input, id: 'second', eventKey: 'event-second' })).claimed,
  ).toBe(true);
});

it('recovers claimed intent to unknown without replay, refund, or false zero usage', () => {
  const initial = open();
  const input = request('crashed');
  value(initial.state.claimJudgment(input));
  value(initial.state.acceptMessage({ commandId: 'owner', text: 'ordinary owner input' }));
  initial.state.close();
  const { state } = open(initial.directory);
  const first = value(state.recover({ limit: 1 }));
  expect(first.judgmentIds).toEqual([]);
  expect(first.hasMore).toBe(true);
  const recovered = value(state.recover({ limit: 1 }));
  expect(recovered.judgmentIds).toEqual([input.id]);
  expect(recovered.hasMore).toBe(false);
  expect(value(state.claimJudgment(input))).toMatchObject({
    claimed: false,
    reason: 'duplicate',
    attempt: { phase: 'unknown', cleanup: 'unknown', decision: null },
  });
  expect(value(state.judgmentUsage())).toMatchObject({
    admittedAttempts: 1,
    active: 0,
    unknown: 1,
    inputTokens: null,
    outputTokens: null,
  });
  expect(
    state.finishJudgment({
      id: input.id,
      decision: true,
      inputTokens: 3,
      outputTokens: 1,
      error: null,
      cleanup: 'settled',
    }).ok,
  ).toBe(false);
  expect(value(state.claimJudgment(request('new-event'))).reason).toBe('group-cooldown');
  expect(value(state.claimJudgment(request('new-group-event', 'other-group'))).claimed).toBe(true);
});

it('rolls judgment claim and finish back together with their durable event on persistence failure', () => {
  const initial = open();
  initial.state.close();
  const trigger =
    "CREATE TRIGGER fail_judgment BEFORE INSERT ON events WHEN json_extract(NEW.body,'$.data.judgmentId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;";
  sql(initial.directory, (db) => db.exec(trigger));
  const state = open(initial.directory).state;
  const input = request('atomic');
  expect(state.claimJudgment(input)).toMatchObject({ ok: false, error: { code: 'internal' } });
  expect(value(state.judgmentUsage()).admittedAttempts).toBe(0);
  expect(value(state.snapshot({ scope: { kind: 'management' } })).cursor).toBe(0);
  state.close();
  sql(initial.directory, (db) => db.exec('DROP TRIGGER fail_judgment'));
  const retry = open(initial.directory).state;
  expect(value(retry.claimJudgment(input)).claimed).toBe(true);
  retry.close();
  sql(initial.directory, (db) => db.exec(trigger));
  const failingFinish = open(initial.directory).state;
  expect(failingFinish.finishJudgment(failed(input.id)).ok).toBe(false);
  expect(value(failingFinish.judgmentUsage())).toMatchObject({
    admittedAttempts: 1,
    active: 1,
    settled: 0,
  });
  expect(value(failingFinish.snapshot({ scope: { kind: 'management' } })).cursor).toBe(1);
});

it('durably bounds proactive admission, counts failed inputs, and preserves ordinary owner/direct flows', () => {
  const initial = open();
  const first = proactive('first');
  expect(value(initial.state.proactiveReadiness({ audience: audience('group') }))).toEqual({
    eligible: true,
    reason: 'ready',
    nextAt: null,
  });
  const admitted = value(initial.state.createInput(first));
  value(
    initial.state.updateInput({
      id: first.id,
      phase: 'failed',
      cleanup: 'settled',
      error: makeError('unavailable'),
    }),
  );
  expect(value(initial.state.createInput(first)).receipt.status).toBe('duplicate');
  initial.state.close();
  const state = open(initial.directory).state;
  const actualNow = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(actualNow + 2 * 60 * 60 * 1000);
  const before = value(state.snapshot({ scope: { kind: 'management' } }));
  expect(value(state.proactiveReadiness({ audience: audience('group') }))).toEqual({
    eligible: false,
    reason: 'group-cooldown',
    nextAt: admitted.admission.createdAt + QQ_PROACTIVE_DEFAULT_COOLDOWN_MS,
  });
  expect(value(state.snapshot({ scope: { kind: 'management' } }))).toEqual(before);
  expect(value(state.judgmentUsage()).admittedAttempts).toBe(0);
  expect(
    state.invoke('proactiveReadiness', {
      audience: audience('group'),
      now: actualNow + 2 * 60 * 60 * 1000,
    }).ok,
  ).toBe(false);
  expect(state.createInput(proactive('next'))).toMatchObject({
    ok: false,
    error: { code: 'rate-limited' },
  });
  expect(admitted.admission.createdAt).toBeLessThan(actualNow + 5000);
  expect(
    value(state.acceptMessage({ commandId: 'direct-owner', text: 'owner remains eligible' }))
      .receipt.status,
  ).toBe('accepted');
  expect(value(state.proactiveReadiness({ audience: audience('other-group') })).eligible).toBe(
    true,
  );
  expect(value(state.createInput(proactive('other', 'other-group'))).receipt.status).toBe(
    'accepted',
  );
  expect(state.createInput(proactive('raced-after-precheck', 'other-group'))).toMatchObject({
    ok: false,
    error: { code: 'rate-limited' },
  });
  expect(
    state.invoke('createInput', {
      id: 'bad-owner',
      commandId: 'bad-owner',
      origin: {
        kind: 'owner',
        inputId: 'bad-owner',
        principalId: 'owner',
        audience: { kind: 'owner-private' },
        route: { kind: 'owner-private' },
        policyRevision: null,
      },
      materialIds: [],
      evidence: {},
      proactiveLimits: { cooldownMs: 1000, maxRepliesPerHour: 1 },
    }).ok,
  ).toBe(false);
  expect(QQ_PROACTIVE_DEFAULT_COOLDOWN_MS).toBe(60_000);
});

it('reports the real reopening time when a lower policy must expire several admitted inputs', () => {
  const initial = open();
  let state = initial.state;
  const now = Date.now();
  const times = [now - 180_000, now - 120_000, now - 61_000] as const;
  for (const [index, createdAt] of times.entries()) {
    const input = proactive(`history-${index}`);
    value(state.createInput(input));
    value(state.updateInput({ id: input.id, phase: 'failed', cleanup: 'settled' }));
    state.close();
    sql(initial.directory, (db) =>
      db
        .prepare("UPDATE input_admissions SET body=json_set(body,'$.createdAt',?) WHERE id=?")
        .run(createdAt, input.id),
    );
    state = open(initial.directory).state;
  }
  expect(value(state.proactiveReadiness({ audience: audience('group') }))).toEqual({
    eligible: true,
    reason: 'ready',
    nextAt: null,
  });
  expect(
    value(
      state.proactiveReadiness({
        audience: audience('group'),
        limits: { cooldownMs: 1000, maxRepliesPerHour: 2 },
      }),
    ),
  ).toEqual({ eligible: false, reason: 'hourly-limit', nextAt: times[1] + 60 * 60 * 1000 + 1 });
  expect(
    value(
      state.proactiveReadiness({
        audience: audience('group'),
        limits: { cooldownMs: 24 * 60 * 60 * 1000, maxRepliesPerHour: 2 },
      }),
    ),
  ).toEqual({ eligible: false, reason: 'group-cooldown', nextAt: times[2] + 24 * 60 * 60 * 1000 });
  expect(value(state.judgmentUsage()).admittedAttempts).toBe(0);
});

it('applies configured proactive hourly quotas from all admitted phases without adding another queue', () => {
  const initial = open();
  const limits = { cooldownMs: 1000, maxRepliesPerHour: 1 };
  const first = { ...proactive('first'), proactiveLimits: limits };
  const admitted = value(initial.state.createInput(first)).admission;
  value(initial.state.updateInput({ id: first.id, phase: 'cancelled', cleanup: 'settled' }));
  initial.state.close();
  sql(initial.directory, (db) =>
    db
      .prepare("UPDATE input_admissions SET body=json_set(body,'$.createdAt',?) WHERE id=?")
      .run(admitted.createdAt - 2000, first.id),
  );
  const state = open(initial.directory).state;
  expect(value(state.proactiveReadiness({ audience: audience('group'), limits }))).toEqual({
    eligible: false,
    reason: 'hourly-limit',
    nextAt: admitted.createdAt - 2000 + 60 * 60 * 1000 + 1,
  });
  expect(value(state.judgmentUsage()).admittedAttempts).toBe(0);
  expect(state.createInput({ ...proactive('second'), proactiveLimits: limits })).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  expect(value(state.createInput(first)).receipt.status).toBe('duplicate');
  expect(value(state.snapshot({ scope: { kind: 'management' } })).messages).toEqual([]);
  state.close();
  sql(initial.directory, (db) =>
    db
      .prepare("UPDATE input_admissions SET body=json_set(body,'$.createdAt',?) WHERE id=?")
      .run(admitted.createdAt - 60 * 60 * 1000 - 1000, first.id),
  );
  expect(
    value(
      open(initial.directory).state.createInput({
        ...proactive('second'),
        proactiveLimits: limits,
      }),
    ).receipt.status,
  ).toBe('accepted');
});
