import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { makeError } from '@pet/contracts';
import type {
  CompanionArtifact,
  CompanionCommandReceipt,
  CompanionEvent,
  CompanionFact,
  CompanionMessage,
  CompanionTask,
  CompanionTaskStatus,
  JsonValue,
  Result,
} from '@pet/contracts';
import {
  STATE_LOG_BYTES,
  STATE_MAX_ARTIFACTS,
  STATE_MAX_FACT_BYTES,
  STATE_MAX_FACTS,
  STATE_MAX_RESULT_BYTES,
} from './types.js';
import type { StateMethodInputs, StateMethodOutputs, StoredArtifact } from './types.js';
import { boundedText, canonical, jsonBytes, StateFailure, validateInput } from './validation.js';

type Row = Record<string, SQLOutputValue>;
const NONTERMINAL = ['accepted', 'running', 'cancel-requested'];
const SETTLED = ['completed', 'failed', 'cancelled'];

function decode<T>(row: Row | undefined): T {
  if (!row || typeof row['body'] !== 'string') throw new StateFailure('unavailable');
  // Only this provider writes these versioned, boundary-validated JSON records.
  return JSON.parse(row['body']) as T;
}

function scalar(row: Row | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new StateFailure('internal');
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(canonical(value as JsonValue))
    .digest('hex');
}

function publicArtifact({
  id,
  taskId,
  name,
  mediaType,
  sizeBytes,
}: StoredArtifact): CompanionArtifact {
  return { id, taskId, name, mediaType, sizeBytes };
}

function receipt(
  commandId: string,
  messageId: string | null,
  taskId: string | null,
): CompanionCommandReceipt {
  return { commandId, status: 'accepted', messageId, taskId };
}

function mergeLog(previous: string, next: string | undefined): string {
  if (next === undefined || previous.startsWith(next)) return previous;
  if (!next.startsWith(previous)) throw new StateFailure('conflict');
  return boundedText(next, STATE_LOG_BYTES);
}

/** One synchronous writer; all mutations and their durable notifications share a transaction. */
export class SqliteState {
  readonly #db: DatabaseSync;
  readonly #assistantId: string;
  readonly #epoch: string;
  #closed = false;

  constructor({ dataDirectory }: { readonly dataDirectory: string }) {
    if (!isAbsolute(dataDirectory)) throw new StateFailure('invalid-input');
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(join(dataDirectory, 'state.sqlite'));
    this.#db = db;
    try {
      // DELETE + EXCLUSIVE retains the SQLite OS lock between commits. No lease file or PID guessing.
      db.exec(
        'PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE;',
      );
      const version = scalar(db.prepare('PRAGMA user_version').get(), 'user_version');
      if (version !== 0 && version !== 1) throw new StateFailure('conflict');
      if (version === 0) {
        db.exec(`
          CREATE TABLE identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
          CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, body TEXT NOT NULL);
          CREATE TABLE tasks (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, execution_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, body TEXT NOT NULL, command TEXT NOT NULL);
          CREATE INDEX tasks_status ON tasks(status, sequence);
          CREATE TABLE facts (key TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), body TEXT NOT NULL);
          CREATE TABLE commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, body TEXT NOT NULL);
          CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
          PRAGMA user_version=1;
        `);
        db.prepare('INSERT INTO identity(singleton,body) VALUES(1,?)').run(
          JSON.stringify({ assistantId: randomUUID(), epoch: randomUUID() }),
        );
      }
      const identity = decode<{ assistantId: string; epoch: string }>(
        db.prepare('SELECT body FROM identity WHERE singleton=1').get(),
      );
      this.#assistantId = identity.assistantId;
      this.#epoch = identity.epoch;
      db.exec('COMMIT');
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#db.close();
    this.#closed = true;
  }

  /** Dynamic JSON boundary used by the ordinary capability provider. */
  invoke<K extends keyof StateMethodInputs>(
    method: K,
    input: unknown,
  ): Result<StateMethodOutputs[K]> {
    return this.#run(() => {
      const value = validateInput(method, input);
      return this.#execute(method, value);
    }, !['snapshot', 'events', 'getTask', 'getTaskByExecution', 'getArtifact', 'getCommand'].includes(method));
  }

  snapshot(input: StateMethodInputs['snapshot'] = {}): Result<StateMethodOutputs['snapshot']> {
    return this.invoke('snapshot', input);
  }
  events(input: StateMethodInputs['events']): Result<StateMethodOutputs['events']> {
    return this.invoke('events', input);
  }
  acceptMessage(
    input: StateMethodInputs['acceptMessage'],
  ): Result<StateMethodOutputs['acceptMessage']> {
    return this.invoke('acceptMessage', input);
  }
  createTask(input: StateMethodInputs['createTask']): Result<StateMethodOutputs['createTask']> {
    return this.invoke('createTask', input);
  }
  updateTask(input: StateMethodInputs['updateTask']): Result<StateMethodOutputs['updateTask']> {
    return this.invoke('updateTask', input);
  }
  appendMessage(
    input: StateMethodInputs['appendMessage'],
  ): Result<StateMethodOutputs['appendMessage']> {
    return this.invoke('appendMessage', input);
  }
  rememberFact(
    input: StateMethodInputs['rememberFact'],
  ): Result<StateMethodOutputs['rememberFact']> {
    return this.invoke('rememberFact', input);
  }
  getTask(input: StateMethodInputs['getTask']): Result<StateMethodOutputs['getTask']> {
    return this.invoke('getTask', input);
  }
  getTaskByExecution(
    input: StateMethodInputs['getTaskByExecution'],
  ): Result<StateMethodOutputs['getTaskByExecution']> {
    return this.invoke('getTaskByExecution', input);
  }
  getArtifact(input: StateMethodInputs['getArtifact']): Result<StateMethodOutputs['getArtifact']> {
    return this.invoke('getArtifact', input);
  }
  recover(input: StateMethodInputs['recover'] = {}): Result<StateMethodOutputs['recover']> {
    return this.invoke('recover', input);
  }
  recordCommand(
    input: StateMethodInputs['recordCommand'],
  ): Result<StateMethodOutputs['recordCommand']> {
    return this.invoke('recordCommand', input);
  }
  getCommand(input: StateMethodInputs['getCommand']): Result<StateMethodOutputs['getCommand']> {
    return this.invoke('getCommand', input);
  }

  #run<T>(operation: () => T, write: boolean): Result<T> {
    if (this.#closed) return { ok: false, error: makeError('not-ready') };
    let inTransaction = false;
    try {
      if (write) {
        this.#db.exec('BEGIN IMMEDIATE');
        inTransaction = true;
      }
      const value = operation();
      if (jsonBytes({ ok: true, value }) > STATE_MAX_RESULT_BYTES)
        throw new StateFailure('quota-exceeded');
      if (write) this.#db.exec('COMMIT');
      return { ok: true, value };
    } catch (error) {
      if (inTransaction) this.#db.exec('ROLLBACK');
      return {
        ok: false,
        error: makeError(error instanceof StateFailure ? error.code : 'internal'),
      };
    }
  }

  #execute<K extends keyof StateMethodInputs>(
    method: K,
    input: StateMethodInputs[K],
  ): StateMethodOutputs[K] {
    // This map keeps request/response types paired, including the dynamic capability boundary.
    const operations: {
      [M in keyof StateMethodInputs]: (value: StateMethodInputs[M]) => StateMethodOutputs[M];
    } = {
      snapshot: (value) => this.#snapshot(value),
      events: (value) => this.#events(value),
      acceptMessage: (value) => this.#acceptMessage(value),
      createTask: (value) => this.#createTask(value),
      updateTask: (value) => this.#updateTask(value),
      appendMessage: (value) => this.#appendMessage(value),
      rememberFact: (value) => this.#rememberFact(value),
      getTask: (value) => this.#task(value.id),
      getTaskByExecution: (value) =>
        decode<CompanionTask>(
          this.#db.prepare('SELECT body FROM tasks WHERE execution_id=?').get(value.executionId),
        ),
      getArtifact: (value) =>
        decode<StoredArtifact>(
          this.#db.prepare('SELECT body FROM artifacts WHERE id=?').get(value.id),
        ),
      recover: (value) => this.#recover(value),
      recordCommand: (value) => this.#recordCommand(value),
      getCommand: (value) =>
        this.#command(value.commandId, fingerprint({ kind: value.kind, payload: value.payload })),
    };
    return operations[method](input);
  }

  #cursor(): number {
    return scalar(
      this.#db.prepare('SELECT COALESCE(MAX(sequence),0) AS cursor FROM events').get(),
      'cursor',
    );
  }

  #event(kind: CompanionEvent['kind'], data: CompanionEvent['data'], time = Date.now()): void {
    const sequence = this.#cursor() + 1;
    const event: CompanionEvent = {
      id: `${this.#epoch}:${sequence}`,
      epoch: this.#epoch,
      sequence,
      time,
      kind,
      data,
    };
    this.#db
      .prepare('INSERT INTO events(sequence,body) VALUES(?,?)')
      .run(sequence, JSON.stringify(event));
  }

  #task(id: string): CompanionTask {
    return decode<CompanionTask>(this.#db.prepare('SELECT body FROM tasks WHERE id=?').get(id));
  }

  #command(commandId: string, digest: string): CompanionCommandReceipt | null {
    const row = this.#db.prepare('SELECT fingerprint,body FROM commands WHERE id=?').get(commandId);
    if (!row) return null;
    if (row['fingerprint'] !== digest) throw new StateFailure('conflict');
    return { ...decode<CompanionCommandReceipt>(row), status: 'duplicate' };
  }

  #saveCommand(digest: string, value: CompanionCommandReceipt): void {
    this.#db
      .prepare('INSERT INTO commands(id,fingerprint,body) VALUES(?,?,?)')
      .run(value.commandId, digest, JSON.stringify(value));
  }

  #snapshot(input: StateMethodInputs['snapshot']): StateMethodOutputs['snapshot'] {
    const facts = this.#db
      .prepare('SELECT body FROM facts ORDER BY key')
      .all()
      .map((row) => decode<CompanionFact>(row));
    const tasks: CompanionTask[] = [];
    const messages: CompanionMessage[] = [];
    const budget = (input.byteBudget ?? STATE_MAX_RESULT_BYTES) - 1024;
    const base = {
      assistantId: this.#assistantId,
      epoch: this.#epoch,
      cursor: this.#cursor(),
      hasMoreMessages: false,
      hasMoreTasks: false,
      taskDetailsTruncated: false,
      messages,
      tasks,
      facts,
    };
    // Facts are authoritative and never omitted to make a projection fit.
    if (jsonBytes(base) > budget) throw new StateFailure('quota-exceeded');
    const taskLimit = input.taskLimit ?? 20;
    const taskRows = this.#db
      .prepare('SELECT body FROM tasks ORDER BY sequence DESC LIMIT ?')
      .all(taskLimit + 1);
    let taskDetailsTruncated = false;
    for (const row of taskRows.slice(0, taskLimit)) {
      const task = decode<CompanionTask>(row);
      const stdout = boundedText(task.stdout, 256);
      const stderr = boundedText(task.stderr, 256);
      const summary = {
        ...task,
        stdout,
        stderr,
        artifacts: task.artifacts.slice(0, 4),
        logsTruncated: task.logsTruncated || stdout !== task.stdout || stderr !== task.stderr,
      };
      if (
        jsonBytes([...tasks, summary]) > 16 * 1024 ||
        jsonBytes({ ...base, tasks: [...tasks, summary] }) > budget
      )
        break;
      tasks.push(summary);
      taskDetailsTruncated ||=
        stdout !== task.stdout || stderr !== task.stderr || task.artifacts.length > 4;
    }
    const messageLimit = input.messageLimit ?? 50;
    const messageRows = this.#db
      .prepare('SELECT body FROM messages ORDER BY sequence DESC LIMIT ?')
      .all(messageLimit + 1);
    base.hasMoreTasks = taskRows.length > tasks.length;
    base.taskDetailsTruncated = taskDetailsTruncated;
    for (const row of messageRows.slice(0, messageLimit)) {
      const message = decode<CompanionMessage>(row);
      if (jsonBytes({ ...base, messages: [...messages, message] }) > budget) break;
      messages.push(message);
    }
    return {
      ...base,
      hasMoreMessages: messageRows.length > messages.length,
      messages: messages.reverse(),
      tasks: tasks.reverse(),
    };
  }

  #events(input: StateMethodInputs['events']): StateMethodOutputs['events'] {
    if (input.epoch !== this.#epoch || input.after > this.#cursor())
      throw new StateFailure('conflict');
    const events: CompanionEvent[] = [];
    let cursor = input.after;
    const rows = this.#db
      .prepare('SELECT body FROM events WHERE sequence>? ORDER BY sequence LIMIT ?')
      .all(input.after, input.limit ?? 200);
    for (const row of rows) {
      const event = decode<CompanionEvent>(row);
      if (jsonBytes(events) + jsonBytes(event) > STATE_MAX_RESULT_BYTES - 1024) break;
      events.push(event);
      cursor = event.sequence;
    }
    return { epoch: this.#epoch, cursor, events, hasMore: cursor < this.#cursor() };
  }

  #acceptMessage(input: StateMethodInputs['acceptMessage']): StateMethodOutputs['acceptMessage'] {
    const digest = fingerprint({ kind: 'message', payload: input });
    const known = this.#command(input.commandId, digest);
    if (known) {
      if (!known.messageId) throw new StateFailure('internal');
      return {
        receipt: known,
        message: decode<CompanionMessage>(
          this.#db.prepare('SELECT body FROM messages WHERE id=?').get(known.messageId),
        ),
      };
    }
    const message = this.#appendMessage({
      id: randomUUID(),
      role: 'user',
      text: input.text,
      inputId: input.commandId,
    });
    const accepted = receipt(input.commandId, message.id, null);
    this.#saveCommand(digest, accepted);
    return { receipt: accepted, message };
  }

  #appendMessage(input: StateMethodInputs['appendMessage']): CompanionMessage {
    const normalized = { ...input, inputId: input.inputId ?? null, taskId: input.taskId ?? null };
    const digest = fingerprint(normalized);
    const known = this.#db
      .prepare('SELECT fingerprint,body FROM messages WHERE id=?')
      .get(input.id);
    if (known) {
      if (known['fingerprint'] !== digest) throw new StateFailure('conflict');
      return decode<CompanionMessage>(known);
    }
    if (normalized.taskId) this.#task(normalized.taskId);
    const message: CompanionMessage = { ...normalized, createdAt: Date.now() };
    // A single message must still fit alongside facts and task summaries in a snapshot.
    if (jsonBytes(message) > 28 * 1024) throw new StateFailure('quota-exceeded');
    this.#db
      .prepare('INSERT INTO messages(id,fingerprint,body) VALUES(?,?,?)')
      .run(message.id, digest, JSON.stringify(message));
    this.#event(
      'message',
      {
        messageId: message.id,
        inputId: message.inputId,
        taskId: message.taskId,
        role: message.role,
      },
      message.createdAt,
    );
    return message;
  }

  #createTask(input: StateMethodInputs['createTask']): StateMethodOutputs['createTask'] {
    const digest = fingerprint({ kind: 'task', payload: input });
    const known = this.#command(input.commandId, digest);
    if (known) {
      if (!known.taskId) throw new StateFailure('internal');
      return { receipt: known, task: this.#task(known.taskId) };
    }
    const executionId = input.executionId ?? randomUUID();
    if (this.#db.prepare('SELECT id FROM tasks WHERE execution_id=?').get(executionId))
      throw new StateFailure('conflict');
    const time = Date.now();
    const task: CompanionTask = {
      id: randomUUID(),
      executionId,
      title: input.title,
      status: 'accepted',
      createdAt: time,
      updatedAt: time,
      exitCode: null,
      stdout: '',
      stderr: '',
      logsTruncated: false,
      artifacts: [],
      error: null,
    };
    this.#db
      .prepare('INSERT INTO tasks(id,execution_id,status,body,command) VALUES(?,?,?,?,?)')
      .run(task.id, executionId, task.status, JSON.stringify(task), JSON.stringify(input));
    const accepted = receipt(input.commandId, null, task.id);
    this.#saveCommand(digest, accepted);
    this.#event('task', { taskId: task.id, executionId, status: task.status }, time);
    return { receipt: accepted, task };
  }

  #updateTask(input: StateMethodInputs['updateTask']): CompanionTask {
    const current = this.#task(input.taskId);
    let status: CompanionTaskStatus = input.status;
    if (current.status === 'completed' && status !== 'completed') return current;
    // Recovery can learn an exit code or verified artifacts while the outcome remains unknown.
    if (
      !NONTERMINAL.includes(current.status) &&
      !SETTLED.includes(status) &&
      status !== current.status
    )
      return current;
    if (SETTLED.includes(current.status) && status !== current.status && status !== 'completed')
      return current;
    if (status === 'accepted' && current.status !== 'accepted') return current;
    if (current.status === 'cancel-requested' && status === 'running') status = 'cancel-requested';
    const exitCode = input.exitCode === undefined ? current.exitCode : input.exitCode;
    if (status === 'completed' && exitCode !== 0) throw new StateFailure('invalid-input');

    const artifacts = [...current.artifacts];
    for (const artifact of input.artifacts ?? []) {
      if (artifact.taskId !== current.id) throw new StateFailure('conflict');
      const known = this.#db.prepare('SELECT body FROM artifacts WHERE id=?').get(artifact.id);
      if (known) {
        if (fingerprint(decode<StoredArtifact>(known)) !== fingerprint(artifact))
          throw new StateFailure('conflict');
      } else {
        this.#db
          .prepare('INSERT INTO artifacts(id,task_id,body) VALUES(?,?,?)')
          .run(artifact.id, current.id, JSON.stringify(artifact));
        artifacts.push(publicArtifact(artifact));
      }
    }
    if (artifacts.length > STATE_MAX_ARTIFACTS) throw new StateFailure('quota-exceeded');
    const stdout = mergeLog(current.stdout, input.stdout);
    const stderr = mergeLog(current.stderr, input.stderr);
    const task: CompanionTask = {
      ...current,
      status,
      stdout,
      stderr,
      artifacts,
      exitCode,
      logsTruncated:
        current.logsTruncated ||
        (input.logsTruncated ?? false) ||
        (input.stdout !== undefined && jsonBytes(input.stdout) > STATE_LOG_BYTES) ||
        (input.stderr !== undefined && jsonBytes(input.stderr) > STATE_LOG_BYTES),
      error:
        status === 'completed' ? null : input.error === undefined ? current.error : input.error,
    };
    if (fingerprint(task) === fingerprint(current)) return current;
    const next = { ...task, updatedAt: Date.now() };
    this.#db
      .prepare('UPDATE tasks SET status=?,body=? WHERE id=?')
      .run(status, JSON.stringify(next), next.id);
    this.#event(
      'task',
      {
        taskId: next.id,
        executionId: next.executionId,
        status,
        artifactIds: artifacts.map((item) => item.id),
      },
      next.updatedAt,
    );
    return next;
  }

  #rememberFact(input: StateMethodInputs['rememberFact']): StateMethodOutputs['rememberFact'] {
    const digest = fingerprint({ kind: 'fact', payload: input });
    const known = this.#command(input.commandId, digest);
    const row = this.#db.prepare('SELECT body FROM facts WHERE key=?').get(input.key);
    const previous = row ? decode<CompanionFact>(row) : null;
    if (known) {
      if (!previous) throw new StateFailure('internal');
      return { receipt: known, fact: previous };
    }
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== (previous?.revision ?? 0)
    )
      throw new StateFailure('conflict');
    const fact: CompanionFact = {
      key: input.key,
      value: input.value,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: Date.now(),
    };
    this.#db
      .prepare(
        'INSERT INTO facts(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body',
      )
      .run(fact.key, JSON.stringify(fact));
    const allFacts = this.#db.prepare('SELECT body FROM facts').all();
    if (
      allFacts.length > STATE_MAX_FACTS ||
      jsonBytes(allFacts.map((item) => decode<CompanionFact>(item))) > STATE_MAX_FACT_BYTES
    )
      throw new StateFailure('quota-exceeded');
    const accepted = receipt(input.commandId, null, null);
    this.#saveCommand(digest, accepted);
    this.#event('fact', { key: fact.key, revision: fact.revision }, fact.updatedAt);
    return { receipt: accepted, fact };
  }

  #recover(input: StateMethodInputs['recover']): StateMethodOutputs['recover'] {
    const rows = this.#db
      .prepare(
        "SELECT body FROM tasks WHERE status IN ('accepted','running','cancel-requested') ORDER BY sequence LIMIT ?",
      )
      .all(input.limit ?? 200);
    const taskIds: string[] = [];
    for (const row of rows) {
      const task = decode<CompanionTask>(row);
      const next = {
        ...task,
        status: task.status === 'accepted' ? 'interrupted' : 'unknown',
        updatedAt: Date.now(),
        error: makeError('unavailable', false),
      };
      this.#db
        .prepare('UPDATE tasks SET status=?,body=? WHERE id=?')
        .run(next.status, JSON.stringify(next), task.id);
      this.#event(
        'task',
        { taskId: task.id, executionId: task.executionId, status: next.status },
        next.updatedAt,
      );
      taskIds.push(task.id);
    }
    const hasMore =
      this.#db
        .prepare(
          "SELECT id FROM tasks WHERE status IN ('accepted','running','cancel-requested') LIMIT 1",
        )
        .get() !== undefined;
    return { taskIds, hasMore };
  }

  #recordCommand(input: StateMethodInputs['recordCommand']): CompanionCommandReceipt {
    const digest = fingerprint({ kind: input.kind, payload: input.payload });
    const known = this.#command(input.commandId, digest);
    if (known) {
      if (known.taskId !== (input.taskId ?? null) || known.messageId !== (input.messageId ?? null))
        throw new StateFailure('conflict');
      return known;
    }
    if (['message', 'task', 'fact'].includes(input.kind)) throw new StateFailure('invalid-input');
    if (input.taskId) this.#task(input.taskId);
    if (
      input.messageId &&
      !this.#db.prepare('SELECT id FROM messages WHERE id=?').get(input.messageId)
    )
      throw new StateFailure('unavailable');
    const accepted = receipt(input.commandId, input.messageId ?? null, input.taskId ?? null);
    this.#saveCommand(digest, accepted);
    this.#event('runtime', {
      commandId: input.commandId,
      kind: input.kind,
      taskId: accepted.taskId,
    });
    return accepted;
  }
}
