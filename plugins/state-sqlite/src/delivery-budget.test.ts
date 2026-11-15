import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import {
  makeError,
  isQQDeliveryPartAccepted,
  QQ_OFFICIAL_C2C_PASSIVE_MAX_PARTS,
  QQ_OFFICIAL_GROUP_PASSIVE_MAX_PARTS,
  QQ_OFFICIAL_PASSIVE_WINDOW_MS,
} from '@pet/contracts';
import type {
  CompanionInputOrigin,
  CompanionMaterialRef,
  QQAccountRef,
  QQDeliveryAttempt,
  QQDeliveryPart,
  QQDeliveryView,
  QQReplyReference,
  QQReplyRoute,
  Result,
} from '@pet/contracts';
import { SqliteState } from './state.js';

type Origin = Extract<CompanionInputOrigin, { kind: 'qq' }> & { route: QQReplyRoute };
const roots: string[] = [],
  stores: SqliteState[] = [];
const management = { kind: 'management' as const };
function open(directory?: string) {
  const root = directory ?? mkdtempSync(join(tmpdir(), 'pet-passive-budget-'));
  if (!directory) roots.push(root);
  const state = new SqliteState({ dataDirectory: root });
  stores.push(state);
  return { state, directory: root };
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function register(
  state: SqliteState,
  id: string,
  options: {
    scene?: 'private' | 'group';
    account?: QQAccountRef;
    target?: string;
    reference?: QQReplyReference;
  } = {},
): Origin {
  const account = options.account ?? {
    protocol: 'official',
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default',
    accountId: 'account',
  };
  const scene = options.scene ?? 'private',
    target = options.target ?? 'target';
  const reference = options.reference ?? {
    eventId: 'native-event',
    messageId: 'native-message',
    occurredAt: Date.now(),
    displayReference: null,
  };
  const audience =
    scene === 'group'
      ? { kind: 'qq-group' as const, account, groupId: target }
      : { kind: 'person-private' as const, principalId: 'person' };
  const origin: Origin = {
    kind: 'qq',
    inputId: id,
    principalId: 'person',
    audience,
    policyRevision: 1,
    eventKey: `local-${id}`,
    messageId: reference.messageId,
    trigger: 'direct',
    quote: null,
    actor:
      scene === 'group'
        ? {
            account,
            scene,
            groupId: target,
            senderId: account.protocol === 'official' ? 'sender' : '1234',
          }
        : { account, scene, senderId: target },
    route: { kind: 'qq', account, scene, targetId: target, reference },
  };
  value(
    state.createInput({
      id,
      commandId: `command-${id}`,
      origin,
      evidence: { text: 'native request' },
      materialIds: [],
    }),
  );
  value(state.commitInput({ id, text: 'native request' }));
  return origin;
}
function file(state: SqliteState, origin: Origin, id = 'file'): CompanionMaterialRef {
  const reference: CompanionMaterialRef = {
    id,
    kind: 'file',
    name: 'result.txt',
    mediaType: 'text/plain',
    sizeBytes: 4,
    sha256: 'a'.repeat(64),
    durationMs: null,
    audience: origin.audience,
    originInputIds: [origin.inputId],
  };
  value(
    state.putMaterial({
      id,
      inputId: origin.inputId,
      observationId: null,
      audience: origin.audience,
      phase: 'ready',
      reference,
      storageKey: `materials/${id}`,
      cleanup: 'settled',
      error: null,
    }),
  );
  return reference;
}
function prepare(
  state: SqliteState,
  origin: Origin,
  id: string,
  options: {
    split?: boolean;
    material?: CompanionMaterialRef;
    expiry?: number;
    voice?: boolean;
  } = {},
): QQDeliveryView {
  const text = 'Complete response';
  const message = value(
    state.appendMessage({
      id: `message-${id}`,
      role: 'assistant',
      inputId: origin.inputId,
      text,
      audience: origin.audience,
      origins: [origin],
      materials: options.material ? [options.material] : [],
    }),
  );
  const bodies = options.split ? ['Complete ', 'response'] : [text];
  const parts: QQDeliveryPart[] = bodies.map((body, index) => ({
    id: `${id}-part-${index}`,
    index,
    requirement: 'mandatory-text',
    content: {
      kind: 'inline-text',
      text: body,
      sha256: createHash('sha256').update(body).digest('hex'),
    },
    preparation: 'ready',
    error: null,
    msgSeq: null,
    upload: null,
    send: null,
  }));
  if (options.material)
    parts.push({
      id: `${id}-file`,
      index: parts.length,
      requirement: 'required-media',
      content: { kind: 'material', material: options.material },
      preparation: 'ready',
      error: null,
      msgSeq: null,
      upload: null,
      send: null,
    });
  if (options.voice)
    parts.push({
      id: `${id}-voice`,
      index: parts.length,
      requirement: 'optional-voice',
      content: { kind: 'voice', messageIds: [message.id], material: null },
      preparation: 'pending',
      error: null,
      msgSeq: null,
      upload: null,
      send: null,
    });
  const proposal: QQDeliveryView = {
    id,
    messageIds: [message.id],
    origins: [origin],
    audience: origin.audience,
    route: origin.route,
    textRepresentation: 'inline',
    mode: origin.route.account.protocol === 'official' ? 'official-passive' : 'onebot',
    eligibilityExpiresAt:
      origin.route.account.protocol === 'official' ? (options.expiry ?? Date.now() + 60_000) : null,
    allowedMessageParts: 8,
    phase: 'prepared',
    outcome: 'pending',
    parts,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
  };
  return value(state.createDelivery({ delivery: proposal }));
}
function attempt(
  id: string,
  operation: QQDeliveryAttempt['operation'] = 'send',
): QQDeliveryAttempt {
  return {
    id,
    operation,
    phase: 'claimed',
    outcome: 'pending',
    correlationId: id,
    receipt: null,
    cleanup: 'pending',
    startedAt: Date.now(),
    settledAt: null,
    error: null,
  };
}
function claim(
  state: SqliteState,
  plan: QQDeliveryView,
  partId = `${plan.id}-part-0`,
  operation: QQDeliveryAttempt['operation'] = 'send',
) {
  const input = {
    id: plan.id,
    partId,
    attempt: attempt(`${partId}-attempt-${operation}`, operation),
  };
  return { input, result: state.claimDeliveryAttempt(input) };
}
function settle(
  state: SqliteState,
  current: QQDeliveryView,
  partId: string,
  outcome: 'accepted' | 'failed' | 'unknown' | 'cancelled-before-dispatch' = 'accepted',
): QQDeliveryView {
  return value(
    state.updateDelivery({
      delivery: {
        ...current,
        updatedAt: Date.now(),
        parts: current.parts.map((part) => {
          if (part.id !== partId) return part;
          const a = part.send ?? part.upload;
          if (!a) throw new Error('missing attempt');
          const done: QQDeliveryAttempt = {
            ...a,
            phase: 'settled',
            outcome,
            cleanup: outcome === 'unknown' ? 'unknown' : 'settled',
            settledAt: Date.now(),
            error: outcome === 'accepted' ? null : makeError('unavailable'),
            receipt:
              outcome === 'accepted'
                ? {
                    messageId: a.operation === 'send' ? `remote-${a.id}` : null,
                    fileId: a.operation !== 'send' ? `file-${a.id}` : null,
                    transferId: null,
                    sequence: null,
                    sequenceAuthoritative: null,
                  }
                : null,
          };
          return { ...part, [part.send ? 'send' : 'upload']: done };
        }),
      },
    }),
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const state of stores.splice(0)) state.close();
  for (const root of roots.splice(0)) {
    const target = realpathSync(root);
    if (
      dirname(target) !== realpathSync(tmpdir()) ||
      !basename(target).startsWith('pet-passive-budget-')
    )
      throw new Error('unexpected fixture path');
    rmSync(target, { recursive: true });
  }
});

it('freezes whole batches before first IO and reserves unique sequences without reusing unsent slots', () => {
  const { state } = open();
  const o = register(state, 'request');
  const first = prepare(state, o, 'first', { split: true });
  const second = prepare(state, o, 'second');
  const tooLarge = prepare(state, o, 'too-large', { split: true });
  const before = value(state.snapshot({ scope: management }));
  expect(value(state.passiveReplyBudget({ route: o.route }))).toMatchObject({
    remainingMessageParts: 4,
    nextMsgSeq: 1,
    eligible: true,
  });
  expect(value(state.snapshot({ scope: management }))).toEqual(before);
  const frozen = value(claim(state, first).result).delivery;
  expect(frozen.parts.map((part) => part.msgSeq)).toEqual([1, 2]);
  expect(value(state.createDelivery({ delivery: first }))).toEqual(frozen);
  expect(value(state.passiveReplyBudget({ route: o.route }))).toMatchObject({
    remainingMessageParts: 2,
    nextMsgSeq: 3,
  });
  const next = value(claim(state, second).result).delivery;
  expect(next.parts[0]?.msgSeq).toBe(3);
  const cursor = value(state.snapshot({ scope: management })).cursor;
  expect(claim(state, tooLarge).result).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  expect(value(state.getDelivery({ id: tooLarge.id, scope: management }))).toEqual(tooLarge);
  expect(value(state.snapshot({ scope: management })).cursor).toBe(cursor);
  const last = value(claim(state, prepare(state, o, 'last')).result).delivery;
  expect(last.parts[0]?.msgSeq).toBe(4);
  expect(value(state.passiveReplyBudget({ route: o.route }))).toMatchObject({
    remainingMessageParts: 0,
    nextMsgSeq: 5,
    eligible: false,
  });
  expect(
    state.updateDelivery({
      delivery: { ...frozen, parts: frozen.parts.map((part) => ({ ...part, msgSeq: 99 })) },
    }).ok,
  ).toBe(false);
});

it('serializes stale cross-batch claims for the last C2C slot and charges failed/unknown attempts', async () => {
  const { state } = open();
  const o = register(state, 'request');
  const outcomes = ['accepted', 'failed', 'unknown'] as const;
  let acceptedInput: ReturnType<typeof claim>['input'] | undefined;
  for (const [index, outcome] of outcomes.entries()) {
    const p = prepare(state, o, `prior-${index}`);
    const c = claim(state, p);
    if (index === 0) acceptedInput = c.input;
    settle(state, value(c.result).delivery, `${p.id}-part-0`, outcome);
  }
  const stale = [prepare(state, o, 'foreground'), prepare(state, o, 'background')];
  expect(value(state.passiveReplyBudget({ route: o.route })).remainingMessageParts).toBe(1);
  const results = await Promise.all(
    stale.map((p) => Promise.resolve().then(() => claim(state, p).result)),
  );
  expect(results.filter((result) => result.ok && result.value.claimed)).toHaveLength(1);
  expect(
    results.filter((result) => !result.ok && result.error.code === 'quota-exceeded'),
  ).toHaveLength(1);
  if (!acceptedInput) throw new Error('missing accepted input');
  expect(value(state.claimDeliveryAttempt(acceptedInput)).claimed).toBe(false);
  const changedDisplay = {
    ...o.route,
    reference: {
      ...o.route.reference,
      eventId: 'other-event',
      messageId: 'native-message',
      occurredAt: Date.now(),
      displayReference: 'other-display',
    },
  };
  expect(value(state.passiveReplyBudget({ route: changedDisplay })).remainingMessageParts).toBe(0);
  expect(QQ_OFFICIAL_C2C_PASSIVE_MAX_PARTS).toBe(4);
});

it('keeps group cap five, includes cancel-before-dispatch reservations, and isolates other native bases', () => {
  const { state } = open();
  const o = register(state, 'request', { scene: 'group' });
  for (let index = 0; index < QQ_OFFICIAL_GROUP_PASSIVE_MAX_PARTS; index++) {
    const p = prepare(state, o, `group-${index}`);
    const frozen = value(claim(state, p).result).delivery;
    if (index === 0) settle(state, frozen, `${p.id}-part-0`, 'cancelled-before-dispatch');
    expect(frozen.parts[0]?.msgSeq).toBe(index + 1);
  }
  expect(claim(state, prepare(state, o, 'sixth')).result).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  expect(
    value(state.passiveReplyBudget({ route: { ...o.route, targetId: 'another-target' } })),
  ).toMatchObject({ remainingMessageParts: 5, nextMsgSeq: 1 });
  expect(
    value(
      state.passiveReplyBudget({
        route: { ...o.route, account: { ...o.route.account, accountId: 'another-account' } },
      }),
    ),
  ).toMatchObject({ remainingMessageParts: 5, nextMsgSeq: 1 });
  const eventOnly = register(state, 'event-only', {
    scene: 'group',
    reference: {
      eventId: 'real-event',
      messageId: null,
      occurredAt: Date.now(),
      displayReference: null,
    },
  });
  expect(
    value(claim(state, prepare(state, eventOnly, 'event-batch')).result).delivery.parts[0]?.msgSeq,
  ).toBe(1);
  expect(
    value(
      state.passiveReplyBudget({
        route: {
          ...eventOnly.route,
          reference: {
            eventId: 'real-event',
            messageId: null,
            occurredAt: Date.now(),
            displayReference: 'changed',
          },
        },
      }),
    ),
  ).toMatchObject({ remainingMessageParts: 4, nextMsgSeq: 2 });
});

it.each(['upload', 'upload-and-send'] as const)(
  'counts message effects while preserving whole-plan reservations for %s',
  (operation) => {
    const { state } = open();
    const o = register(state, 'request');
    const withFile = prepare(state, o, 'file-batch', { material: file(state, o) });
    const text = settle(state, value(claim(state, withFile).result).delivery, 'file-batch-part-0');
    const upload = value(claim(state, text, 'file-batch-file', operation).result).delivery;
    const uploaded = settle(state, upload, 'file-batch-file');
    for (const id of ['another', 'last']) {
      const p = prepare(state, o, id);
      settle(state, value(claim(state, p).result).delivery, `${id}-part-0`);
    }
    if (operation === 'upload') {
      const last = value(claim(state, uploaded, 'file-batch-file', 'send').result).delivery;
      expect(last.parts[1]?.msgSeq).toBe(2);
    }
    expect(claim(state, prepare(state, o, 'overflow')).result).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
  },
);

it('uses SQL time and native reference lifetime and excludes disabled optional voice from reservations', () => {
  const { state } = open();
  const o = register(state, 'request');
  const expired = prepare(state, o, 'expired', { expiry: Date.now() - 1 });
  const a = attempt('expired-attempt');
  const actualNow = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(actualNow - 60 * 60 * 1000);
  expect(
    state.claimDeliveryAttempt({ id: expired.id, partId: 'expired-part-0', attempt: a }),
  ).toMatchObject({ ok: false, error: { code: 'not-ready' } });
  vi.restoreAllMocks();
  const voice = prepare(state, o, 'voice', { voice: true });
  const withoutVoice = value(
    state.updateDelivery({
      delivery: {
        ...voice,
        parts: voice.parts.map((part) =>
          part.requirement === 'optional-voice'
            ? { ...part, preparation: 'unavailable', error: makeError('quota-exceeded') }
            : part,
        ),
      },
    }),
  );
  const claimed = value(claim(state, withoutVoice).result).delivery;
  expect(claimed.parts.map((part) => part.msgSeq)).toEqual([1, null]);
  expect(value(state.passiveReplyBudget({ route: o.route }))).toMatchObject({
    remainingMessageParts: 3,
    expiresAt: (o.route.reference?.occurredAt ?? 0) + QQ_OFFICIAL_PASSIVE_WINDOW_MS,
  });
  const old = register(state, 'old', {
    reference: {
      eventId: null,
      messageId: 'old-message',
      occurredAt: Date.now() - QQ_OFFICIAL_PASSIVE_WINDOW_MS - 1,
      displayReference: null,
    },
  });
  expect(value(state.passiveReplyBudget({ route: old.route })).eligible).toBe(false);
  expect(
    claim(state, prepare(state, old, 'old-batch', { expiry: Date.now() + 60_000 })).result,
  ).toMatchObject({ ok: false, error: { code: 'not-ready' } });
  expect(
    value(
      state.passiveReplyBudget({
        route: {
          ...old.route,
          reference: {
            eventId: null,
            messageId: 'old-message',
            occurredAt: Date.now(),
            displayReference: 'new-display',
          },
        },
      }),
    ).eligible,
  ).toBe(false);
  expect(
    value(
      state.passiveReplyBudget({
        route: {
          ...old.route,
          reference: {
            ...old.route.reference,
            eventId: null,
            messageId: 'unknown-time',
            occurredAt: null,
            displayReference: null,
          },
        },
      }),
    ),
  ).toMatchObject({ eligible: false, expiresAt: null });
});

it('rolls back the entire sequence reservation when claim event persistence fails', () => {
  const initial = open();
  const o = register(initial.state, 'request');
  const p = prepare(initial.state, o, 'atomic', { split: true });
  initial.state.close();
  const db = new DatabaseSync(join(initial.directory, 'state.sqlite'));
  db.exec(
    "CREATE TRIGGER fail_claim BEFORE INSERT ON events WHEN json_extract(NEW.body,'$.data.deliveryId')='atomic' BEGIN SELECT RAISE(ABORT,'synthetic claim failure'); END;",
  );
  db.close();
  const { state } = open(initial.directory);
  expect(claim(state, p).result).toMatchObject({ ok: false, error: { code: 'internal' } });
  expect(value(state.getDelivery({ id: p.id, scope: management }))).toEqual(p);
  expect(value(state.passiveReplyBudget({ route: o.route }))).toMatchObject({
    remainingMessageParts: 4,
    nextMsgSeq: 1,
  });
});

it('retains compound OneBot transfer IDs in pending/failed receipts without claiming file acceptance', () => {
  const { state } = open();
  const o = register(state, 'onebot', {
    account: {
      protocol: 'onebot-v11',
      sourcePluginId: 'pet.qq-onebot',
      instanceId: 'default',
      accountId: '1001',
    },
    target: '2002',
    reference: { eventId: null, messageId: '-42', occurredAt: Date.now(), displayReference: null },
  });
  const p = prepare(state, o, 'compound', { material: file(state, o) });
  const textClaim = {
    id: p.id,
    partId: 'compound-part-0',
    attempt: { ...attempt('text-attempt'), correlationId: null },
  };
  const textPending = value(state.claimDeliveryAttempt(textClaim)).delivery;
  expect(textPending.parts[0]?.send?.correlationId).toBeNull();
  const textBound = value(
    state.updateDelivery({
      delivery: {
        ...textPending,
        parts: textPending.parts.map((part) =>
          part.send
            ? {
                ...part,
                send: { ...part.send, phase: 'dispatched', correlationId: 'driver-text-echo' },
              }
            : part,
        ),
      },
    }),
  );
  const text = settle(state, textBound, 'compound-part-0');
  expect(value(state.claimDeliveryAttempt(textClaim)).claimed).toBe(false);
  const compoundClaim = {
    id: text.id,
    partId: 'compound-file',
    attempt: { ...attempt('compound-attempt', 'upload-and-send'), correlationId: null },
  };
  const claimed = value(state.claimDeliveryAttempt(compoundClaim)).delivery;
  const pending = value(
    state.updateDelivery({
      delivery: {
        ...claimed,
        parts: claimed.parts.map((part) =>
          part.upload
            ? {
                ...part,
                upload: {
                  ...part.upload,
                  phase: 'dispatched',
                  receipt: {
                    messageId: null,
                    fileId: null,
                    transferId: 'stream-completed',
                    sequence: null,
                    sequenceAuthoritative: null,
                  },
                },
              }
            : part,
        ),
      },
    }),
  );
  expect(pending.parts[1]?.upload?.receipt?.transferId).toBe('stream-completed');
  expect(pending.parts[1]?.upload?.correlationId).toBeNull();
  expect(isQQDeliveryPartAccepted(pending.parts[1])).toBe(false);
  const wrong = {
    ...pending,
    parts: pending.parts.map((part) =>
      part.upload
        ? {
            ...part,
            upload: {
              ...part.upload,
              phase: 'settled' as const,
              outcome: 'accepted' as const,
              settledAt: Date.now(),
              cleanup: 'settled' as const,
            },
          }
        : part,
    ),
  };
  expect(state.updateDelivery({ delivery: wrong }).ok).toBe(false);
  const failed = value(
    state.updateDelivery({
      delivery: {
        ...pending,
        phase: 'terminal',
        outcome: 'partial',
        parts: pending.parts.map((part) =>
          part.upload
            ? {
                ...part,
                upload: {
                  ...part.upload,
                  phase: 'settled',
                  outcome: 'failed',
                  settledAt: Date.now(),
                  cleanup: 'settled',
                  error: makeError('network'),
                },
              }
            : part,
        ),
      },
    }),
  );
  expect(failed.parts[1]?.upload?.receipt?.transferId).toBe('stream-completed');
  expect(isQQDeliveryPartAccepted(failed.parts[1])).toBe(false);
  const bound = value(
    state.updateDelivery({
      delivery: {
        ...failed,
        parts: failed.parts.map((part) =>
          part.upload
            ? { ...part, upload: { ...part.upload, correlationId: 'driver-final-operation-echo' } }
            : part,
        ),
      },
    }),
  );
  expect(bound.parts[1]?.upload?.correlationId).toBe('driver-final-operation-echo');
  expect(bound.parts[1]?.upload?.correlationId).not.toBe(compoundClaim.attempt.id);
  for (const correlationId of [null, 'replacement-echo'])
    expect(
      state.updateDelivery({
        delivery: {
          ...bound,
          parts: bound.parts.map((part) =>
            part.upload ? { ...part, upload: { ...part.upload, correlationId } } : part,
          ),
        },
      }).ok,
    ).toBe(false);
  expect(value(state.claimDeliveryAttempt(compoundClaim)).claimed).toBe(false);
});
