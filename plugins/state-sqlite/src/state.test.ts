import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { JSON_MAX_BYTES, makeError } from '@pet/contracts';
import type { Result, CompanionMemoryUpsertCommand } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { SqliteState } from './state.js';
import { STATE_MAX_FACTS, STATE_MAX_RESULT_BYTES } from './types.js';
import type { StoredArtifact } from './types.js';

const roots: string[] = [];
const stores: SqliteState[] = [];

function open(dataDirectory?: string): { state: SqliteState; directory: string } {
  const directory = dataDirectory ?? mkdtempSync(join(tmpdir(), 'pet-state-sqlite-test-'));
  if (!dataDirectory) roots.push(directory);
  const state = new SqliteState({ dataDirectory: directory });
  stores.push(state);
  return { state, directory };
}

function value<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function factInput(
  state: SqliteState,
  input: { commandId: string; key: string; value: string; expectedFactRevision?: number },
): CompanionMemoryUpsertCommand & { origin: { kind: 'owner-form' } } {
  const memory = value(state.memorySnapshot());
  return {
    ...input,
    expectedMemoryRevision: memory.memoryRevision,
    expectedFactRevision:
      input.expectedFactRevision ??
      memory.facts.find((fact) => fact.key === input.key)?.revision ??
      0,
    origin: { kind: 'owner-form' },
  };
}

function task(state: SqliteState, commandId = 'work') {
  return value(state.createTask({ commandId, title: 'Produce a file', code: 'writeFile()' })).task;
}

function artifact(taskId: string, id = 'output'): StoredArtifact {
  return {
    id,
    taskId,
    name: 'result.txt',
    mediaType: 'text/plain',
    sizeBytes: 5,
    provider: 'docker',
    relativePath: `${taskId}/result.txt`,
  };
}

afterEach(() => {
  for (const state of stores.splice(0)) state.close();
  for (const directory of roots.splice(0)) {
    const target = realpathSync(directory);
    if (
      dirname(target) !== realpathSync(tmpdir()) ||
      !basename(target).startsWith('pet-state-sqlite-test-')
    )
      throw new Error('unexpected-test-directory');
    rmSync(target, { recursive: true });
  }
});

describe('SqliteState', () => {
  it('cannot resurrect a forgotten fact through replay or delete/recreate ABA', () => {
    const { state } = open();
    const create = factInput(state, { commandId: 'create-memory', key: 'language', value: '中文' });
    const first = value(state.rememberFact(create));
    const forget = {
      commandId: 'forget-memory',
      key: 'language',
      expectedMemoryRevision: first.memory.memoryRevision,
      expectedFactRevision: first.fact?.revision ?? 0,
      origin: { kind: 'owner-form' as const },
    };
    value(state.forgetFact(forget));
    const afterForget = value(state.snapshot());
    const duplicate = value(state.rememberFact(create));
    expect(duplicate.receipt.status).toBe('duplicate');
    expect(duplicate.committedRevision).toBe(first.committedRevision);
    expect(duplicate.fact).toBeNull();
    expect(value(state.snapshot())).toEqual(afterForget);
    const added = value(
      state.rememberFact(
        factInput(state, { commandId: 'recreate-memory', key: 'language', value: 'English' }),
      ),
    );
    expect(added.fact?.revision).toBeGreaterThan(first.fact?.revision ?? 0);
    expect(
      state.rememberFact({ ...create, commandId: 'stale-memory', value: 'old' }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(value(state.forgetFact(forget)).fact?.value).toBe('English');
    expect(state.rememberFact({ ...create, value: 'changed' })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });
  it('atomically deduplicates messages and tasks and rejects changed command payloads', () => {
    const { state } = open();
    const message = { commandId: 'message-1', text: 'Please work' };
    const accepted = value(state.acceptMessage(message));
    const duplicate = value(state.acceptMessage(message));
    expect(duplicate.receipt).toEqual({ ...accepted.receipt, status: 'duplicate' });
    expect(duplicate.message).toEqual(accepted.message);
    expect(state.acceptMessage({ ...message, text: 'Changed intent' })).toEqual({
      ok: false,
      error: makeError('conflict'),
    });
    const command = {
      commandId: 'task-1',
      title: 'File',
      code: 'save()',
      files: [{ path: 'input.txt', content: 'a' }],
    };
    const created = value(state.createTask(command));
    expect(value(state.createTask(command))).toEqual({
      ...created,
      receipt: { ...created.receipt, status: 'duplicate' },
    });
    expect(state.createTask({ ...command, files: [{ path: 'input.txt', content: 'b' }] })).toEqual({
      ok: false,
      error: makeError('conflict'),
    });
    expect(state.createTask({ ...command, commandId: 'message-1' }).ok).toBe(false);
    const snapshot = value(state.snapshot());
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.hasMoreMessages).toBe(false);
    expect(snapshot.hasMoreTasks).toBe(false);
    expect(snapshot.taskDetailsTruncated).toBe(false);
    expect(snapshot.cursor).toBe(2);
  });

  it('deduplicates appended replies by stable message identity without losing correlation', () => {
    const { state } = open();
    const work = task(state);
    const input = {
      id: 'reply',
      role: 'assistant' as const,
      text: 'Done',
      inputId: 'input',
      taskId: work.id,
    };
    const message = value(state.appendMessage(input));
    expect(value(state.appendMessage(input))).toEqual(message);
    expect(state.appendMessage({ ...input, text: 'Different' })).toEqual({
      ok: false,
      error: makeError('conflict'),
    });
    expect(value(state.snapshot()).cursor).toBe(2);
    expect(value(state.snapshot()).messages).toEqual([message]);
  });

  it('reads exact canonical message/event pairs beyond cropped snapshots without writing', () => {
    const { state, directory } = open();
    task(state); // Event sequence and messages.sequence intentionally differ.
    const text = ' \r\n' + '中'.repeat(7993) + '😀\r\n';
    expect(text.length).toBe(8000);
    const reply = value(state.appendMessage({ id: 'formal:reply', role: 'assistant', text }));
    const notice = value(state.appendMessage({ id: 'notice', role: 'notice', text: 'notice' }));
    const user = value(state.acceptMessage({ commandId: 'user-input', text: 'user' })).message;
    const before = value(state.snapshot({ messageLimit: 1 }));
    expect(before.messages).toEqual([user]);
    expect(before.hasMoreMessages).toBe(true);
    expect(value(state.getMessage({ id: reply.id, eventSequence: 2 }))).toEqual(reply);
    // State is role-neutral; TTS admission additionally requires assistant.
    expect(value(state.getMessage({ id: notice.id, eventSequence: 3 }))).toEqual(notice);
    expect(value(state.getMessage({ id: user.id, eventSequence: 4 }))).toEqual(user);
    expect(value(state.snapshot({ messageLimit: 1 }))).toEqual(before);
    state.close();
    expect(value(open(directory).state.getMessage({ id: reply.id, eventSequence: 2 }))).toEqual(
      reply,
    );
  });

  it('rejects wrong message/event references and exact-shape boundary violations', () => {
    const { state } = open();
    task(state);
    value(state.appendMessage({ id: 'reply-a', role: 'assistant', text: 'A' }));
    value(state.appendMessage({ id: 'reply-b', role: 'assistant', text: 'B' }));
    for (const input of [
      { id: 'reply-a', eventSequence: 1 }, // Task event, not a message.
      { id: 'reply-a', eventSequence: 3 }, // Another message's event.
      { id: 'missing', eventSequence: 2 },
    ]) {
      expect(state.getMessage(input)).toEqual({ ok: false, error: makeError('conflict') });
    }
    expect(state.getMessage({ id: 'reply-a', eventSequence: 4 })).toEqual({
      ok: false,
      error: makeError('unavailable'),
    });
    for (const eventSequence of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
      expect(state.invoke('getMessage', { id: 'reply-a', eventSequence })).toMatchObject({
        ok: false,
      });
    }
    expect(
      state.invoke('getMessage', { id: 'reply-a', eventSequence: 2, text: 'injected' }),
    ).toEqual({
      ok: false,
      error: makeError('invalid-input'),
    });
    expect(value(state.snapshot()).cursor).toBe(3);
  });

  it('checks the event role against the canonical message before returning text', () => {
    const { state, directory } = open();
    value(state.appendMessage({ id: 'reply', role: 'assistant', text: 'canonical' }));
    const { epoch } = value(state.snapshot());
    state.close();
    const db = new DatabaseSync(join(directory, 'state.sqlite'));
    try {
      db.prepare('UPDATE events SET body=? WHERE sequence=1').run(
        JSON.stringify({
          id: `${epoch}:1`,
          epoch,
          sequence: 1,
          time: Date.now(),
          kind: 'message',
          data: { messageId: 'reply', role: 'user' },
        }),
      );
    } finally {
      db.close();
    }
    expect(open(directory).state.getMessage({ id: 'reply', eventSequence: 1 })).toEqual({
      ok: false,
      error: makeError('conflict'),
    });
  });

  it('pages durable events without skipping, including empty reads after the final cursor', () => {
    const { state } = open();
    for (let index = 0; index < 5; index++)
      value(state.acceptMessage({ commandId: `message-${index}`, text: `Input ${index}` }));
    const { epoch } = value(state.snapshot());
    const first = value(state.events({ after: 0, epoch, limit: 2 }));
    expect(first.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(first.cursor).toBe(2);
    expect(first.hasMore).toBe(true);
    const second = value(state.events({ after: first.cursor, epoch, limit: 2 }));
    const last = value(state.events({ after: second.cursor, epoch, limit: 2 }));
    expect(last.events.map((event) => event.sequence)).toEqual([5]);
    expect(last.hasMore).toBe(false);
    expect(value(state.events({ after: last.cursor, epoch }))).toEqual({
      epoch,
      cursor: 5,
      events: [],
      hasMore: false,
    });
    expect(state.events({ after: 6, epoch }).ok).toBe(false);
    expect(state.events({ after: 0, epoch: 'another-epoch' }).ok).toBe(false);
    expect(state.events({ after: 0, epoch, limit: 0 }).ok).toBe(false);
  });

  it('stops event pages at the byte budget and continues from the last returned event', () => {
    const { state } = open();
    const work = task(state);
    const artifacts = Array.from({ length: 16 }, (_, index) =>
      artifact(work.id, `artifact-${index}-${'x'.repeat(110)}`),
    );
    value(state.updateTask({ taskId: work.id, status: 'running', artifacts }));
    for (let index = 1; index <= 40; index++) {
      value(state.updateTask({ taskId: work.id, status: 'running', stdout: 'x'.repeat(index) }));
    }
    const snapshot = value(state.snapshot());
    expect(snapshot.taskDetailsTruncated).toBe(true);
    expect(snapshot.tasks[0]?.artifacts).toHaveLength(4);
    expect(value(state.getTask({ id: work.id })).artifacts).toHaveLength(16);
    const first = value(state.events({ epoch: snapshot.epoch, after: 0, limit: 200 }));
    expect(first.events.length).toBeLessThan(snapshot.cursor);
    expect(first.hasMore).toBe(true);
    const second = value(state.events({ epoch: snapshot.epoch, after: first.cursor, limit: 200 }));
    expect(second.events[0]?.sequence).toBe(first.cursor + 1);
    expect(second.cursor).toBe(snapshot.cursor);
    expect(second.hasMore).toBe(false);
    expect([...first.events, ...second.events].map((event) => event.sequence)).toEqual(
      Array.from({ length: snapshot.cursor }, (_, index) => index + 1),
    );
  });

  it('applies fact revisions and quotas atomically and preserves command conflicts', () => {
    const { state } = open();
    const command = factInput(state, {
      commandId: 'fact-1',
      key: 'language',
      value: 'English',
      expectedFactRevision: 0,
    });
    expect(value(state.rememberFact(command)).fact?.revision).toBe(1);
    expect(value(state.rememberFact(command)).receipt.status).toBe('duplicate');
    expect(state.rememberFact({ ...command, value: '中文' }).ok).toBe(false);
    expect(state.rememberFact({ ...command, commandId: 'fact-stale' })).toEqual({
      ok: false,
      error: makeError('conflict'),
    });
    expect(
      value(
        state.rememberFact({
          ...command,
          commandId: 'fact-2',
          value: '中文',
          expectedFactRevision: 1,
          expectedMemoryRevision: 1,
        }),
      ).fact?.revision,
    ).toBe(2);
    for (let index = 1; index < STATE_MAX_FACTS; index++)
      value(
        state.rememberFact(
          factInput(state, { commandId: `fact-extra-${index}`, key: `key-${index}`, value: 'x' }),
        ),
      );
    const before = value(state.snapshot());
    expect(
      state.rememberFact(factInput(state, { commandId: 'too-many', key: 'overflow', value: 'x' })),
    ).toEqual({
      ok: false,
      error: makeError('quota-exceeded'),
    });
    expect(value(state.snapshot())).toEqual(before);
    value(
      state.rememberFact(
        factInput(state, { commandId: 'too-many', key: 'language', value: 'Updated' }),
      ),
    );
  });

  it('enforces encoded aggregate fact bytes without committing the rejected fact or event', () => {
    const { state } = open();
    value(
      state.rememberFact(
        factInput(state, { commandId: 'one', key: 'one', value: '字'.repeat(2000) }),
      ),
    );
    const before = value(state.snapshot());
    expect(
      state.rememberFact(
        factInput(state, { commandId: 'two', key: 'two', value: '字'.repeat(1000) }),
      ),
    ).toEqual({
      ok: false,
      error: makeError('quota-exceeded'),
    });
    expect(value(state.snapshot())).toEqual(before);
    value(state.rememberFact(factInput(state, { commandId: 'two', key: 'two', value: 'short' })));
  });

  it('preserves actual completion across late stop and resolves a cancelled record with completion evidence', () => {
    const { state } = open();
    const first = task(state, 'first');
    const second = task(state, 'second');
    value(state.updateTask({ taskId: first.id, status: 'running' }));
    value(state.updateTask({ taskId: second.id, status: 'running' }));
    expect(value(state.updateTask({ taskId: first.id, status: 'cancel-requested' })).status).toBe(
      'cancel-requested',
    );
    expect(value(state.updateTask({ taskId: first.id, status: 'running' })).status).toBe(
      'cancel-requested',
    );
    value(
      state.updateTask({ taskId: first.id, status: 'cancelled', error: makeError('cancelled') }),
    );
    const completed = value(
      state.updateTask({
        taskId: first.id,
        status: 'completed',
        exitCode: 0,
        stdout: 'written',
        artifacts: [artifact(first.id)],
      }),
    );
    expect(completed.status).toBe('completed');
    expect(completed.error).toBeNull();
    const cursor = value(state.snapshot()).cursor;
    for (const status of ['cancel-requested', 'cancelled', 'failed'] as const)
      expect(value(state.updateTask({ taskId: first.id, status, stdout: '' }))).toEqual(completed);
    expect(
      value(
        state.updateTask({
          taskId: first.id,
          status: 'completed',
          exitCode: 0,
          stdout: 'written',
          artifacts: [artifact(first.id)],
        }),
      ),
    ).toEqual(completed);
    expect(
      value(state.updateTask({ taskId: first.id, status: 'completed', stdout: 'writ' })),
    ).toEqual(completed);
    expect(value(state.snapshot()).cursor).toBe(cursor);
    expect(value(state.getTask({ id: second.id })).status).toBe('running');
    expect(state.updateTask({ taskId: first.id, status: 'completed', exitCode: null }).ok).toBe(
      false,
    );
  });

  it('retains checked provider-relative artifact metadata and rolls back a conflicting artifact batch', () => {
    const { state } = open();
    const work = task(state);
    const stored = artifact(work.id);
    value(
      state.updateTask({ taskId: work.id, status: 'completed', exitCode: 0, artifacts: [stored] }),
    );
    expect(value(state.getArtifact({ id: stored.id }))).toEqual(stored);
    const snapshot = value(state.snapshot());
    expect(JSON.stringify(snapshot)).not.toContain('relativePath');
    expect(JSON.stringify(snapshot)).not.toContain('provider');
    const extra = artifact(work.id, 'extra');
    expect(
      state.updateTask({
        taskId: work.id,
        status: 'completed',
        artifacts: [extra, { ...stored, relativePath: 'changed.txt' }],
      }),
    ).toEqual({ ok: false, error: makeError('conflict') });
    expect(state.getArtifact({ id: 'extra' }).ok).toBe(false);
    expect(value(state.snapshot())).toEqual(snapshot);
    for (const path of ['/etc/passwd', '../secret', 'a/../b', 'a\\b', 'C:/secret', 'a//b']) {
      expect(
        state.updateTask({
          taskId: work.id,
          status: 'completed',
          artifacts: [{ ...extra, relativePath: path }],
        }).ok,
      ).toBe(false);
    }
  });

  it('restores identity, facts, completed artifacts and honest interrupted/unknown states without reruns', () => {
    const initial = open();
    const accepted = task(initial.state, 'accepted');
    const running = task(initial.state, 'running');
    const stopping = task(initial.state, 'stopping');
    const done = task(initial.state, 'done');
    value(initial.state.updateTask({ taskId: running.id, status: 'running', stdout: 'partial' }));
    value(initial.state.updateTask({ taskId: stopping.id, status: 'cancel-requested' }));
    value(
      initial.state.updateTask({
        taskId: done.id,
        status: 'completed',
        exitCode: 0,
        artifacts: [artifact(done.id)],
      }),
    );
    value(
      initial.state.rememberFact(
        factInput(initial.state, { commandId: 'preference', key: 'language', value: 'English' }),
      ),
    );
    const before = value(initial.state.snapshot());
    initial.state.close();
    const { state } = open(initial.directory);
    expect(value(state.snapshot())).toEqual(before);
    const first = value(state.recover({ limit: 2 }));
    expect(first.taskIds).toEqual([accepted.id, running.id]);
    expect(first.hasMore).toBe(true);
    expect(value(state.recover()).taskIds).toEqual([stopping.id]);
    expect(value(state.recover())).toEqual({ taskIds: [], hasMore: false });
    expect(value(state.getTask({ id: accepted.id })).status).toBe('interrupted');
    expect(value(state.getTask({ id: running.id }))).toMatchObject({
      status: 'unknown',
      stdout: 'partial',
    });
    expect(value(state.getTask({ id: stopping.id })).status).toBe('unknown');
    expect(value(state.getTask({ id: done.id })).status).toBe('completed');
    expect(value(state.getArtifact({ id: 'output' }))).toEqual(artifact(done.id));
    expect(value(state.snapshot()).assistantId).toBe(before.assistantId);
    expect(
      value(
        state.createTask({ commandId: 'running', title: 'Produce a file', code: 'writeFile()' }),
      ).receipt.status,
    ).toBe('duplicate');
    expect(value(state.updateTask({ taskId: running.id, status: 'running' })).status).toBe(
      'unknown',
    );
    expect(
      value(
        state.updateTask({
          taskId: running.id,
          status: 'completed',
          exitCode: 0,
          stdout: 'partial result',
        }),
      ).status,
    ).toBe('completed');
  });

  it('rejects another SQLite writer in this process and another process until close', () => {
    const { state, directory } = open();
    expect(() => new SqliteState({ dataDirectory: directory })).toThrow(/locked/);
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      try { db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); process.exitCode=2; }
      catch (error) { if (!String(error).includes('locked')) throw error; }
      finally { db.close(); }
    `,
        join(directory, 'state.sqlite'),
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(probe.error).toBeUndefined();
    expect(probe.status, probe.stderr).toBe(0);
    const before = value(state.snapshot());
    state.close();
    state.close();
    expect(state.snapshot()).toEqual({ ok: false, error: makeError('not-ready') });
    expect(value(open(directory).state.snapshot())).toEqual(before);
  });

  it('rolls back all state and dedup writes when event persistence fails', () => {
    const first = open();
    const before = value(first.state.snapshot());
    first.state.close();
    const db = new DatabaseSync(join(first.directory, 'state.sqlite'));
    db.exec(
      "CREATE TRIGGER reject_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;",
    );
    db.close();
    const reopened = open(first.directory).state;
    expect(reopened.acceptMessage({ commandId: 'retry', text: 'one' })).toEqual({
      ok: false,
      error: makeError('internal'),
    });
    expect(reopened.createTask({ commandId: 'task-retry', title: 'work', code: 'work()' }).ok).toBe(
      false,
    );
    expect(value(reopened.snapshot())).toEqual(before);
    expect(value(reopened.events({ epoch: before.epoch, after: 0 })).events).toEqual([]);
    reopened.close();
    const repair = new DatabaseSync(join(first.directory, 'state.sqlite'));
    repair.exec('DROP TRIGGER reject_event');
    repair.close();
    const state = open(first.directory).state;
    expect(value(state.acceptMessage({ commandId: 'retry', text: 'one' })).receipt.status).toBe(
      'accepted',
    );
    expect(
      value(state.createTask({ commandId: 'task-retry', title: 'work', code: 'work()' })).receipt
        .status,
    ).toBe('accepted');
    expect(value(state.snapshot()).cursor).toBe(2);
  });

  it('deduplicates management commands by canonical payload and rejects changed targets', () => {
    const { state } = open();
    const work = task(state);
    const input = {
      commandId: 'stop',
      kind: 'stop',
      payload: { reason: 'user', target: work.id },
      taskId: work.id,
    };
    expect(
      value(
        state.getCommand({ commandId: input.commandId, kind: input.kind, payload: input.payload }),
      ),
    ).toBeNull();
    const accepted = value(state.recordCommand(input));
    expect(
      value(
        state.getCommand({
          commandId: 'stop',
          kind: 'stop',
          payload: { target: work.id, reason: 'user' },
        }),
      ),
    ).toEqual({ ...accepted, status: 'duplicate' });
    expect(value(state.recordCommand(input)).status).toBe('duplicate');
    expect(state.recordCommand({ ...input, payload: { target: 'another' } }).ok).toBe(false);
    expect(state.recordCommand({ ...input, taskId: null }).ok).toBe(false);
    expect(value(state.snapshot()).cursor).toBe(2);
  });

  it('bounds snapshots, events and full retained logs below the kernel JSON budget', () => {
    const { state } = open();
    for (let index = 0; index < 60; index++) {
      value(state.acceptMessage({ commandId: `message-${index}`, text: '字'.repeat(8_000) }));
      const work = task(state, `task-${index}`);
      value(
        state.updateTask({
          taskId: work.id,
          status: 'completed',
          exitCode: 0,
          stdout: '字'.repeat(8_000),
          stderr: '\u0000'.repeat(3_000),
        }),
      );
    }
    const snapshot = value(state.snapshot({ messageLimit: 100, taskLimit: 100 }));
    expect(snapshot.messages.length).toBeGreaterThan(0);
    expect(snapshot.messages.length).toBeLessThan(60);
    expect(snapshot.tasks.length).toBeGreaterThan(0);
    expect(snapshot.tasks.every((item) => item.logsTruncated)).toBe(true);
    expect(snapshot.hasMoreMessages).toBe(true);
    expect(snapshot.hasMoreTasks).toBe(true);
    expect(snapshot.taskDetailsTruncated).toBe(true);
    expect(snapshot.messages.every((item) => item.text === '字'.repeat(8_000))).toBe(true);
    const small = value(state.snapshot({ messageLimit: 1, taskLimit: 1 }));
    expect(small.messages).toHaveLength(1);
    expect(small.tasks).toHaveLength(1);
    expect(small.hasMoreMessages).toBe(true);
    expect(small.hasMoreTasks).toBe(true);
    const work = snapshot.tasks.at(-1);
    if (!work) throw new Error('missing task');
    const full = value(state.getTask({ id: work.id }));
    expect(full.stdout.length).toBeGreaterThan(work.stdout.length);
    expect(full.logsTruncated).toBe(true);
    const events = value(state.events({ epoch: snapshot.epoch, after: 0, limit: 200 }));
    expect(JSON.stringify(events)).not.toContain('stdout');
    for (const payload of [snapshot, full, events]) {
      expect(Buffer.byteLength(JSON.stringify({ ok: true, value: payload }))).toBeLessThanOrEqual(
        STATE_MAX_RESULT_BYTES,
      );
      const envelope = { ok: true, value: { ok: true, value: payload } };
      expect(Buffer.byteLength(JSON.stringify(envelope))).toBeLessThan(JSON_MAX_BYTES);
      expect(jsonPreflight(envelope).ok).toBe(true);
    }
    expect(
      state.invoke('acceptMessage', { commandId: 'bad', text: 'ok', unexpected: true }).ok,
    ).toBe(false);
    expect(
      state.invoke('createTask', {
        commandId: 'bad',
        title: 'bad',
        code: 'run()',
        files: [{ path: '../escape', content: '' }],
      }).ok,
    ).toBe(false);
    expect(state.invoke('snapshot', { messageLimit: Number.NaN }).ok).toBe(false);
  });

  it('uses one caller-supplied snapshot byte budget without dropping facts or falsifying omission flags', () => {
    const { state } = open();
    value(
      state.rememberFact(
        factInput(state, { commandId: 'budget-fact', key: 'preference', value: 'authoritative' }),
      ),
    );
    for (let index = 0; index < 30; index++) {
      const work = task(state, `budget-task-${index}`);
      value(state.updateTask({ taskId: work.id, status: 'running', stdout: 'log'.repeat(4000) }));
      value(state.acceptMessage({ commandId: `budget-message-${index}`, text: '字'.repeat(8000) }));
    }
    const original = value(state.snapshot());
    expect(value(state.snapshot({ byteBudget: STATE_MAX_RESULT_BYTES }))).toEqual(original);
    const smaller = value(state.snapshot({ byteBudget: 6000 }));
    expect(Buffer.byteLength(JSON.stringify(smaller))).toBeLessThan(6000);
    expect(smaller.facts).toEqual(original.facts);
    expect(smaller.hasMoreMessages).toBe(true);
    expect(smaller.hasMoreTasks).toBe(true);
    expect(smaller.taskDetailsTruncated).toBe(true);
    expect(state.snapshot({ byteBudget: 100 })).toEqual({
      ok: false,
      error: makeError('quota-exceeded'),
    });
    expect(state.snapshot({ byteBudget: 0 }).ok).toBe(false);
    expect(state.snapshot({ byteBudget: STATE_MAX_RESULT_BYTES + 1 }).ok).toBe(false);
    expect(value(state.snapshot()).facts).toEqual(original.facts);
  });
});
