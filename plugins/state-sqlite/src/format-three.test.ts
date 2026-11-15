import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CompanionInputOrigin,
  CompanionConversationAudience,
  CompanionMaterialRef,
  CompanionTaskOrigin,
  QQAccountRef,
  QQDeliveryAttempt,
  QQDeliveryView,
  Result,
} from '@pet/contracts';
import {
  isCompanionInputAdmission,
  COMPANION_INPUT_READY_MAX,
  COMPANION_INPUT_READY_PER_AUDIENCE,
  isQQDeliveryView,
  QQ_GROUP_CONTEXT_MAX_AGE_MS,
  QQ_REPLY_TEXT_SEPARATOR,
} from '@pet/contracts';
import { SqliteState } from './state.js';
import { STATE_MAX_MESSAGE_BYTES } from './index.js';
import { fingerprint } from './records.js';
import type { StateReadScope, StoredMaterial, StateObservation } from './types.js';

const roots: string[] = [],
  states: SqliteState[] = [];
const management: StateReadScope = { kind: 'management' };
const account: QQAccountRef = {
  protocol: 'official',
  sourcePluginId: 'pet.qq-official',
  instanceId: 'default',
  accountId: 'account',
};
function open(directory?: string): { state: SqliteState; directory: string } {
  const root = directory ?? mkdtempSync(join(tmpdir(), 'pet-state-v3-'));
  if (!directory) roots.push(root);
  const state = new SqliteState({ dataDirectory: root });
  states.push(state);
  return { state, directory: root };
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function origin(id: string, principalId = 'alice', group?: string): CompanionInputOrigin {
  const audience: CompanionConversationAudience = group
    ? { kind: 'qq-group', account, groupId: group }
    : { kind: 'person-private', principalId };
  const actor = group
    ? { account, scene: 'group' as const, senderId: principalId, groupId: group }
    : { account, scene: 'private' as const, senderId: principalId };
  return {
    kind: 'qq',
    inputId: id,
    principalId,
    audience,
    actor,
    eventKey: `event-${id}`,
    messageId: `native-${id}`,
    trigger: 'direct',
    quote: null,
    route: {
      kind: 'qq',
      account,
      scene: group ? 'group' : 'private',
      targetId: group ?? principalId,
      reference: {
        eventId: null,
        messageId: `native-${id}`,
        occurredAt: Date.now(),
        displayReference: null,
      },
    },
    policyRevision: 1,
  };
}
function scope(o: CompanionInputOrigin): StateReadScope {
  return { kind: 'conversation', audience: o.audience, principalId: o.principalId };
}
function admit(state: SqliteState, o: CompanionInputOrigin, text = 'Current author text') {
  const id = o.inputId;
  if (!id) throw new Error('missing input id');
  value(
    state.createInput({
      id,
      commandId: `cmd-${id}`,
      origin: o,
      evidence: { originalText: text },
      materialIds: [],
    }),
  );
  const committed = value(state.commitInput({ id, text }));
  return committed;
}
function material(
  id: string,
  inputId: string,
  audience: CompanionConversationAudience,
  kind: CompanionMaterialRef['kind'] = 'file',
): CompanionMaterialRef {
  return {
    id,
    kind,
    audience,
    name: `${id}.txt`,
    mediaType: kind === 'voice' ? 'audio/silk' : 'text/plain',
    durationMs: kind === 'voice' ? 1000 : null,
    sizeBytes: 4,
    sha256: 'a'.repeat(64),
    originInputIds: [inputId],
  };
}
function storeMaterial(state: SqliteState, reference: CompanionMaterialRef): StoredMaterial {
  return value(
    state.putMaterial({
      id: reference.id,
      inputId: reference.originInputIds[0] ?? null,
      observationId: null,
      audience: reference.audience,
      phase: 'ready',
      reference,
      storageKey: `materials/${reference.id}`,
      cleanup: 'settled',
      error: null,
    }),
  );
}
function taskOrigin(o: CompanionInputOrigin, materialIds: string[] = []): CompanionTaskOrigin {
  if (!o.principalId) throw new Error('no task principal');
  return {
    inputId: o.inputId,
    principalId: o.principalId,
    audience: o.audience,
    route: o.route,
    origins: [o],
    materialIds,
  };
}
function delivery(state: SqliteState, id = 'delivery', optionalVoice = false): QQDeliveryView {
  const o = origin(`input-${id}`);
  admit(state, o);
  const message = value(
    state.appendMessage({
      id: `reply-${id}`,
      role: 'assistant',
      text: 'Complete reply',
      inputId: o.inputId,
      audience: o.audience,
      origins: [o],
    }),
  );
  if (o.route.kind !== 'qq') throw new Error('expected qq');
  const result: QQDeliveryView = {
    id,
    messageIds: [message.id],
    origins: [o],
    audience: o.audience,
    route: o.route,
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
        msgSeq: 1,
        upload: null,
        send: null,
      },
      ...(optionalVoice
        ? [
            {
              id: `${id}-voice`,
              index: 1,
              requirement: 'optional-voice' as const,
              content: { kind: 'voice' as const, messageIds: [message.id], material: null },
              preparation: 'pending' as const,
              error: null,
              msgSeq: 2,
              upload: null,
              send: null,
            },
          ]
        : []),
    ],
  };
  expect(isQQDeliveryView(result)).toBe(true);
  return value(state.createDelivery({ delivery: result }));
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
function accepted(a: QQDeliveryAttempt): QQDeliveryAttempt {
  return {
    ...a,
    phase: 'settled',
    outcome: 'accepted',
    cleanup: 'settled',
    settledAt: Date.now(),
    receipt: {
      messageId: a.operation === 'send' ? `remote-${a.id}` : null,
      fileId: a.operation !== 'send' ? `file-${a.id}` : null,
      transferId: null,
      sequence: null,
      sequenceAuthoritative: null,
    },
  };
}
afterEach(() => {
  for (const state of states.splice(0)) state.close();
  for (const root of roots.splice(0)) {
    const target = realpathSync(root);
    if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith('pet-state-v3-'))
      throw new Error('unexpected fixture path');
    rmSync(target, { recursive: true });
  }
});

describe('format three scoped facts and finite admissions', () => {
  it('checks owner preparing/ready capacity only after exact command retries and before any new writes', () => {
    const { state } = open();
    const original = { commandId: 'owner-original', text: 'original owner input' };
    const accepted = value(state.acceptMessage(original));
    const captured = accepted.message.origins?.[0];
    if (captured?.kind !== 'owner') throw new Error('missing canonical owner origin');
    value(
      state.createInput({
        id: 'owner-preparing',
        commandId: 'owner-preparing-command',
        origin: { ...captured, inputId: 'owner-preparing' },
        evidence: { originalText: 'preparing evidence' },
        materialIds: [],
      }),
    );
    for (let index = 2; index < COMPANION_INPUT_READY_PER_AUDIENCE; index++)
      value(state.acceptMessage({ commandId: `owner-queued-${index}`, text: 'queued' }));
    const before = value(state.snapshot({ scope: management }));
    const blocked = { commandId: 'owner-blocked', text: 'must not be committed while full' };
    expect(state.acceptMessage(blocked)).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
    expect(
      value(state.getCommand({ commandId: blocked.commandId, kind: 'message', payload: blocked })),
    ).toBeNull();
    expect(value(state.acceptMessage(original))).toEqual({
      receipt: { ...accepted.receipt, status: 'duplicate' },
      message: accepted.message,
    });
    expect(state.acceptMessage({ ...original, text: 'changed intent' })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(value(state.snapshot({ scope: management }))).toEqual(before);
    expect(value(state.claimInput({ id: accepted.message.id })).claimed).toBe(true);
    expect(value(state.acceptMessage(blocked)).receipt.status).toBe('accepted');
  });

  it('shares the global ready capacity across external and owner admissions without leaving rejected intents behind', () => {
    const { state } = open();
    const original = { commandId: 'owner-global-original', text: 'one owner input' };
    const accepted = value(state.acceptMessage(original));
    for (let index = 0; index < COMPANION_INPUT_READY_MAX - 1; index++) {
      const id = `foreign-preparing-${index}`;
      const o = origin(id, `person-${Math.floor(index / COMPANION_INPUT_READY_PER_AUDIENCE)}`);
      value(
        state.createInput({
          id,
          commandId: `command-${id}`,
          origin: o,
          evidence: { text: 'queued external evidence' },
          materialIds: [],
        }),
      );
    }
    const before = value(state.snapshot({ scope: management }));
    const blocked = { commandId: 'owner-global-blocked', text: 'no global slot' };
    expect(state.acceptMessage(blocked)).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
    expect(
      value(state.getCommand({ commandId: blocked.commandId, kind: 'message', payload: blocked })),
    ).toBeNull();
    expect(value(state.acceptMessage(original)).receipt).toEqual({
      ...accepted.receipt,
      status: 'duplicate',
    });
    expect(
      state.createInput({
        id: 'external-global-blocked',
        commandId: 'external-global-blocked',
        origin: origin('external-global-blocked', 'another-person'),
        evidence: {},
        materialIds: [],
      }),
    ).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
    expect(value(state.findInput({ id: 'external-global-blocked', scope: management }))).toBeNull();
    expect(value(state.snapshot({ scope: management }))).toEqual(before);
    value(state.updateInput({ id: 'foreign-preparing-0', phase: 'failed', cleanup: 'settled' }));
    expect(value(state.acceptMessage(blocked)).receipt.status).toBe('accepted');
  });
  it('finds canonical materials without confusing missing, foreign, expired or closed storage', () => {
    const { state } = open();
    const o = origin('material-reader', 'alice', 'material-group');
    const input = admit(state, o);
    const ownScope = scope(o);
    expect(value(state.findMaterial({ id: 'ready-reader', scope: ownScope }))).toBeNull();
    expect(state.getMaterial({ id: 'ready-reader', scope: ownScope })).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    const observation: StateObservation = {
      id: 'material-observation',
      audience: o.audience,
      principalId: o.principalId,
      observedAt: Date.now(),
      text: 'observed resource',
      quotedText: null,
      materialIds: [],
      fileEvidence: null,
    };
    value(state.observe({ observation }));
    const reference = material('ready-reader', input.admission.id, o.audience);
    const ready = value(
      state.putMaterial({
        id: reference.id,
        inputId: input.admission.id,
        observationId: observation.id,
        audience: o.audience,
        phase: 'ready',
        reference,
        storageKey: 'materials/ready-reader',
        cleanup: 'settled',
        error: null,
      }),
    );
    const pending = value(
      state.putMaterial({
        id: 'pending-reader',
        inputId: null,
        observationId: observation.id,
        audience: o.audience,
        phase: 'preparing',
        reference: null,
        storageKey: null,
        cleanup: 'pending',
        error: null,
      }),
    );
    const before = value(state.snapshot({ scope: management }));
    expect(value(state.findMaterial({ id: ready.id, scope: ownScope }))).toEqual(ready);
    expect(value(state.findMaterial({ id: pending.id, scope: ownScope }))).toEqual(pending);
    expect(
      state.findMaterial({ id: ready.id, scope: scope(origin('foreign', 'bob', 'other-group')) }),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(value(state.snapshot({ scope: management }))).toEqual(before);
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(observation.observedAt + QQ_GROUP_CONTEXT_MAX_AGE_MS + 1);
    try {
      expect(state.findMaterial({ id: pending.id, scope: ownScope })).toMatchObject({
        ok: false,
        error: { code: 'unavailable' },
      });
      expect(value(state.findMaterial({ id: ready.id, scope: ownScope }))).toEqual(ready);
      expect(value(state.snapshot({ scope: management }))).toEqual(before);
    } finally {
      clock.mockRestore();
    }
    state.close();
    expect(state.findMaterial({ id: ready.id, scope: ownScope })).toMatchObject({
      ok: false,
      error: { code: 'not-ready' },
    });
  });
  it('reads only exact-input same-audience notices in canonical order without changing author text', () => {
    const { state } = open();
    const o = origin('notices-input');
    const input = admit(state, o, 'Current author text');
    expect(value(state.inputNotices({ id: input.admission.id, scope: scope(o) }))).toEqual([]);
    const foreign = origin('foreign-notice', 'bob');
    admit(state, foreign);
    value(
      state.appendMessage({
        id: 'foreign-evidence',
        role: 'notice',
        text: 'private other person',
        inputId: o.inputId,
        audience: foreign.audience,
        origins: [foreign],
      }),
    );
    value(
      state.appendMessage({
        id: 'unrelated-evidence',
        role: 'notice',
        text: 'another input',
        inputId: 'other-input',
        audience: o.audience,
        origins: [o],
      }),
    );
    value(
      state.appendMessage({
        id: 'assistant-not-evidence',
        role: 'assistant',
        text: 'not a notice',
        inputId: o.inputId,
        audience: o.audience,
        origins: [o],
      }),
    );
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000000100);
    try {
      for (const id of ['note-b', 'note-a', 'note-d', 'note-c'])
        value(
          state.appendMessage({
            id,
            role: 'notice',
            text: `完整资料 ${id}`,
            inputId: o.inputId,
            audience: o.audience,
            origins: [o],
          }),
        );
      const before = value(state.snapshot({ scope: management }));
      expect(value(state.inputNotices({ id: input.admission.id, scope: scope(o) }))).toEqual(
        ['note-a', 'note-b', 'note-c', 'note-d'].map((id) => ({ id, text: `完整资料 ${id}` })),
      );
      expect(value(state.inputMessage({ id: input.admission.id, scope: scope(o) })).text).toBe(
        'Current author text',
      );
      expect(value(state.snapshot({ scope: management }))).toEqual(before);
      expect(state.inputNotices({ id: input.admission.id, scope: scope(foreign) })).toMatchObject({
        ok: false,
        error: { code: 'permission-denied' },
      });
      value(
        state.appendMessage({
          id: 'note-e',
          role: 'notice',
          text: 'fifth complete record',
          inputId: o.inputId,
          audience: o.audience,
          origins: [o],
        }),
      );
      expect(state.inputNotices({ id: input.admission.id, scope: scope(o) })).toMatchObject({
        ok: false,
        error: { code: 'quota-exceeded' },
      });
      expect(state.inputNotices({ id: 'missing-input', scope: management })).toMatchObject({
        ok: false,
        error: { code: 'unavailable' },
      });
    } finally {
      clock.mockRestore();
    }
  });

  it('returns complete notices at the 32KiB boundary and explicitly rejects larger evidence', () => {
    const { state } = open();
    const o = origin('notice-bytes');
    const input = admit(state, o);
    const first = { id: 'bytes-a', text: '字'.repeat(8000) };
    const base = [first, { id: 'bytes-b', text: '' }];
    const remaining = 32 * 1024 - Buffer.byteLength(JSON.stringify(base));
    const second = {
      id: 'bytes-b',
      text: '文'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3),
    };
    for (const note of [first, second])
      value(
        state.appendMessage({
          ...note,
          role: 'notice',
          inputId: o.inputId,
          audience: o.audience,
          origins: [o],
        }),
      );
    const notes = value(state.inputNotices({ id: input.admission.id, scope: scope(o) }));
    expect(notes).toEqual([first, second]);
    expect(Buffer.byteLength(JSON.stringify(notes))).toBe(32 * 1024);
    value(
      state.appendMessage({
        id: 'bytes-c',
        role: 'notice',
        text: 'x',
        inputId: o.inputId,
        audience: o.audience,
        origins: [o],
      }),
    );
    expect(state.inputNotices({ id: input.admission.id, scope: scope(o) })).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
  });
  it('finds captured inputs without treating missing, denied or unavailable storage as the same result', () => {
    const { state } = open();
    const original = origin('find-input');
    const ownScope = scope(original);
    expect(value(state.findInput({ id: 'find-input', scope: ownScope }))).toBeNull();
    expect(state.getInput({ id: 'find-input', scope: ownScope })).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    const command = {
      id: 'find-input',
      commandId: 'find-command',
      origin: original,
      evidence: { originalText: 'stable native evidence' },
      materialIds: [],
    };
    const accepted = value(state.createInput(command));
    const before = value(state.snapshot({ scope: management }));
    expect(value(state.findInput({ id: command.id, scope: ownScope }))).toEqual(accepted.admission);
    expect(
      state.findInput({ id: command.id, scope: scope(origin('foreign', 'bob')) }),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(value(state.snapshot({ scope: management }))).toEqual(before);
    const captured = value(state.findInput({ id: command.id, scope: management }));
    if (!captured) throw new Error('missing captured admission');
    expect(value(state.createInput({ ...command, origin: captured.origin })).receipt.status).toBe(
      'duplicate',
    );
    expect(captured.origin.policyRevision).toBe(1);
    state.close();
    expect(state.findInput({ id: command.id, scope: ownScope })).toMatchObject({
      ok: false,
      error: { code: 'not-ready' },
    });
  });
  it('enforces the exported exact message-record budget including CJK quotes and origins', () => {
    const { state } = open();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const source = origin('budget-input');
      if (source.kind !== 'qq' || source.route.kind !== 'qq' || !source.route.reference)
        throw new Error('missing qq origin');
      const quoted: CompanionInputOrigin = {
        ...source,
        quote: { reference: source.route.reference, quotedText: '引'.repeat(2048) },
      };
      const base = {
        id: 'budget-reply',
        role: 'assistant' as const,
        text: '',
        inputId: source.inputId,
        taskId: null,
        audience: source.audience,
        origins: [quoted],
        materials: [],
        content: { kind: 'inline-text' as const },
      };
      const available =
        STATE_MAX_MESSAGE_BYTES -
        Buffer.byteLength(JSON.stringify({ ...base, createdAt: Date.now() }));
      const text = '文'.repeat(Math.floor(available / 3)) + 'x'.repeat(available % 3);
      expect(STATE_MAX_MESSAGE_BYTES).toBe(28 * 1024);
      expect(text.length).toBeLessThanOrEqual(8000);
      expect(Buffer.byteLength(JSON.stringify({ ...base, text, createdAt: Date.now() }))).toBe(
        STATE_MAX_MESSAGE_BYTES,
      );
      expect(state.appendMessage({ ...base, text: `${text}x` })).toMatchObject({
        ok: false,
        error: { code: 'quota-exceeded' },
      });
      expect(value(state.snapshot({ scope: management }))).toMatchObject({
        cursor: 0,
        messages: [],
      });
      const accepted = value(state.appendMessage({ ...base, text }));
      expect(Buffer.byteLength(JSON.stringify(accepted))).toBe(STATE_MAX_MESSAGE_BYTES);
      expect(value(state.appendMessage({ ...base, text }))).toEqual(accepted);
      expect(value(state.snapshot({ scope: management })).cursor).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('preserves old owner command fingerprints and adds same-id ready admissions without changing receipt shapes', () => {
    const { state, directory } = open();
    const command = { commandId: 'owner-command', text: 'hello' };
    const first = value(state.acceptMessage(command));
    const input = value(
      state.getInput({
        id: first.message.id,
        scope: { kind: 'conversation', audience: { kind: 'owner-private' }, principalId: 'owner' },
      }),
    );
    expect(isCompanionInputAdmission(input)).toBe(true);
    expect(input).toMatchObject({
      id: first.message.id,
      messageId: first.message.id,
      phase: 'ready',
      origin: { kind: 'owner', inputId: first.message.id },
    });
    expect(first.message.inputId).toBe(command.commandId);
    expect(value(state.inputMessage({ id: input.id, scope: management }))).toEqual(first.message);
    expect(state.inputMessage({ id: input.id, scope: scope(origin('foreign', 'bob')) }).ok).toBe(
      false,
    );
    const directTask = value(
      state.createTask({ commandId: 'direct-owner-task', title: 'direct', code: 'direct()' }),
    ).task;
    expect(directTask.origin).toEqual({
      inputId: null,
      principalId: 'owner',
      audience: { kind: 'owner-private' },
      route: { kind: 'owner-private' },
      origins: [],
      materialIds: [],
    });
    expect(value(state.acceptMessage(command)).receipt).toEqual({
      ...first.receipt,
      status: 'duplicate',
    });
    state.close();
    const db = new DatabaseSync(join(directory, 'state.sqlite'));
    try {
      const expected = createHash('sha256')
        .update('{"kind":"message","payload":{"commandId":"owner-command","text":"hello"}}')
        .digest('hex');
      expect(
        db.prepare('SELECT fingerprint FROM commands WHERE id=?').get(command.commandId)?.[
          'fingerprint'
        ],
      ).toBe(expected);
    } finally {
      db.close();
    }
  });

  it('keeps empty material selections identical to legacy task fingerprints and immutable intent', () => {
    const { state, directory } = open();
    const command = { commandId: 'legacy-materials', title: 'Legacy', code: 'work()' };
    const accepted = value(state.createTask({ ...command, materials: [] }));
    expect(value(state.createTask(command)).receipt).toEqual({
      ...accepted.receipt,
      status: 'duplicate',
    });
    expect(value(state.createTask({ ...command, materials: [] })).receipt.status).toBe('duplicate');
    const absentFirst = { ...command, commandId: 'absent-first' };
    value(state.createTask(absentFirst));
    expect(value(state.createTask({ ...absentFirst, materials: [] })).receipt.status).toBe(
      'duplicate',
    );
    state.close();
    const db = new DatabaseSync(join(directory, 'state.sqlite'));
    try {
      const expected = createHash('sha256')
        .update(
          '{"kind":"task","payload":{"code":"work()","commandId":"legacy-materials","title":"Legacy"}}',
        )
        .digest('hex');
      expect(
        db.prepare('SELECT fingerprint FROM commands WHERE id=?').get(command.commandId)?.[
          'fingerprint'
        ],
      ).toBe(expected);
      expect(
        db.prepare('SELECT command FROM tasks WHERE id=?').get(accepted.task.id)?.['command'],
      ).toBe(JSON.stringify(command));
    } finally {
      db.close();
    }
  });

  it('persists named material selections and conflicts when an existing effect renames its input', () => {
    const { state, directory } = open();
    const o = origin('selected-input');
    admit(state, o);
    storeMaterial(state, material('one', 'selected-input', o.audience));
    storeMaterial(state, material('two', 'selected-input', o.audience));
    const selections = [
      { materialId: 'one', inputName: 'inputs/source.bin' },
      { materialId: 'two', inputName: 'inputs/extra.bin' },
    ];
    const command = {
      commandId: 'named-materials',
      title: 'Read materials',
      code: 'read()',
      origin: taskOrigin(o, ['one', 'two']),
      materials: selections,
    };
    const accepted = value(state.createTask(command));
    expect(accepted.task.origin?.materialIds).toEqual(['one', 'two']);
    const cursor = value(state.snapshot({ scope: management })).cursor;
    expect(value(state.createTask(command)).receipt.status).toBe('duplicate');
    expect(
      state.createTask({
        ...command,
        materials: [
          { materialId: 'one', inputName: 'renamed.bin' },
          { materialId: 'two', inputName: 'inputs/extra.bin' },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    for (const inputName of [
      '../escape',
      '/absolute',
      'a/../b',
      'a//b',
      'C:/escape',
      'a\\b',
      'a/./b',
      'x'.repeat(241),
    ]) {
      expect(
        state.createTask({
          ...command,
          commandId: 'bad-name',
          materials: [
            { materialId: 'one', inputName },
            { materialId: 'two', inputName: 'valid.bin' },
          ],
        }).ok,
      ).toBe(false);
    }
    expect(
      state.createTask({
        ...command,
        commandId: 'duplicate-id',
        materials: [
          { materialId: 'one', inputName: 'a.bin' },
          { materialId: 'one', inputName: 'b.bin' },
        ],
      }).ok,
    ).toBe(false);
    expect(
      state.createTask({
        ...command,
        commandId: 'duplicate-name',
        materials: [
          { materialId: 'one', inputName: 'a.bin' },
          { materialId: 'two', inputName: 'a.bin' },
        ],
      }).ok,
    ).toBe(false);
    expect(
      state.createTask({
        ...command,
        commandId: 'mismatched-origin',
        origin: taskOrigin(o, ['one']),
      }).ok,
    ).toBe(false);
    expect(
      state.invoke('createTask', {
        commandId: 'missing-origin',
        title: 'Read',
        code: 'read()',
        materials: selections,
      }).ok,
    ).toBe(false);
    expect(
      state.createTask({
        ...command,
        commandId: 'inline-collision',
        files: [{ path: 'inputs/source.bin', content: 'shadow' }],
      }).ok,
    ).toBe(false);
    expect(value(state.snapshot({ scope: management })).cursor).toBe(cursor);
    state.close();
    const db = new DatabaseSync(join(directory, 'state.sqlite'));
    try {
      expect(
        db.prepare('SELECT command FROM tasks WHERE id=?').get(accepted.task.id)?.['command'],
      ).toBe(JSON.stringify(command));
    } finally {
      db.close();
    }
  });

  it('keeps preparing media out of canonical text and claims one input exactly once', () => {
    const { state } = open();
    const o = origin('voice-input');
    const request = {
      id: 'voice-input',
      commandId: 'voice-command',
      origin: o,
      evidence: { attachmentHash: 'a'.repeat(64), quotedText: 'remember a secret' },
      materialIds: ['voice'],
    };
    const first = value(state.createInput(request));
    expect(first.admission).toMatchObject({ phase: 'preparing', messageId: null });
    expect(state.inputMessage({ id: request.id, scope: scope(o) })).toMatchObject({
      ok: false,
      error: { code: 'not-ready' },
    });
    expect(value(state.snapshot({ scope: scope(o) })).messages).toEqual([]);
    expect(value(state.createInput(request)).receipt.status).toBe('duplicate');
    expect(
      state.createInput({ ...request, evidence: { attachmentHash: 'changed' } }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(state.commitInput({ id: request.id, text: 'transcript' }).ok).toBe(false);
    storeMaterial(state, material('voice', request.id, o.audience, 'voice'));
    const committed = value(state.commitInput({ id: request.id, text: 'transcript' }));
    expect(committed.message.id).toBe(request.id);
    expect(committed.message.inputId).toBe(request.commandId);
    expect(value(state.claimInput({ id: request.id })).claimed).toBe(true);
    expect(value(state.claimInput({ id: request.id })).claimed).toBe(false);
    expect(value(state.commitInput({ id: request.id, text: 'transcript' })).admission.phase).toBe(
      'active',
    );
    expect(state.commitInput({ id: request.id, text: 'different' }).ok).toBe(false);
    value(state.updateInput({ id: request.id, phase: 'completed', cleanup: 'settled' }));
    const stored = value(state.getMaterial({ id: 'voice', scope: scope(o) }));
    value(
      state.putMaterial({ ...stored, phase: 'released', storageKey: null, cleanup: 'settled' }),
    );
    expect(value(state.commitInput({ id: request.id, text: 'transcript' })).message.id).toBe(
      request.id,
    );
    expect(value(state.claimInput({ id: request.id })).claimed).toBe(false);
    expect(state.updateInput({ id: request.id, phase: 'ready', cleanup: 'pending' }).ok).toBe(
      false,
    );
    expect(state.invoke('createInput', { ...request, origin: undefined }).ok).toBe(false);
  });

  it('filters private people and groups before limits, task ownership and exact message-event reads', () => {
    const { state } = open();
    const alice = origin('alice-input'),
      bob = origin('bob-input', 'bob');
    const groupA = origin('group-a-input', 'alice', 'group-a'),
      groupB = origin('group-b-input', 'bob', 'group-b');
    for (const o of [alice, bob, groupA, groupB]) {
      admit(state, o, `${o.inputId} canary`);
      value(state.updateInput({ id: o.inputId ?? '', phase: 'completed', cleanup: 'settled' }));
    }
    for (let index = 0; index < 20; index++)
      value(
        state.appendMessage({
          id: `bob-reply-${index}`,
          role: 'assistant',
          text: 'bob private tail',
          audience: bob.audience,
          origins: [bob],
        }),
      );
    expect(value(state.snapshot({ scope: scope(alice), messageLimit: 1 })).messages[0]?.text).toBe(
      'alice-input canary',
    );
    expect(value(state.snapshot()).messages).toEqual([]);
    expect(
      value(state.snapshot({ scope: scope(groupA) })).messages.map((item) => item.text),
    ).toEqual(['group-a-input canary']);
    const aTask = value(
      state.createTask({
        commandId: 'alice-task',
        title: 'a',
        code: 'a()',
        origin: taskOrigin(groupA),
      }),
    ).task;
    const bGroupOrigin = origin('bob-group-a', 'bob', 'group-a');
    admit(state, bGroupOrigin);
    value(
      state.createTask({
        commandId: 'bob-task',
        title: 'b',
        code: 'b()',
        origin: taskOrigin(bGroupOrigin),
      }),
    );
    expect(value(state.snapshot({ scope: scope(groupA) })).tasks.map((item) => item.id)).toEqual([
      aTask.id,
    ]);
    expect(state.getTask({ id: aTask.id, scope: scope(bGroupOrigin) })).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });
    const events = value(
      state.events({
        after: 0,
        epoch: value(state.snapshot()).epoch,
        scope: scope(alice),
        limit: 1,
      }),
    );
    expect(JSON.stringify(events)).not.toContain('bob');
    const messageEvent = value(
      state.events({ after: events.cursor, epoch: events.epoch, scope: scope(alice) }),
    ).events.find((event) => event.kind === 'message');
    if (!messageEvent) throw new Error('missing message event');
    expect(
      value(
        state.getMessage({
          id: 'alice-input',
          eventSequence: messageEvent.sequence,
          scope: scope(alice),
        }),
      ).text,
    ).toBe('alice-input canary');
    expect(
      state.getMessage({
        id: 'alice-input',
        eventSequence: messageEvent.sequence,
        scope: scope(bob),
      }).ok,
    ).toBe(false);
    expect(
      state.getMessage({ id: 'bob-input', eventSequence: messageEvent.sequence, scope: management })
        .ok,
    ).toBe(false);
  });

  it('keeps scoped fact keys independent with global CAS and public facts only in projections', () => {
    const { state } = open();
    const alice = origin('a'),
      bob = origin('b', 'bob');
    for (const [index, audience] of [
      alice.audience,
      bob.audience,
      { kind: 'public' as const },
    ].entries()) {
      value(
        state.rememberFact({
          commandId: `fact-${index}`,
          key: 'same-key',
          value: `scope-${index}`,
          audience,
          expectedMemoryRevision: index,
          expectedFactRevision: 0,
          origin: { kind: 'owner-form' },
        }),
      );
    }
    expect(
      value(state.memorySnapshot({ scope: scope(alice) })).facts.map((fact) => fact.value),
    ).toEqual(['scope-0', 'scope-2']);
    expect(
      value(state.memorySnapshot({ scope: scope(bob) })).facts.map((fact) => fact.value),
    ).toEqual(['scope-1', 'scope-2']);
    expect(value(state.memorySnapshot()).facts.map((fact) => fact.value)).toEqual(['scope-2']);
    expect(value(state.memorySnapshot({ scope: management })).facts).toHaveLength(3);
    expect(
      state.forgetFact({
        commandId: 'wrong-cas',
        key: 'same-key',
        audience: alice.audience,
        expectedMemoryRevision: 2,
        expectedFactRevision: 1,
        origin: { kind: 'owner-form' },
      }).ok,
    ).toBe(false);
    value(
      state.forgetFact({
        commandId: 'forget-alice',
        key: 'same-key',
        audience: alice.audience,
        expectedMemoryRevision: 3,
        expectedFactRevision: 1,
        origin: { kind: 'owner-form' },
      }),
    );
    expect(value(state.memorySnapshot({ scope: scope(bob) })).facts).toHaveLength(2);
  });

  it('retains material locators only in authorized internal reads and never in public projections', () => {
    const { state } = open();
    const o = origin('material-input');
    value(
      state.createInput({
        id: 'material-input',
        commandId: 'material-command',
        origin: o,
        evidence: { text: 'use image' },
        materialIds: ['attachment'],
      }),
    );
    const reference = material('attachment', 'material-input', o.audience);
    storeMaterial(state, reference);
    value(state.commitInput({ id: 'material-input', text: 'use file', materials: [reference] }));
    expect(value(state.getMaterial({ id: reference.id, scope: scope(o) })).storageKey).toBe(
      'materials/attachment',
    );
    expect(state.getMaterial({ id: reference.id, scope: scope(origin('other', 'bob')) }).ok).toBe(
      false,
    );
    expect(state.invoke('getMaterial', { id: reference.id }).ok).toBe(false);
    const publicRecords = JSON.stringify(value(state.snapshot({ scope: scope(o) })));
    expect(publicRecords).not.toContain('storageKey');
    expect(publicRecords).not.toContain('materials/attachment');
    expect(
      state.putMaterial({
        ...value(state.getMaterial({ id: reference.id, scope: scope(o) })),
        storageKey: '../secret',
      }).ok,
    ).toBe(false);
  });

  it('bounds pending admissions per audience and active claims without spending capacity on duplicates', () => {
    const { state } = open();
    const requests = Array.from({ length: 4 }, (_, index) => ({
      id: `queued-${index}`,
      commandId: `queued-command-${index}`,
      origin: origin(`queued-${index}`),
      evidence: { text: 'queued' },
      materialIds: [],
    }));
    for (const request of requests) value(state.createInput(request));
    const first = requests[0];
    if (!first) throw new Error('missing request');
    expect(value(state.createInput(first)).receipt.status).toBe('duplicate');
    expect(
      state.createInput({
        ...first,
        id: 'overflow',
        commandId: 'overflow-command',
        origin: origin('overflow'),
      }),
    ).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
    for (const request of requests) {
      value(state.commitInput({ id: request.id, text: 'queued' }));
      expect(value(state.claimInput({ id: request.id })).claimed).toBe(true);
    }
    admit(state, origin('fifth', 'bob'));
    expect(state.claimInput({ id: 'fifth' })).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
    value(state.updateInput({ id: first.id, phase: 'completed', cleanup: 'settled' }));
    expect(value(state.claimInput({ id: 'fifth' })).claimed).toBe(true);
  });

  it('recovers preparing/ready/active states as uncertain without another claim or execution', () => {
    const initial = open();
    const a = origin('ready'),
      b = origin('active', 'bob');
    admit(initial.state, a);
    admit(initial.state, b);
    value(initial.state.claimInput({ id: 'active' }));
    const preparing = origin('preparing', 'charlie');
    value(
      initial.state.createInput({
        id: 'preparing',
        commandId: 'preparing-command',
        origin: preparing,
        evidence: { text: 'voice' },
        materialIds: [],
      }),
    );
    initial.state.close();
    const { state } = open(initial.directory);
    const first = value(state.recover({ limit: 2 }));
    expect(first.hasMore).toBe(true);
    value(state.recover({ limit: 2 }));
    expect(value(state.getInput({ id: 'active', scope: management })).phase).toBe('unknown');
    expect(value(state.getInput({ id: 'ready', scope: management })).phase).toBe('interrupted');
    expect(value(state.getInput({ id: 'preparing', scope: management })).messageId).toBeNull();
    expect(value(state.claimInput({ id: 'active' })).claimed).toBe(false);
    expect(value(state.claimInput({ id: 'ready' })).claimed).toBe(false);
    const cursor = value(state.snapshot()).cursor;
    expect(value(state.recover()).hasMore).toBe(false);
    expect(value(state.snapshot()).cursor).toBe(cursor);
  });

  it('rolls admission, command and event writes back together on failure', () => {
    const initial = open();
    initial.state.close();
    const db = new DatabaseSync(join(initial.directory, 'state.sqlite'));
    db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'test'); END;",
    );
    db.close();
    const { state } = open(initial.directory);
    expect(
      state.createInput({
        id: 'rollback',
        commandId: 'rollback-command',
        origin: origin('rollback'),
        evidence: {},
        materialIds: [],
      }).ok,
    ).toBe(false);
    expect(state.getInput({ id: 'rollback', scope: management }).ok).toBe(false);
    expect(value(state.snapshot({ scope: management })).cursor).toBe(0);
    state.close();
    const repair = new DatabaseSync(join(initial.directory, 'state.sqlite'));
    repair.exec('DROP TRIGGER fail_event');
    repair.close();
    const preparedState = open(initial.directory).state;
    value(
      preparedState.createInput({
        id: 'rollback',
        commandId: 'rollback-command',
        origin: origin('rollback'),
        evidence: {},
        materialIds: [],
      }),
    );
    preparedState.close();
    const fault = new DatabaseSync(join(initial.directory, 'state.sqlite'));
    fault.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'test'); END;",
    );
    fault.close();
    const failedCommit = open(initial.directory).state;
    expect(failedCommit.commitInput({ id: 'rollback', text: 'complete text' }).ok).toBe(false);
    expect(value(failedCommit.getInput({ id: 'rollback', scope: management }))).toMatchObject({
      phase: 'preparing',
      messageId: null,
    });
    expect(value(failedCommit.snapshot({ scope: management }))).toMatchObject({
      cursor: 1,
      messages: [],
    });
  });
});

describe('finite delivery and context-only observations', () => {
  it('records one claim, preserves accepted text and rejects unknown or accepted retries', () => {
    const { state } = open();
    const prepared = delivery(state, 'first');
    const a = attempt('send-first');
    const claimed = value(
      state.claimDeliveryAttempt({ id: prepared.id, partId: 'first-text', attempt: a }),
    );
    expect(claimed.claimed).toBe(true);
    expect(
      value(state.claimDeliveryAttempt({ id: prepared.id, partId: 'first-text', attempt: a }))
        .claimed,
    ).toBe(false);
    const complete = {
      ...claimed.delivery,
      phase: 'terminal' as const,
      outcome: 'accepted' as const,
      parts: claimed.delivery.parts.map((part) => ({ ...part, send: accepted(a) })),
    };
    value(state.updateDelivery({ delivery: complete }));
    expect(value(state.createDelivery({ delivery: prepared })).outcome).toBe('accepted');
    expect(
      value(state.claimDeliveryAttempt({ id: prepared.id, partId: 'first-text', attempt: a }))
        .claimed,
    ).toBe(false);
    expect(
      state.claimDeliveryAttempt({
        id: prepared.id,
        partId: 'first-text',
        attempt: attempt('different'),
      }).ok,
    ).toBe(false);
    expect(state.updateDelivery({ delivery: prepared }).ok).toBe(false);
    expect(state.getDelivery({ id: prepared.id, scope: scope(origin('b', 'bob')) }).ok).toBe(false);
    expect(value(state.deliveries({ scope: scope(origin('b', 'bob')) })).deliveries).toEqual([]);
  });

  it('requires mandatory text acceptance before voice and does not mistake upload for sent', () => {
    const { state } = open();
    const prepared = delivery(state, 'voice-delivery', true);
    const o = prepared.origins[0];
    if (!o || !o.inputId) throw new Error('missing origin');
    const ref = material('outgoing-voice', o.inputId, prepared.audience, 'voice');
    storeMaterial(state, ref);
    const voiceReady = {
      ...prepared,
      parts: prepared.parts.map((part) =>
        part.content.kind === 'voice'
          ? { ...part, preparation: 'ready' as const, content: { ...part.content, material: ref } }
          : part,
      ),
    };
    expect(state.updateDelivery({ delivery: voiceReady }).ok).toBe(false);
    const send = attempt('text-accept');
    const claimed = value(
      state.claimDeliveryAttempt({ id: prepared.id, partId: 'voice-delivery-text', attempt: send }),
    ).delivery;
    expect(
      state.updateDelivery({
        delivery: {
          ...claimed,
          parts: claimed.parts.map((part) =>
            part.requirement === 'mandatory-text'
              ? { ...part, send: accepted(send) }
              : part.content.kind === 'voice'
                ? { ...part, preparation: 'ready', content: { ...part.content, material: ref } }
                : part,
          ),
        },
      }).ok,
    ).toBe(false);
    const textAccepted = value(
      state.updateDelivery({
        delivery: {
          ...claimed,
          parts: claimed.parts.map((part) =>
            part.requirement === 'mandatory-text' ? { ...part, send: accepted(send) } : part,
          ),
        },
      }),
    );
    const ready = value(
      state.updateDelivery({
        delivery: {
          ...textAccepted,
          parts: textAccepted.parts.map((part) =>
            part.content.kind === 'voice'
              ? { ...part, preparation: 'ready', content: { ...part.content, material: ref } }
              : part,
          ),
        },
      }),
    );
    const upload = attempt('upload-voice', 'upload');
    const uploaded = value(
      state.claimDeliveryAttempt({ id: ready.id, partId: 'voice-delivery-voice', attempt: upload }),
    ).delivery;
    const uploadAccepted = {
      ...uploaded,
      parts: uploaded.parts.map((part) =>
        part.requirement === 'optional-voice' ? { ...part, upload: accepted(upload) } : part,
      ),
    };
    expect(
      state.updateDelivery({
        delivery: { ...uploadAccepted, phase: 'terminal', outcome: 'accepted' },
      }).ok,
    ).toBe(false);
    const recorded = value(state.updateDelivery({ delivery: uploadAccepted }));
    expect(recorded.outcome).toBe('pending');
    expect(recorded.parts[0]?.send?.outcome).toBe('accepted');
    expect(recorded.parts[1]?.send).toBeNull();
    const cursor = value(state.snapshot()).cursor;
    expect(
      value(state.updateDelivery({ delivery: { ...recorded, updatedAt: recorded.updatedAt + 1 } })),
    ).toEqual(recorded);
    expect(value(state.snapshot()).cursor).toBe(cursor);
    const stored = value(state.getMaterial({ id: ref.id, scope: management }));
    value(
      state.putMaterial({ ...stored, phase: 'released', cleanup: 'settled', storageKey: null }),
    );
    const voiceSend = attempt('voice-send');
    const finalClaim = value(
      state.claimDeliveryAttempt({
        id: recorded.id,
        partId: 'voice-delivery-voice',
        attempt: voiceSend,
      }),
    ).delivery;
    const final = value(
      state.updateDelivery({
        delivery: {
          ...finalClaim,
          phase: 'terminal',
          outcome: 'accepted',
          parts: finalClaim.parts.map((part) =>
            part.requirement === 'optional-voice' ? { ...part, send: accepted(voiceSend) } : part,
          ),
        },
      }),
    );
    expect(final.outcome).toBe('accepted');
  });

  it('recovers dispatched delivery as unknown, preserving accepted earlier parts and frozen text', () => {
    const initial = open();
    const prepared = delivery(initial.state, 'unknown');
    const a = attempt('unknown-attempt');
    const claimed = value(
      initial.state.claimDeliveryAttempt({ id: prepared.id, partId: 'unknown-text', attempt: a }),
    ).delivery;
    value(
      initial.state.updateDelivery({
        delivery: {
          ...claimed,
          parts: claimed.parts.map((part) => ({ ...part, send: { ...a, phase: 'dispatched' } })),
        },
      }),
    );
    initial.state.close();
    const { state } = open(initial.directory);
    value(state.recover());
    const recovered = value(state.getDelivery({ id: prepared.id, scope: management }));
    expect(recovered).toMatchObject({
      phase: 'terminal',
      outcome: 'unknown',
      parts: [{ send: { id: a.id, phase: 'settled', outcome: 'unknown' } }],
    });
    expect(
      value(state.claimDeliveryAttempt({ id: prepared.id, partId: 'unknown-text', attempt: a }))
        .claimed,
    ).toBe(false);
    expect(
      state.claimDeliveryAttempt({
        id: prepared.id,
        partId: 'unknown-text',
        attempt: attempt('retry'),
      }).ok,
    ).toBe(false);
    const changed = {
      ...recovered,
      parts: recovered.parts.map((part) => ({
        ...part,
        content: {
          kind: 'inline-text' as const,
          text: 'different',
          sha256: createHash('sha256').update('different').digest('hex'),
        },
      })),
    };
    expect(state.updateDelivery({ delivery: changed }).ok).toBe(false);
  });

  it('keeps complete ordered say text separated by the shared separator', () => {
    const { state } = open();
    const first = delivery(state, 'two-say');
    const o = first.origins[0];
    if (!o) throw new Error('missing origin');
    const second = value(
      state.appendMessage({
        id: 'second-say',
        role: 'assistant',
        text: 'Second reply',
        audience: o.audience,
        origins: [o],
      }),
    );
    const combined = ['Complete reply', second.text].join(QQ_REPLY_TEXT_SEPARATOR);
    const updated: QQDeliveryView = {
      ...first,
      id: 'combined',
      messageIds: [...first.messageIds, second.id],
      parts: [
        {
          ...first.parts[0],
          id: 'combined-part',
          index: 0,
          requirement: 'mandatory-text',
          preparation: 'ready',
          error: null,
          msgSeq: 1,
          upload: null,
          send: null,
          content: {
            kind: 'inline-text',
            text: combined,
            sha256: createHash('sha256').update(combined).digest('hex'),
          },
        },
      ],
    };
    expect(value(state.createDelivery({ delivery: updated })).messageIds).toHaveLength(2);
    expect(
      state.createDelivery({ delivery: { ...updated, id: 'lossy', parts: first.parts } }).ok,
    ).toBe(false);
  });

  it('deduplicates later receipt times without changing the first observation time, content or TTL', () => {
    const initial = open();
    const o = origin('observed-input', 'alice', 'observed-group');
    const firstSeen = Date.now() - 1000;
    const observation: StateObservation = {
      id: 'native-resource-id',
      audience: o.audience,
      principalId: o.principalId,
      observedAt: firstSeen,
      text: 'original native content',
      quotedText: 'separate quote',
      materialIds: [],
      fileEvidence: null,
    };
    value(initial.state.observe({ observation }));
    initial.state.close();
    // Retained observations written before the fix have a timestamp-inclusive fingerprint.
    const db = new DatabaseSync(join(initial.directory, 'state.sqlite'));
    db.prepare('UPDATE conversation_observations SET fingerprint=? WHERE id=?').run(
      fingerprint(observation),
      observation.id,
    );
    db.close();
    const { state } = open(initial.directory);
    const before = value(state.snapshot({ scope: management }));
    expect(
      value(state.observe({ observation: { ...observation, observedAt: Date.now() } })),
    ).toEqual({ observation, duplicate: true, retained: true });
    expect(value(state.getObservation({ id: observation.id, scope: scope(o) }))).toEqual(
      observation,
    );
    expect(value(state.snapshot({ scope: management }))).toEqual(before);
    expect(
      state.observe({
        observation: { ...observation, observedAt: Date.now(), text: 'changed native body' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(
      state.observe({
        observation: { ...observation, observedAt: Date.now(), quotedText: 'changed quote' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(value(state.snapshot({ scope: management }))).toEqual(before);
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(firstSeen + QQ_GROUP_CONTEXT_MAX_AGE_MS + 1);
    try {
      expect(
        value(state.observe({ observation: { ...observation, observedAt: Date.now() } })),
      ).toEqual({ observation, duplicate: true, retained: false });
      expect(state.getObservation({ id: observation.id, scope: scope(o) })).toMatchObject({
        ok: false,
        error: { code: 'unavailable' },
      });
      expect(value(state.snapshot({ scope: management })).cursor).toBe(before.cursor);
    } finally {
      clock.mockRestore();
    }
  });

  it('bounds context-only observations, separates quotes, and preserves ready materials after pruning', () => {
    const { state } = open();
    const o = origin('obs-input', 'alice', 'group-a');
    const baseline: StateObservation = {
      id: 'notice',
      audience: o.audience,
      principalId: 'alice',
      observedAt: Date.now(),
      text: 'uploaded a file',
      quotedText: 'remember this quoted secret',
      materialIds: [],
      fileEvidence: {
        kind: 'qq-file',
        account,
        groupId: 'group-a',
        fileId: 'remote-file',
        busId: null,
        name: 'input.txt',
        reportedSize: 4,
      },
    };
    expect(value(state.observe({ observation: baseline })).retained).toBe(true);
    expect(value(state.observe({ observation: baseline })).duplicate).toBe(true);
    expect(state.observe({ observation: { ...baseline, text: 'changed' } }).ok).toBe(false);
    expect(value(state.snapshot({ scope: management })).messages).toEqual([]);
    expect(state.getInput({ id: baseline.id, scope: management }).ok).toBe(false);
    expect(value(state.observations({ scope: scope(o) })).observations[0]?.quotedText).toBe(
      baseline.quotedText,
    );
    expect(value(state.getObservation({ id: baseline.id, scope: scope(o) }))).toEqual(baseline);
    expect(state.getObservation({ id: baseline.id, scope: scope(origin('b', 'bob')) }).ok).toBe(
      false,
    );
    value(
      state.putMaterial({
        id: 'unloaded',
        inputId: null,
        observationId: baseline.id,
        audience: o.audience,
        phase: 'preparing',
        reference: null,
        storageKey: null,
        cleanup: 'pending',
        error: null,
      }),
    );
    value(
      state.putMaterial({
        id: 'staged',
        inputId: null,
        observationId: baseline.id,
        audience: o.audience,
        phase: 'preparing',
        reference: null,
        storageKey: null,
        cleanup: 'pending',
        error: null,
      }),
    );
    admit(state, o);
    const ref = material('staged', 'obs-input', o.audience);
    value(
      state.putMaterial({
        id: 'staged',
        inputId: 'obs-input',
        observationId: baseline.id,
        audience: o.audience,
        phase: 'ready',
        reference: ref,
        storageKey: 'materials/staged',
        cleanup: 'settled',
        error: null,
      }),
    );
    value(state.pruneObservations({ now: Date.now() + QQ_GROUP_CONTEXT_MAX_AGE_MS + 1 }));
    expect(value(state.getMaterial({ id: 'staged', scope: scope(o) })).phase).toBe('ready');
    expect(state.getObservation({ id: baseline.id, scope: scope(o) })).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    expect(state.getMaterial({ id: 'unloaded', scope: scope(o) })).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    for (let index = 0; index < 40; index++)
      value(
        state.observe({
          observation: {
            ...baseline,
            id: `observation-${index}`,
            fileEvidence: null,
            text: `context-${index}`,
          },
        }),
      );
    const page = value(state.observations({ scope: scope(o) }));
    expect(page.observations).toHaveLength(30);
    expect(Buffer.byteLength(JSON.stringify(page.observations))).toBeLessThanOrEqual(12 * 1024);
    expect(
      value(state.observations({ scope: scope(origin('other-group', 'alice', 'group-b')) }))
        .observations,
    ).toEqual([]);
    expect(
      state.invoke('observe', {
        observation: {
          ...baseline,
          id: 'unsafe-evidence',
          fileEvidence: { ...baseline.fileEvidence, url: 'https://signed.invalid' },
        },
      }).ok,
    ).toBe(false);
  });
});
