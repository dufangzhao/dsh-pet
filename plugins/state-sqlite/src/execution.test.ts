import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { makeError } from '@pet/contracts';
import type {
  CompanionInputOrigin,
  LocalHostSourceBinding,
  LocalHostTaskReference,
  LocalHostProcessIdentity,
  QQDeliveryAttempt,
  QQDeliveryView,
  QQReplyRoute,
  Result,
} from '@pet/contracts';
import { SqliteState } from './state.js';
import { fingerprint } from './records.js';
import type { DeliveryTaskBinding, ExecutionTarget, StateMethodInputs } from './types.js';

const stores: SqliteState[] = [],
  roots: string[] = [];
const management = { kind: 'management' as const };
const binding: LocalHostSourceBinding = {
  hostId: 'host-one',
  hostBootId: 'boot-one',
  bridgeSessionId: 'bridge-one',
  sourceOwner: { pluginId: 'pet.qq-official', instanceId: 'default', generation: 1 },
  sourceConfigRevision: 1,
  sourcePermissionEpoch: 0,
  sourceCredentialVersion: 'key:one',
  nativeConnectionId: 'native-one',
};
const task: LocalHostTaskReference = { owner: binding.sourceOwner, taskId: 'real-local-task' };
const processIdentity: LocalHostProcessIdentity = {
  osKind: 'linux',
  osBootIdentity: '12345678-1234-1234-1234-123456789abc@4:4026531836',
  pid: 1234,
  processCreationIdentity: '88901234',
  profileIdentity: 'a'.repeat(64),
};
function open(directory?: string) {
  const root = directory ?? mkdtempSync(join(tmpdir(), 'pet-state-four-'));
  if (!directory) roots.push(root);
  const state = new SqliteState({ dataDirectory: root });
  stores.push(state);
  return { state, directory: root };
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function plan(state: SqliteState, id = 'delivery', voice = false): QQDeliveryView {
  const account = {
    protocol: 'official' as const,
    sourcePluginId: 'pet.qq-official',
    instanceId: 'default' as const,
    accountId: 'account',
  };
  const route: QQReplyRoute = {
    kind: 'qq',
    account,
    scene: 'private',
    targetId: 'sender',
    reference: {
      eventId: null,
      messageId: `native-${id}`,
      occurredAt: Date.now(),
      displayReference: null,
    },
  };
  const origin: CompanionInputOrigin = {
    kind: 'qq',
    inputId: `input-${id}`,
    principalId: 'person',
    audience: { kind: 'person-private', principalId: 'person' },
    route,
    policyRevision: 1,
    actor: { account, scene: 'private', senderId: 'sender' },
    eventKey: `event-${id}`,
    messageId: `native-${id}`,
    trigger: 'direct',
    quote: null,
  };
  value(
    state.createInput({
      id: origin.inputId,
      commandId: `command-${id}`,
      origin,
      evidence: { text: 'hello' },
      materialIds: [],
    }),
  );
  value(state.commitInput({ id: origin.inputId, text: 'hello' }));
  const message = value(
    state.appendMessage({
      id: `message-${id}`,
      role: 'assistant',
      text: 'complete response',
      audience: origin.audience,
      origins: [origin],
      inputId: origin.inputId,
    }),
  );
  return {
    id,
    messageIds: [message.id],
    origins: [origin],
    audience: origin.audience,
    route,
    textRepresentation: 'inline',
    mode: 'official-passive',
    eligibilityExpiresAt: Date.now() + 60_000,
    allowedMessageParts: 4,
    phase: 'prepared',
    outcome: 'pending',
    createdAt: 1000,
    updatedAt: 1000,
    error: null,
    parts: [
      {
        id: `${id}-text`,
        index: 0,
        requirement: 'mandatory-text',
        content: {
          kind: 'inline-text',
          text: message.text,
          sha256: createHash('sha256').update(message.text).digest('hex'),
        },
        preparation: 'ready',
        error: null,
        msgSeq: null,
        upload: null,
        send: null,
      },
      ...(voice
        ? [
            {
              id: `${id}-voice`,
              index: 1,
              requirement: 'optional-voice' as const,
              content: { kind: 'voice' as const, messageIds: [message.id], material: null },
              preparation: 'pending' as const,
              error: null,
              msgSeq: null,
              upload: null,
              send: null,
            },
          ]
        : []),
    ],
  };
}
function start(
  state: SqliteState,
  proposal: QQDeliveryView,
  execution: ExecutionTarget = { kind: 'remote', binding },
) {
  value(state.createDelivery({ delivery: proposal, execution }));
  const attempt: QQDeliveryAttempt = {
    id: `${proposal.id}-attempt`,
    operation: 'send',
    phase: 'claimed',
    outcome: 'pending',
    correlationId: null,
    receipt: null,
    cleanup: 'pending',
    startedAt: Date.now(),
    settledAt: null,
    error: null,
  };
  const part = proposal.parts[0];
  if (!part || part.content.kind !== 'inline-text') throw new Error('missing text');
  const claim = { id: proposal.id, partId: part.id, attempt };
  const delivery = value(state.claimDeliveryAttempt(claim)).delivery;
  const reference: DeliveryTaskBinding = {
    id: proposal.id,
    partId: part.id,
    attemptId: attempt.id,
    binding,
    task,
    contentHash: part.content.sha256,
  };
  return { delivery, claim, reference };
}
function fact(input: DeliveryTaskBinding): StateMethodInputs['enrichDeliveryAttempt'] {
  return {
    ...input,
    fact: {
      dispatch: 'dispatched',
      outcome: 'accepted',
      correlationId: 'actual-wire-echo',
      receipt: {
        messageId: 'platform-message',
        fileId: null,
        transferId: null,
        sequence: null,
        sequenceAuthoritative: null,
      },
      cleanup: 'settled',
      error: null,
    },
  };
}
function dispatched(state: SqliteState, delivery: QQDeliveryView): QQDeliveryView {
  return value(
    state.updateDelivery({
      delivery: {
        ...delivery,
        parts: delivery.parts.map((part) =>
          part.send ? { ...part, send: { ...part.send, phase: 'dispatched' } } : part,
        ),
      },
    }),
  );
}
afterEach(() => {
  for (const state of stores.splice(0)) state.close();
  for (const root of roots.splice(0)) {
    const target = realpathSync(root);
    if (
      dirname(target) !== realpathSync(tmpdir()) ||
      !basename(target).startsWith('pet-state-four-')
    )
      throw new Error('unexpected fixture path');
    rmSync(target, { recursive: true });
  }
});

it('captures one original process identity atomically with the first task and persists it without changing intent', () => {
  const initial = open();
  const proposal = plan(initial.state, 'process-stamp');
  const started = start(initial.state, proposal);
  const creationHash = fingerprint({ delivery: proposal, execution: { kind: 'remote', binding } });
  expect(value(initial.state.bindDeliveryTask({ ...started.reference, processIdentity }))).toEqual({
    bound: true,
  });
  const before = value(initial.state.snapshot()).cursor;
  expect(value(initial.state.bindDeliveryTask({ ...started.reference, processIdentity }))).toEqual({
    bound: false,
  });
  expect(value(initial.state.snapshot()).cursor).toBe(before);
  expect(
    initial.state.bindDeliveryTask({
      ...started.reference,
      processIdentity: { ...processIdentity, pid: 4321 },
    }).ok,
  ).toBe(false);
  const stored = value(initial.state.getDeliveryExecution({ id: proposal.id, scope: management }));
  expect(stored).toMatchObject({ processIdentity, attempts: [{ task }] });
  expect(stored?.attempts.every((entry) => !Object.hasOwn(entry, 'processIdentity'))).toBe(true);
  expect(
    JSON.stringify(value(initial.state.getDelivery({ id: proposal.id, scope: management }))),
  ).not.toContain('osBootIdentity');
  initial.state.close();
  const inspect = new DatabaseSync(join(initial.directory, 'state.sqlite'));
  try {
    expect(
      inspect.prepare('SELECT fingerprint FROM qq_deliveries WHERE id=?').get(proposal.id)?.[
        'fingerprint'
      ],
    ).toBe(creationHash);
  } finally {
    inspect.close();
  }
  const state = open(initial.directory).state;
  expect(value(state.getDeliveryExecution({ id: proposal.id, scope: management }))).toEqual(stored);
});

it('keeps unstamped legacy/null records readable and refuses to invent a process stamp after a task was bound', () => {
  const initial = open();
  const started = start(initial.state, plan(initial.state, 'legacy-process'));
  value(initial.state.bindDeliveryTask(started.reference));
  expect(
    value(initial.state.getDeliveryExecution({ id: started.reference.id, scope: management }))
      ?.processIdentity,
  ).toBeUndefined();
  expect(initial.state.bindDeliveryTask({ ...started.reference, processIdentity })).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  initial.state.close();
  const db = new DatabaseSync(join(initial.directory, 'state.sqlite'));
  db.prepare(
    "UPDATE qq_deliveries SET execution_json=json_set(execution_json,'$.processIdentity',NULL) WHERE id=?",
  ).run(started.reference.id);
  db.close();
  const state = open(initial.directory).state;
  expect(
    value(state.getDeliveryExecution({ id: started.reference.id, scope: management }))
      ?.processIdentity,
  ).toBeNull();
  expect(state.bindDeliveryTask({ ...started.reference, processIdentity }).ok).toBe(false);
  value(state.recover());
  expect(state.settleDeliveryCleanup({ ...started.reference, processIdentity })).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
  expect(state.bindDeliveryTask({ ...started.reference, processIdentity })).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
});

it('settles only current cleanup after a later receipt race, preserving every effect fact and voice fence', () => {
  const { state } = open();
  const started = start(state, plan(state, 'cleanup-race', true));
  value(state.bindDeliveryTask({ ...started.reference, processIdentity }));
  expect(state.settleDeliveryCleanup({ ...started.reference, processIdentity })).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
  dispatched(state, started.delivery);
  value(state.recover());
  const originalRecoveryRequest = { ...started.reference, processIdentity };
  const newer = value(
    state.enrichDeliveryAttempt({
      ...fact(started.reference),
      fact: {
        ...fact(started.reference).fact,
        cleanup: 'unknown',
        error: makeError('permission-denied'),
      },
    }),
  );
  const updated = value(state.settleDeliveryCleanup(originalRecoveryRequest));
  expect(updated).toEqual({
    ...newer,
    updatedAt: updated.updatedAt,
    parts: newer.parts.map((part) =>
      part.id === started.reference.partId
        ? { ...part, send: part.send ? { ...part.send, cleanup: 'settled' } : null }
        : part,
    ),
  });
  expect(updated).toMatchObject({
    phase: 'terminal',
    outcome: 'partial',
    parts: [
      {
        send: {
          outcome: 'accepted',
          error: makeError('permission-denied'),
          receipt: { messageId: 'platform-message' },
          correlationId: 'actual-wire-echo',
        },
      },
      { preparation: 'cancelled', send: null, upload: null },
    ],
  });
  const cursor = value(state.snapshot()).cursor;
  expect(value(state.settleDeliveryCleanup(originalRecoveryRequest))).toEqual(updated);
  expect(value(state.snapshot()).cursor).toBe(cursor);
  for (const mismatch of [
    {
      ...originalRecoveryRequest,
      processIdentity: { ...processIdentity, processCreationIdentity: 'another-process' },
    },
    {
      ...originalRecoveryRequest,
      processIdentity: { ...processIdentity, profileIdentity: 'other-profile' },
    },
    { ...originalRecoveryRequest, task: { ...task, taskId: 'another-task' } },
    { ...originalRecoveryRequest, contentHash: '0'.repeat(64) },
    { ...originalRecoveryRequest, binding: { ...binding, hostBootId: 'new-daemon-label' } },
  ])
    expect(state.settleDeliveryCleanup(mismatch).ok).toBe(false);
  expect(
    state.invoke('settleDeliveryCleanup', {
      ...originalRecoveryRequest,
      fact: { outcome: 'accepted' },
    }).ok,
  ).toBe(false);
  expect(value(state.claimDeliveryAttempt(started.claim)).claimed).toBe(false);
});

it('rolls back first process capture and cleanup-only updates when their event cannot commit', () => {
  const initial = open();
  const started = start(initial.state, plan(initial.state, 'process-atomic'));
  initial.state.close();
  const sql = (operation: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(join(initial.directory, 'state.sqlite'));
    try {
      operation(db);
    } finally {
      db.close();
    }
  };
  const trigger =
    "CREATE TRIGGER fail_process_event BEFORE INSERT ON events WHEN json_extract(NEW.body,'$.data.deliveryId')='process-atomic' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;";
  sql((db) => db.exec(trigger));
  const failing = open(initial.directory).state;
  expect(failing.bindDeliveryTask({ ...started.reference, processIdentity }).ok).toBe(false);
  const unchanged = value(
    failing.getDeliveryExecution({ id: started.reference.id, scope: management }),
  );
  expect(unchanged?.processIdentity).toBeUndefined();
  expect(unchanged?.attempts[0]?.task).toBeNull();
  failing.close();
  sql((db) => db.exec('DROP TRIGGER fail_process_event'));
  const active = open(initial.directory).state;
  value(active.bindDeliveryTask({ ...started.reference, processIdentity }));
  dispatched(active, started.delivery);
  value(active.recover());
  const before = value(active.getDelivery({ id: started.reference.id, scope: management }));
  active.close();
  sql((db) => db.exec(trigger));
  const recovery = open(initial.directory).state;
  expect(recovery.settleDeliveryCleanup({ ...started.reference, processIdentity })).toMatchObject({
    ok: false,
    error: { code: 'internal' },
  });
  expect(value(recovery.getDelivery({ id: started.reference.id, scope: management }))).toEqual(
    before,
  );
});

it('retains legacy absent-binding fingerprints and separates scoped private execution from public views', () => {
  const { state, directory } = open();
  const legacy = plan(state, 'legacy');
  value(state.createDelivery({ delivery: legacy }));
  expect(value(state.getDeliveryExecution({ id: legacy.id, scope: management }))).toBeNull();
  const remote = plan(state, 'remote');
  value(state.createDelivery({ delivery: remote, execution: { kind: 'remote', binding } }));
  expect(value(state.getDeliveryExecution({ id: remote.id, scope: management }))).toEqual({
    target: { kind: 'remote', binding },
    attempts: [],
  });
  expect(
    JSON.stringify(value(state.getDelivery({ id: remote.id, scope: management }))),
  ).not.toContain('hostBootId');
  expect(
    JSON.stringify(
      value(state.events({ after: 0, epoch: value(state.snapshot()).epoch, scope: management })),
    ),
  ).not.toContain('bridgeSessionId');
  expect(
    state.getDeliveryExecution({
      id: remote.id,
      scope: {
        kind: 'conversation',
        audience: { kind: 'person-private', principalId: 'other' },
        principalId: 'other',
      },
    }),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(state.getDeliveryExecution({ id: 'missing', scope: management })).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
  expect(
    state.createDelivery({ delivery: legacy, execution: { kind: 'remote', binding } }).ok,
  ).toBe(false);
  expect(state.createDelivery({ delivery: remote }).ok).toBe(false);
  expect(
    state.createDelivery({
      delivery: remote,
      execution: { kind: 'remote', binding: { ...binding, hostBootId: 'replacement' } },
    }).ok,
  ).toBe(false);
  expect(state.invoke('createDelivery', { delivery: remote, execution: null }).ok).toBe(false);
  state.close();
  const db = new DatabaseSync(join(directory, 'state.sqlite'));
  try {
    expect(
      db.prepare('SELECT fingerprint,execution_json FROM qq_deliveries WHERE id=?').get(legacy.id),
    ).toMatchObject({ fingerprint: fingerprint(legacy), execution_json: null });
    expect(
      db.prepare('SELECT fingerprint FROM qq_deliveries WHERE id=?').get(remote.id)?.[
        'fingerprint'
      ],
    ).toBe(fingerprint({ delivery: remote, execution: { kind: 'remote', binding } }));
  } finally {
    db.close();
  }
});

it('binds the exact real local task once before remote dispatch and rejects replacement authority', () => {
  const { state } = open();
  const proposal = plan(state);
  const started = start(state, proposal);
  expect(
    state.updateDelivery({
      delivery: {
        ...started.delivery,
        parts: started.delivery.parts.map((part) =>
          part.send ? { ...part, send: { ...part.send, phase: 'dispatched' } } : part,
        ),
      },
    }).ok,
  ).toBe(false);
  expect(
    value(state.getDeliveryExecution({ id: proposal.id, scope: management }))?.attempts[0]?.task,
  ).toBeNull();
  expect(value(state.bindDeliveryTask(started.reference))).toEqual({ bound: true });
  const cursor = value(state.snapshot()).cursor;
  expect(value(state.bindDeliveryTask(started.reference))).toEqual({ bound: false });
  expect(value(state.snapshot()).cursor).toBe(cursor);
  expect(
    state.bindDeliveryTask({
      ...started.reference,
      binding: { ...binding, bridgeSessionId: 'new-bridge' },
    }).ok,
  ).toBe(false);
  expect(
    state.bindDeliveryTask({ ...started.reference, task: { ...task, taskId: 'other-task' } }).ok,
  ).toBe(false);
  expect(state.bindDeliveryTask({ ...started.reference, contentHash: '0'.repeat(64) }).ok).toBe(
    false,
  );
  expect(
    state.invoke('bindDeliveryTask', {
      ...started.reference,
      binding: { ...binding, authority: true },
    }).ok,
  ).toBe(false);
  expect(
    state.invoke('bindDeliveryTask', {
      ...started.reference,
      task: { ...task, owner: { ...task.owner, generation: 1.5 } },
    }).ok,
  ).toBe(false);
  dispatched(state, started.delivery);
  expect(value(state.bindDeliveryTask(started.reference))).toEqual({ bound: false });
  expect(
    value(state.getDeliveryExecution({ id: proposal.id, scope: management }))?.attempts[0]
      ?.dispatchObserved,
  ).toBe(true);
});

it('preserves original dispatch through restart and enriches only terminal matching facts without reopening voice', () => {
  const initial = open();
  const proposal = plan(initial.state, 'late', true);
  const started = start(initial.state, proposal);
  value(initial.state.bindDeliveryTask(started.reference));
  dispatched(initial.state, started.delivery);
  expect(initial.state.enrichDeliveryAttempt(fact(started.reference))).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
  initial.state.close();
  const { state } = open(initial.directory);
  value(state.recover());
  const sealed = value(state.getDelivery({ id: proposal.id, scope: management }));
  const privateRecord = value(state.getDeliveryExecution({ id: proposal.id, scope: management }));
  expect(privateRecord?.attempts[0]?.dispatchObserved).toBe(true);
  expect(sealed).toMatchObject({
    phase: 'terminal',
    outcome: 'unknown',
    parts: [{ send: { phase: 'settled', outcome: 'unknown' } }, { preparation: 'cancelled' }],
  });
  expect(
    state.enrichDeliveryAttempt({
      ...fact(started.reference),
      fact: {
        dispatch: 'not-dispatched',
        outcome: 'cancelled-before-dispatch',
        correlationId: null,
        receipt: null,
        cleanup: 'settled',
        error: null,
      },
    }).ok,
  ).toBe(false);
  expect(
    state.enrichDeliveryAttempt({
      ...fact(started.reference),
      binding: { ...binding, hostBootId: 'new-boot' },
    }).ok,
  ).toBe(false);
  expect(
    state.enrichDeliveryAttempt({
      ...fact(started.reference),
      task: { ...task, taskId: 'new-task' },
    }).ok,
  ).toBe(false);
  const updated = value(state.enrichDeliveryAttempt(fact(started.reference)));
  expect(updated).toMatchObject({
    phase: 'terminal',
    outcome: 'partial',
    parts: [
      {
        send: {
          outcome: 'accepted',
          receipt: { messageId: 'platform-message' },
          cleanup: 'settled',
        },
      },
      { preparation: 'cancelled', upload: null, send: null },
    ],
  });
  expect(updated.parts[0]?.send?.startedAt).toBe(sealed.parts[0]?.send?.startedAt);
  expect(updated.parts[0]?.send?.settledAt).toBe(sealed.parts[0]?.send?.settledAt);
  const cursor = value(state.snapshot()).cursor;
  expect(value(state.enrichDeliveryAttempt(fact(started.reference)))).toEqual(updated);
  expect(value(state.snapshot()).cursor).toBe(cursor);
  expect(value(state.claimDeliveryAttempt(started.claim)).claimed).toBe(false);
  expect(state.bindDeliveryTask(started.reference).ok).toBe(false);
  expect(
    state.updateDelivery({ delivery: { ...updated, phase: 'sending', outcome: 'pending' } }).ok,
  ).toBe(false);
  expect(state.updateDelivery({ delivery: { ...updated, error: makeError('network') } }).ok).toBe(
    false,
  );
});

it('never downgrades accepted facts or erases known receipts and rejects contradictory IDs and cleanup', () => {
  const { state } = open();
  const proposal = plan(state, 'accepted');
  const started = start(state, proposal);
  value(state.bindDeliveryTask(started.reference));
  dispatched(state, started.delivery);
  value(state.recover());
  const evidence = fact(started.reference);
  const accepted = value(state.enrichDeliveryAttempt(evidence));
  expect(accepted.outcome).toBe('accepted');
  const lower = {
    ...evidence,
    fact: {
      ...evidence.fact,
      dispatch: 'unknown' as const,
      outcome: 'unknown' as const,
      receipt: null,
      correlationId: null,
    },
  };
  expect(value(state.enrichDeliveryAttempt(lower))).toEqual(accepted);
  expect(
    state.enrichDeliveryAttempt({
      ...evidence,
      fact: {
        ...evidence.fact,
        receipt: {
          messageId: 'contradictory',
          fileId: null,
          transferId: null,
          sequence: null,
          sequenceAuthoritative: null,
        },
      },
    }).ok,
  ).toBe(false);
  expect(
    state.enrichDeliveryAttempt({
      ...evidence,
      fact: { ...evidence.fact, correlationId: 'other-echo' },
    }).ok,
  ).toBe(false);
  expect(
    state.enrichDeliveryAttempt({ ...evidence, fact: { ...evidence.fact, cleanup: 'unknown' } }).ok,
  ).toBe(false);
  expect(
    state.enrichDeliveryAttempt({
      ...evidence,
      fact: { ...evidence.fact, dispatch: 'not-dispatched' },
    }).ok,
  ).toBe(false);
  expect(value(state.getDelivery({ id: proposal.id, scope: management }))).toEqual(accepted);
});

it('records cleanup-only evidence without resolving an unknown effect and refuses first binding after terminal recovery', () => {
  const { state } = open();
  const started = start(state, plan(state, 'cleanup-only'));
  value(state.bindDeliveryTask(started.reference));
  dispatched(state, started.delivery);
  value(state.recover());
  const cleanup = {
    ...started.reference,
    fact: {
      dispatch: 'unknown' as const,
      outcome: 'unknown' as const,
      correlationId: null,
      receipt: null,
      cleanup: 'settled' as const,
      error: makeError('unavailable', false),
    },
  };
  const updated = value(state.enrichDeliveryAttempt(cleanup));
  expect(updated).toMatchObject({
    phase: 'terminal',
    outcome: 'unknown',
    parts: [{ send: { outcome: 'unknown', cleanup: 'settled', receipt: null } }],
  });
  expect(
    value(state.getDeliveryExecution({ id: started.reference.id, scope: management }))?.attempts[0],
  ).toMatchObject({ task, dispatchObserved: true });
  expect(value(state.claimDeliveryAttempt(started.claim)).claimed).toBe(false);
  const unbound = start(state, plan(state, 'unbound'));
  value(state.recover());
  expect(state.bindDeliveryTask(unbound.reference)).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
  expect(state.enrichDeliveryAttempt(fact(unbound.reference))).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
});

it('keeps unavailable targets explicitly non-dispatchable without pretending to be legacy or live', () => {
  const { state } = open();
  const proposal = plan(state, 'offline');
  const offline: QQDeliveryView = {
    ...proposal,
    phase: 'blocked',
    outcome: 'failed',
    error: makeError('unavailable'),
    allowedMessageParts: 0,
  };
  value(
    state.createDelivery({
      delivery: offline,
      execution: { kind: 'unavailable', hostId: 'selected-host' },
    }),
  );
  expect(value(state.getDeliveryExecution({ id: offline.id, scope: management }))).toEqual({
    target: { kind: 'unavailable', hostId: 'selected-host' },
    attempts: [],
  });
  expect(
    state.claimDeliveryAttempt({
      id: offline.id,
      partId: 'offline-text',
      attempt: {
        id: 'offline-attempt',
        operation: 'send',
        phase: 'claimed',
        outcome: 'pending',
        correlationId: null,
        receipt: null,
        cleanup: 'pending',
        startedAt: Date.now(),
        settledAt: null,
        error: null,
      },
    }),
  ).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(state.createDelivery({ delivery: offline }).ok).toBe(false);
  expect(
    state.createDelivery({ delivery: offline, execution: { kind: 'remote', binding } }).ok,
  ).toBe(false);
  expect(
    state.createDelivery({
      delivery: { ...proposal, id: 'false-live' },
      execution: { kind: 'unavailable', hostId: null },
    }).ok,
  ).toBe(false);
});

it('rolls back task binding and terminal enrichment together with failed event persistence', () => {
  const initial = open();
  const started = start(initial.state, plan(initial.state, 'atomic'));
  initial.state.close();
  const sql = (operation: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(join(initial.directory, 'state.sqlite'));
    try {
      operation(db);
    } finally {
      db.close();
    }
  };
  const trigger =
    "CREATE TRIGGER fail_execution_event BEFORE INSERT ON events WHEN json_extract(NEW.body,'$.data.deliveryId')='atomic' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;";
  sql((db) => db.exec(trigger));
  const bindingState = open(initial.directory).state;
  const beforeBind = value(bindingState.snapshot()).cursor;
  expect(bindingState.bindDeliveryTask(started.reference).ok).toBe(false);
  expect(
    value(bindingState.getDeliveryExecution({ id: 'atomic', scope: management }))?.attempts[0]
      ?.task,
  ).toBeNull();
  expect(value(bindingState.snapshot()).cursor).toBe(beforeBind);
  bindingState.close();
  sql((db) => db.exec('DROP TRIGGER fail_execution_event'));
  const running = open(initial.directory).state;
  value(running.bindDeliveryTask(started.reference));
  dispatched(running, started.delivery);
  value(running.recover());
  const before = value(running.getDelivery({ id: 'atomic', scope: management }));
  running.close();
  sql((db) => db.exec(trigger));
  const completing = open(initial.directory).state;
  expect(completing.enrichDeliveryAttempt(fact(started.reference))).toMatchObject({
    ok: false,
    error: { code: 'internal' },
  });
  expect(value(completing.getDelivery({ id: 'atomic', scope: management }))).toEqual(before);
});
