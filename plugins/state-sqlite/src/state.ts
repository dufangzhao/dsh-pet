import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { makeError, companionAudienceKey } from '@pet/contracts';
import type {
  CompanionArtifact,
  CompanionCommandReceipt,
  CompanionEvent,
  CompanionFact,
  CompanionMessage,
  CompanionTask,
  CompanionTaskStatus,
  CompanionAudience,
  CompanionInputAdmission,
  Result,
} from '@pet/contracts';
import {
  STATE_LOG_BYTES,
  STATE_MAX_ARTIFACTS,
  STATE_MAX_MESSAGE_BYTES,
  STATE_MAX_RESULT_BYTES,
} from './types.js';
import type {
  StateMethodInputs,
  StateMethodOutputs,
  StoredArtifact,
  StateReadScope,
} from './types.js';
import {
  assertVisible,
  legacyOrigin,
  legacyTaskOrigin,
  OWNER_AUDIENCE,
  ownerOrigin,
  ownerTaskOrigin,
  scopeWhere,
} from './scope.js';
import { STATE_FORMAT_VERSION, upgradeStateV2ToV3 } from './schema.js';
import { decode, scalar, fingerprint, receipt } from './records.js';
import type { RecordWriter } from './records.js';
import {
  assertInputCapacity,
  createInput,
  commitInput,
  claimInput,
  inputMessage,
  inputNotices,
  getInput,
  findInput,
  updateInput,
  putMaterial,
  getMaterial,
  findMaterial,
  recoverInputs,
} from './inputs.js';
import { observe, observations, getObservation, pruneObservations } from './observations.js';
import {
  createDelivery,
  updateDelivery,
  claimDeliveryAttempt,
  passiveReplyBudget,
  getDelivery,
  deliveries,
  recoverDeliveries,
} from './deliveries.js';
import {
  claimJudgment,
  finishJudgment,
  judgmentUsage,
  proactiveReadiness,
  recoverJudgments,
} from './judgments.js';
import { openStateDatabase } from './database.js';
import { memoryUsage } from './memory.js';
import { boundedText, jsonBytes, StateFailure, validateInput } from './validation.js';
const NONTERMINAL = ['accepted', 'running', 'cancel-requested'];
const SETTLED = ['completed', 'failed', 'cancelled'];

function publicArtifact({
  id,
  taskId,
  name,
  mediaType,
  sizeBytes,
}: StoredArtifact): CompanionArtifact {
  return { id, taskId, name, mediaType, sizeBytes };
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
    const db = openStateDatabase(dataDirectory);
    this.#db = db;
    try {
      const version = scalar(db.prepare('PRAGMA user_version').get(), 'user_version');
      if (version === 1 || version === 2) throw new StateFailure('not-ready');
      if (version !== 0 && version !== STATE_FORMAT_VERSION) throw new StateFailure('conflict');
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
          PRAGMA user_version=2;
        `);
        db.prepare('INSERT INTO identity(singleton,body) VALUES(1,?)').run(
          JSON.stringify({ assistantId: randomUUID(), epoch: randomUUID(), memoryRevision: 0 }),
        );
        upgradeStateV2ToV3(db);
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
    }, !['snapshot', 'memorySnapshot', 'events', 'getMessage', 'getTask', 'getTaskByExecution', 'getArtifact', 'getCommand', 'getInput', 'findInput', 'inputMessage', 'inputNotices', 'getObservation', 'getMaterial', 'findMaterial', 'getDelivery', 'passiveReplyBudget', 'deliveries', 'observations', 'judgmentUsage', 'proactiveReadiness'].includes(method));
  }

  claimJudgment(
    input: StateMethodInputs['claimJudgment'],
  ): Result<StateMethodOutputs['claimJudgment']> {
    return this.invoke('claimJudgment', input);
  }
  finishJudgment(
    input: StateMethodInputs['finishJudgment'],
  ): Result<StateMethodOutputs['finishJudgment']> {
    return this.invoke('finishJudgment', input);
  }
  proactiveReadiness(
    input: StateMethodInputs['proactiveReadiness'],
  ): Result<StateMethodOutputs['proactiveReadiness']> {
    return this.invoke('proactiveReadiness', input);
  }
  judgmentUsage(
    input: StateMethodInputs['judgmentUsage'] = {},
  ): Result<StateMethodOutputs['judgmentUsage']> {
    return this.invoke('judgmentUsage', input);
  }

  snapshot(input: StateMethodInputs['snapshot'] = {}): Result<StateMethodOutputs['snapshot']> {
    return this.invoke('snapshot', input);
  }
  memorySnapshot(
    input: StateMethodInputs['memorySnapshot'] = {},
  ): Result<StateMethodOutputs['memorySnapshot']> {
    return this.invoke('memorySnapshot', input);
  }
  inputNotices(
    input: StateMethodInputs['inputNotices'],
  ): Result<StateMethodOutputs['inputNotices']> {
    return this.invoke('inputNotices', input);
  }
  inputMessage(
    input: StateMethodInputs['inputMessage'],
  ): Result<StateMethodOutputs['inputMessage']> {
    return this.invoke('inputMessage', input);
  }
  getObservation(
    input: StateMethodInputs['getObservation'],
  ): Result<StateMethodOutputs['getObservation']> {
    return this.invoke('getObservation', input);
  }
  observe(input: StateMethodInputs['observe']): Result<StateMethodOutputs['observe']> {
    return this.invoke('observe', input);
  }
  observations(
    input: StateMethodInputs['observations'],
  ): Result<StateMethodOutputs['observations']> {
    return this.invoke('observations', input);
  }
  pruneObservations(
    input: StateMethodInputs['pruneObservations'] = {},
  ): Result<StateMethodOutputs['pruneObservations']> {
    return this.invoke('pruneObservations', input);
  }
  claimInput(input: StateMethodInputs['claimInput']): Result<StateMethodOutputs['claimInput']> {
    return this.invoke('claimInput', input);
  }
  createInput(input: StateMethodInputs['createInput']): Result<StateMethodOutputs['createInput']> {
    return this.invoke('createInput', input);
  }
  commitInput(input: StateMethodInputs['commitInput']): Result<StateMethodOutputs['commitInput']> {
    return this.invoke('commitInput', input);
  }
  findInput(input: StateMethodInputs['findInput']): Result<StateMethodOutputs['findInput']> {
    return this.invoke('findInput', input);
  }
  getInput(input: StateMethodInputs['getInput']): Result<StateMethodOutputs['getInput']> {
    return this.invoke('getInput', input);
  }
  updateInput(input: StateMethodInputs['updateInput']): Result<StateMethodOutputs['updateInput']> {
    return this.invoke('updateInput', input);
  }
  putMaterial(input: StateMethodInputs['putMaterial']): Result<StateMethodOutputs['putMaterial']> {
    return this.invoke('putMaterial', input);
  }
  findMaterial(
    input: StateMethodInputs['findMaterial'],
  ): Result<StateMethodOutputs['findMaterial']> {
    return this.invoke('findMaterial', input);
  }
  getMaterial(input: StateMethodInputs['getMaterial']): Result<StateMethodOutputs['getMaterial']> {
    return this.invoke('getMaterial', input);
  }
  createDelivery(
    input: StateMethodInputs['createDelivery'],
  ): Result<StateMethodOutputs['createDelivery']> {
    return this.invoke('createDelivery', input);
  }
  updateDelivery(
    input: StateMethodInputs['updateDelivery'],
  ): Result<StateMethodOutputs['updateDelivery']> {
    return this.invoke('updateDelivery', input);
  }
  claimDeliveryAttempt(
    input: StateMethodInputs['claimDeliveryAttempt'],
  ): Result<StateMethodOutputs['claimDeliveryAttempt']> {
    return this.invoke('claimDeliveryAttempt', input);
  }
  passiveReplyBudget(
    input: StateMethodInputs['passiveReplyBudget'],
  ): Result<StateMethodOutputs['passiveReplyBudget']> {
    return this.invoke('passiveReplyBudget', input);
  }
  getDelivery(input: StateMethodInputs['getDelivery']): Result<StateMethodOutputs['getDelivery']> {
    return this.invoke('getDelivery', input);
  }
  deliveries(input: StateMethodInputs['deliveries']): Result<StateMethodOutputs['deliveries']> {
    return this.invoke('deliveries', input);
  }

  #writer(): RecordWriter {
    return {
      db: this.#db,
      event: (kind, data, time, audience, principalId) =>
        this.#event(kind, data, time, audience, principalId),
      appendMessage: (input) => this.#appendMessage(input),
      command: (id, digest) => this.#command(id, digest),
      saveCommand: (digest, value) => this.#saveCommand(digest, value),
    };
  }
  forgetFact(input: StateMethodInputs['forgetFact']): Result<StateMethodOutputs['forgetFact']> {
    return this.invoke('forgetFact', input);
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
  getMessage(input: StateMethodInputs['getMessage']): Result<StateMethodOutputs['getMessage']> {
    return this.invoke('getMessage', input);
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
      claimJudgment: (value) => claimJudgment(this.#writer(), value),
      finishJudgment: (value) => finishJudgment(this.#writer(), value),
      judgmentUsage: (value) => judgmentUsage(this.#db, value),
      proactiveReadiness: (value) => proactiveReadiness(this.#db, value),
      snapshot: (value) => this.#snapshot(value),
      events: (value) => this.#events(value),
      acceptMessage: (value) => this.#acceptMessage(value),
      createTask: (value) => this.#createTask(value),
      updateTask: (value) => this.#updateTask(value),
      appendMessage: (value) => this.#appendMessage(value),
      memorySnapshot: (value) => this.#memory(value.scope),
      inputMessage: (value) => inputMessage(this.#db, value),
      inputNotices: (value) => inputNotices(this.#db, value),
      getObservation: (value) => getObservation(this.#db, value),
      observe: (value) => observe(this.#db, value),
      observations: (value) => observations(this.#db, value),
      pruneObservations: (value) => pruneObservations(this.#db, value),
      claimInput: (value) => claimInput(this.#writer(), value),
      createInput: (value) => createInput(this.#writer(), value),
      commitInput: (value) => commitInput(this.#writer(), value),
      getInput: (value) => getInput(this.#db, value),
      findInput: (value) => findInput(this.#db, value),
      updateInput: (value) => updateInput(this.#writer(), value),
      putMaterial: (value) => putMaterial(this.#writer(), value),
      getMaterial: (value) => getMaterial(this.#db, value),
      findMaterial: (value) => findMaterial(this.#db, value),
      createDelivery: (value) => createDelivery(this.#writer(), value),
      updateDelivery: (value) => updateDelivery(this.#writer(), value),
      claimDeliveryAttempt: (value) => claimDeliveryAttempt(this.#writer(), value),
      getDelivery: (value) => getDelivery(this.#db, value),
      passiveReplyBudget: (value) => passiveReplyBudget(this.#db, value),
      deliveries: (value) => deliveries(this.#db, value),
      rememberFact: (value) => this.#rememberFact(value),
      forgetFact: (value) => this.#mutateMemory(value, true),
      getMessage: (value) => this.#message(value),
      getTask: (value) => this.#visibleTask(this.#task(value.id), value.scope),
      getTaskByExecution: (value) =>
        this.#visibleTask(
          decode<CompanionTask>(
            this.#db.prepare('SELECT body FROM tasks WHERE execution_id=?').get(value.executionId),
          ),
          value.scope,
        ),
      getArtifact: (value) => {
        const artifact = decode<StoredArtifact>(
          this.#db.prepare('SELECT body FROM artifacts WHERE id=?').get(value.id),
        );
        this.#visibleTask(this.#task(artifact.taskId), value.scope);
        return artifact;
      },
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

  #event(
    kind: CompanionEvent['kind'],
    data: CompanionEvent['data'],
    time = Date.now(),
    audience: CompanionAudience = OWNER_AUDIENCE,
    principalId: string | null = 'owner',
  ): void {
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
      .prepare('INSERT INTO events(sequence,body,audience_key,principal_id) VALUES(?,?,?,?)')
      .run(sequence, JSON.stringify(event), companionAudienceKey(audience), principalId);
  }

  #message(input: StateMethodInputs['getMessage']): CompanionMessage {
    const event = decode<CompanionEvent>(
      this.#db.prepare('SELECT body FROM events WHERE sequence=?').get(input.eventSequence),
    );
    if (
      event.sequence !== input.eventSequence ||
      event.epoch !== this.#epoch ||
      event.kind !== 'message' ||
      event.data['messageId'] !== input.id
    )
      throw new StateFailure('conflict');
    const message = decode<CompanionMessage>(
      this.#db.prepare('SELECT body FROM messages WHERE id=?').get(input.id),
    );
    if (message.id !== input.id || event.data['role'] !== message.role)
      throw new StateFailure('conflict');
    assertVisible(message.audience ?? OWNER_AUDIENCE, input.scope);
    return message;
  }

  #visibleTask(task: CompanionTask, scope?: StateReadScope): CompanionTask {
    const origin = task.origin ?? legacyTaskOrigin();
    assertVisible(origin.audience, scope, origin.principalId);
    return task;
  }

  #task(id: string): CompanionTask {
    return decode<CompanionTask>(this.#db.prepare('SELECT body FROM tasks WHERE id=?').get(id));
  }

  #command(commandId: string, digest: string): CompanionCommandReceipt | null {
    const row = this.#db.prepare('SELECT fingerprint,body FROM commands WHERE id=?').get(commandId);
    if (!row) return null;
    if (row['fingerprint'] !== digest) throw new StateFailure('conflict');
    const stored = decode<CompanionCommandReceipt | { receipt: CompanionCommandReceipt }>(row);
    return { ...('receipt' in stored ? stored.receipt : stored), status: 'duplicate' };
  }

  #saveCommand(digest: string, value: CompanionCommandReceipt): void {
    this.#db
      .prepare('INSERT INTO commands(id,fingerprint,body) VALUES(?,?,?)')
      .run(value.commandId, digest, JSON.stringify(value));
  }

  #snapshot(input: StateMethodInputs['snapshot']): StateMethodOutputs['snapshot'] {
    const memory = this.#memory(input.scope);
    const facts = memory.facts;
    const tasks: CompanionTask[] = [];
    const messages: CompanionMessage[] = [];
    const budget = (input.byteBudget ?? STATE_MAX_RESULT_BYTES) - 1024;
    const base = {
      memoryRevision: memory.memoryRevision,
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
    const taskScope = scopeWhere(input.scope, 'tasks');
    const taskRows = this.#db
      .prepare(`SELECT body FROM tasks WHERE ${taskScope.sql} ORDER BY sequence DESC LIMIT ?`)
      .all(...taskScope.params, taskLimit + 1);
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
    const messageScope = scopeWhere(input.scope, 'messages');
    const messageRows = this.#db
      .prepare(`SELECT body FROM messages WHERE ${messageScope.sql} ORDER BY sequence DESC LIMIT ?`)
      .all(...messageScope.params, messageLimit + 1);
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
    const selected = scopeWhere(input.scope, 'events');
    const limit = input.limit ?? 200;
    const rows = this.#db
      .prepare(
        `SELECT body FROM events WHERE sequence>? AND ${selected.sql} ORDER BY sequence LIMIT ?`,
      )
      .all(input.after, ...selected.params, limit + 1);
    for (const row of rows.slice(0, limit)) {
      const event = decode<CompanionEvent>(row);
      if (jsonBytes(events) + jsonBytes(event) > STATE_MAX_RESULT_BYTES - 1024) break;
      events.push(event);
      cursor = event.sequence;
    }
    const hasMore = rows.length > events.length;
    // No visible tail remains: advance across filtered records without exposing their payloads.
    return { epoch: this.#epoch, cursor: hasMore ? cursor : this.#cursor(), events, hasMore };
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
    assertInputCapacity(this.#db, OWNER_AUDIENCE);
    const id = randomUUID();
    const origin = ownerOrigin(id);
    const message = this.#appendMessage({
      id,
      role: 'user',
      text: input.text,
      inputId: input.commandId,
      audience: origin.audience,
      origins: [origin],
    });
    const admission: CompanionInputAdmission = {
      id,
      messageId: id,
      origin,
      materialIds: [],
      phase: 'ready',
      cleanup: 'pending',
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      error: null,
    };
    this.#db
      .prepare(
        'INSERT INTO input_admissions(id,command_id,fingerprint,audience_key,principal_id,phase,body,evidence) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.commandId,
        digest,
        companionAudienceKey(origin.audience),
        'owner',
        'ready',
        JSON.stringify(admission),
        JSON.stringify(input),
      );
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
    const task = normalized.taskId ? this.#task(normalized.taskId) : null;
    const admissionRow = normalized.inputId
      ? this.#db.prepare('SELECT body FROM input_admissions WHERE id=?').get(normalized.inputId)
      : undefined;
    const admission = admissionRow ? decode<CompanionInputAdmission>(admissionRow) : null;
    const inheritedAudience =
      admission?.origin.audience ?? task?.origin?.audience ?? OWNER_AUDIENCE;
    if (!input.audience && inheritedAudience.kind !== 'owner-private')
      throw new StateFailure('invalid-input');
    const audience = input.audience ?? OWNER_AUDIENCE;
    const origins =
      input.origins ??
      (admission
        ? [admission.origin]
        : task?.origin?.origins.length
          ? task.origin.origins
          : [legacyOrigin()]);
    if (
      origins.some(
        (origin) => companionAudienceKey(origin.audience) !== companionAudienceKey(audience),
      )
    )
      throw new StateFailure('conflict');
    if (
      task?.origin &&
      companionAudienceKey(task.origin.audience) !== companionAudienceKey(audience)
    )
      throw new StateFailure('conflict');
    const materials = input.materials ?? [];
    const content = input.content ?? { kind: 'inline-text' as const };
    for (const reference of [
      ...materials,
      ...(content.kind === 'text-document' ? [content.material] : []),
    ]) {
      const stored = getMaterial(this.#db, { id: reference.id, scope: { kind: 'management' } });
      if (
        stored.phase !== 'ready' ||
        fingerprint(stored.reference) !== fingerprint(reference) ||
        companionAudienceKey(reference.audience) !== companionAudienceKey(audience) ||
        reference.originInputIds.some((id) => !origins.some((origin) => origin.inputId === id))
      )
        throw new StateFailure('conflict');
    }
    const message: CompanionMessage = {
      ...normalized,
      audience,
      origins,
      materials,
      content,
      createdAt: Date.now(),
    };
    // A single message must still fit alongside facts and task summaries in a snapshot.
    if (jsonBytes(message) > STATE_MAX_MESSAGE_BYTES) throw new StateFailure('quota-exceeded');
    this.#db
      .prepare(
        'INSERT INTO messages(id,fingerprint,body,audience_key,principal_id) VALUES(?,?,?,?,?)',
      )
      .run(
        message.id,
        digest,
        JSON.stringify(message),
        companionAudienceKey(audience),
        origins[0]?.principalId ?? null,
      );
    this.#event(
      'message',
      {
        messageId: message.id,
        inputId: message.inputId,
        taskId: message.taskId,
        role: message.role,
      },
      message.createdAt,
      audience,
      origins[0]?.principalId ?? null,
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
    const origin = input.origin ?? ownerTaskOrigin();
    if (origin.inputId !== null) {
      const admission = getInput(this.#db, { id: origin.inputId, scope: { kind: 'management' } });
      if (
        admission.origin.principalId !== origin.principalId ||
        companionAudienceKey(admission.origin.audience) !== companionAudienceKey(origin.audience) ||
        !origin.origins.some((item) => fingerprint(item) === fingerprint(admission.origin))
      )
        throw new StateFailure('conflict');
    }
    for (const materialId of origin.materialIds) {
      const material = getMaterial(this.#db, {
        id: materialId,
        scope: { kind: 'conversation', audience: origin.audience, principalId: origin.principalId },
      });
      if (material.phase !== 'ready') throw new StateFailure('not-ready');
    }
    const task: CompanionTask = {
      origin,
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
      .prepare(
        'INSERT INTO tasks(id,execution_id,status,body,command,audience_key,principal_id) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        task.id,
        executionId,
        task.status,
        JSON.stringify(task),
        JSON.stringify(input),
        companionAudienceKey(origin.audience),
        origin.principalId,
      );
    const accepted = receipt(input.commandId, null, task.id);
    this.#saveCommand(digest, accepted);
    this.#event(
      'task',
      { taskId: task.id, executionId, status: task.status },
      time,
      origin.audience,
      origin.principalId,
    );
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
      current.origin?.audience ?? OWNER_AUDIENCE,
      current.origin?.principalId ?? 'owner',
    );
    return next;
  }

  #memory(scope?: StateReadScope): StateMethodOutputs['memorySnapshot'] {
    const identity = decode<{ memoryRevision: number }>(
      this.#db.prepare('SELECT body FROM identity WHERE singleton=1').get(),
    );
    if (!Number.isSafeInteger(identity.memoryRevision) || identity.memoryRevision < 0)
      throw new StateFailure('conflict');
    const selected = scopeWhere(scope, 'facts');
    const facts = this.#db
      .prepare(`SELECT body FROM facts WHERE ${selected.sql} ORDER BY audience_key,key`)
      .all(...selected.params)
      .map((row) => {
        const fact = decode<CompanionFact>(row);
        return { ...fact, origin: fact.origin ?? { kind: 'legacy-unknown' as const } };
      });
    return {
      assistantId: this.#assistantId,
      memoryRevision: identity.memoryRevision,
      facts,
      usage: memoryUsage(facts),
    };
  }
  #rememberFact(input: StateMethodInputs['rememberFact']): StateMethodOutputs['rememberFact'] {
    if ('expectedMemoryRevision' in input) return this.#mutateMemory(input, false);
    // A v1 body is only a fingerprint lookup: never a new blind upsert.
    const known = this.#command(input.commandId, fingerprint({ kind: 'fact', payload: input }));
    if (!known) throw new StateFailure('invalid-input');
    const memory = this.#memory();
    return {
      receipt: known,
      committedRevision: null,
      memory,
      fact:
        memory.facts.find(
          (f) => f.key === input.key && (f.audience ?? OWNER_AUDIENCE).kind === 'owner-private',
        ) ?? null,
    };
  }
  #mutateMemory(
    input:
      | Extract<StateMethodInputs['rememberFact'], { expectedMemoryRevision: number }>
      | StateMethodInputs['forgetFact'],
    forget: boolean,
  ): StateMethodOutputs['rememberFact'] {
    const kind = forget ? 'memory.forget' : 'memory.upsert';
    const digest = fingerprint({ kind, payload: input });
    const known = this.#command(input.commandId, digest);
    const audience = input.audience ?? OWNER_AUDIENCE;
    const audienceKey = companionAudienceKey(audience);
    const scope: StateReadScope =
      audience.kind === 'public'
        ? { kind: 'management' }
        : {
            kind: 'conversation',
            audience,
            principalId:
              audience.kind === 'owner-private'
                ? 'owner'
                : audience.kind === 'person-private'
                  ? audience.principalId
                  : null,
          };
    const memory = this.#memory(scope);
    const matchingFact = (fact: CompanionFact): boolean =>
      fact.key === input.key &&
      companionAudienceKey(fact.audience ?? OWNER_AUDIENCE) === audienceKey;
    if (known) {
      const stored = decode<{ committedRevision: number }>(
        this.#db.prepare('SELECT body FROM commands WHERE id=?').get(input.commandId),
      );
      return {
        receipt: known,
        committedRevision: stored.committedRevision,
        memory,
        fact: memory.facts.find(matchingFact) ?? null,
      };
    }
    const previous = memory.facts.find(matchingFact);
    if (
      input.expectedMemoryRevision !== memory.memoryRevision ||
      input.expectedFactRevision !== (previous?.revision ?? 0) ||
      (forget && !previous)
    )
      throw new StateFailure('conflict');
    const revision = memory.memoryRevision + 1;
    if (!Number.isSafeInteger(revision)) throw new StateFailure('quota-exceeded');
    let fact: CompanionFact | null = null;
    if (forget)
      this.#db
        .prepare('DELETE FROM facts WHERE audience_key=? AND key=?')
        .run(audienceKey, input.key);
    else {
      if (
        !('value' in input) ||
        typeof input.value !== 'string' ||
        !input.value.trim() ||
        input.key !== input.key.trim() ||
        !input.key
      )
        throw new StateFailure('invalid-input');
      fact = {
        key: input.key,
        value: input.value,
        revision,
        updatedAt: Date.now(),
        origin: input.origin,
        audience,
      };
      this.#db
        .prepare(
          'INSERT INTO facts(audience_key,key,body) VALUES(?,?,?) ON CONFLICT(audience_key,key) DO UPDATE SET body=excluded.body',
        )
        .run(audienceKey, fact.key, JSON.stringify(fact));
    }
    const identity = decode<Record<string, unknown>>(
      this.#db.prepare('SELECT body FROM identity WHERE singleton=1').get(),
    );
    this.#db
      .prepare('UPDATE identity SET body=? WHERE singleton=1')
      .run(JSON.stringify({ ...identity, memoryRevision: revision }));
    this.#memory({ kind: 'management' }); // Global quotas remain one budget across all audiences.
    const next = this.#memory(scope);
    const accepted = receipt(input.commandId, null, null);
    this.#db
      .prepare('INSERT INTO commands(id,fingerprint,body) VALUES(?,?,?)')
      .run(
        accepted.commandId,
        digest,
        JSON.stringify({ receipt: accepted, committedRevision: revision }),
      );
    this.#event(
      'fact',
      {
        key: input.key,
        operation: forget ? 'forget' : 'upsert',
        memoryRevision: revision,
        revision: fact?.revision ?? previous?.revision ?? 0,
      },
      Date.now(),
      audience,
    );
    return { receipt: accepted, committedRevision: revision, memory: next, fact };
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
        task.origin?.audience ?? OWNER_AUDIENCE,
        task.origin?.principalId ?? 'owner',
      );
      taskIds.push(task.id);
    }
    const hasMore =
      this.#db
        .prepare(
          "SELECT id FROM tasks WHERE status IN ('accepted','running','cancel-requested') LIMIT 1",
        )
        .get() !== undefined;
    const remaining = (input.limit ?? 200) - taskIds.length;
    const recovered = recoverInputs(this.#writer(), remaining);
    const delivery = recoverDeliveries(
      this.#writer(),
      remaining - recovered.inputIds.length - recovered.materialIds.length,
    );
    const judgments = recoverJudgments(
      this.#writer(),
      remaining - recovered.inputIds.length - recovered.materialIds.length - delivery.ids.length,
    );
    return {
      taskIds,
      inputIds: recovered.inputIds,
      materialIds: recovered.materialIds,
      deliveryIds: delivery.ids,
      judgmentIds: judgments.ids,
      hasMore: hasMore || recovered.hasMore || delivery.hasMore || judgments.hasMore,
    };
  }

  #recordCommand(input: StateMethodInputs['recordCommand']): CompanionCommandReceipt {
    const digest = fingerprint({ kind: input.kind, payload: input.payload });
    const known = this.#command(input.commandId, digest);
    if (known) {
      if (known.taskId !== (input.taskId ?? null) || known.messageId !== (input.messageId ?? null))
        throw new StateFailure('conflict');
      return known;
    }
    if (
      ['message', 'task', 'fact', 'memory.upsert', 'memory.forget', 'input.create'].includes(
        input.kind,
      )
    )
      throw new StateFailure('invalid-input');
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
