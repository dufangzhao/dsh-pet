// Synthetic v1 records written directly from cab4d79's schema and wire/ledger rules.
// This module never imports the current SqliteState constructor or migration utility.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const json = (value) => JSON.stringify(value);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map((key) => `${json(key)}:${canonical(value[key] ?? null)}`).join(',')}}`;
  return json(value);
};
const fingerprint = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const receipt = (commandId, messageId = null, taskId = null) => ({ commandId, status: 'accepted', messageId, taskId });
const timestamp = 1700000000000;

// Exact CREATE statements from cab4d79 plugins/state-sqlite/src/state.ts.
const schema = `
  CREATE TABLE identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
  CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE tasks (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, execution_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, body TEXT NOT NULL, command TEXT NOT NULL);
  CREATE INDEX tasks_status ON tasks(status, sequence);
  CREATE TABLE facts (key TEXT PRIMARY KEY, body TEXT NOT NULL);
  CREATE TABLE artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), body TEXT NOT NULL);
  CREATE TABLE commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
  PRAGMA user_version=1;
`;

export async function createSyntheticV1() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-v1-'));
  const stateDirectory = path.join(dataDirectory, 'state');
  await mkdir(stateDirectory, { mode: 0o700 });
  const dbPath = path.join(stateDirectory, 'state.sqlite');
  const artifactPath = 'job-v1-finished/artifacts/result.txt';
  const output = Buffer.from('synthetic v1 artifact\n');
  const artifactDirectory = path.join(dataDirectory, 'plugin-data/pet.cloud-exec/jobs/job-v1-finished/artifacts');
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(artifactDirectory, 'result.txt'), output, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(dataDirectory, 'synthetic-root-marker.txt'), 'synthetic backup marker\n', { flag: 'wx', mode: 0o600 });

  const identity = { assistantId: 'agent-v1-synthetic', epoch: 'epoch-v1-synthetic' };
  const messageInput = { commandId: 'v1-message-command', text: 'synthetic legacy input' };
  const message = { id: 'v1-message', role: 'user', text: messageInput.text,
    inputId: messageInput.commandId, taskId: null, createdAt: timestamp + 1 };
  const reply = { id: 'v1-reply', role: 'assistant', text: 'synthetic legacy answer',
    inputId: message.id, taskId: null, createdAt: timestamp + 2 };
  const facts = [
    { key: 'answer-style', value: '回答简短', revision: 3, updatedAt: timestamp + 5 },
    { key: 'legacy-long', value: '字'.repeat(2000), revision: 1, updatedAt: timestamp + 6 },
  ];
  const factCommands = [
    { commandId: 'v1-fact-1', key: 'answer-style', value: '自然回答', expectedRevision: 0 },
    { commandId: 'v1-fact-2', key: 'answer-style', value: '说清楚', expectedRevision: 1 },
    { commandId: 'v1-fact-3', key: 'answer-style', value: '回答简短', expectedRevision: 2 },
    { commandId: 'v1-fact-long', key: 'legacy-long', value: facts[1].value },
  ];
  const completedCommand = { commandId: 'v1-task-completed-command', title: 'Synthetic completed',
    code: "writeFileSync('result.txt','synthetic v1 artifact\\n')", executionId: 'v1-exec-completed',
    outputs: [{ path: 'result.txt', mediaType: 'text/plain' }] };
  const runningCommand = { commandId: 'v1-task-running-command', title: 'Synthetic running record',
    code: 'setInterval(()=>{},1000)', executionId: 'v1-exec-running' };
  const artifact = { id: 'v1-artifact', taskId: 'v1-task-completed', name: 'result.txt',
    mediaType: 'text/plain', sizeBytes: output.length, provider: 'pet.cloud-exec', relativePath: artifactPath };
  const publicArtifact = (({ id, taskId, name, mediaType, sizeBytes }) => ({ id, taskId, name, mediaType, sizeBytes }))(artifact);
  const completedTask = { id: 'v1-task-completed', executionId: completedCommand.executionId,
    title: completedCommand.title, status: 'completed', createdAt: timestamp + 7, updatedAt: timestamp + 9,
    exitCode: 0, stdout: 'synthetic completion', stderr: '', logsTruncated: false,
    artifacts: [publicArtifact], error: null };
  const runningTask = { id: 'v1-task-running', executionId: runningCommand.executionId,
    title: runningCommand.title, status: 'running', createdAt: timestamp + 10, updatedAt: timestamp + 11,
    exitCode: null, stdout: '', stderr: '', logsTruncated: false, artifacts: [], error: null };
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE;');
    db.exec(schema);
    db.prepare('INSERT INTO identity(singleton,body) VALUES(1,?)').run(json(identity));
    const insertMessage = db.prepare('INSERT INTO messages(id,fingerprint,body) VALUES(?,?,?)');
    for (const row of [message, reply]) {
      const { createdAt: _createdAt, ...normalized } = row;
      insertMessage.run(row.id, fingerprint(normalized), json(row));
    }
    const insertTask = db.prepare('INSERT INTO tasks(id,execution_id,status,body,command) VALUES(?,?,?,?,?)');
    insertTask.run(completedTask.id, completedTask.executionId, completedTask.status, json(completedTask), json(completedCommand));
    insertTask.run(runningTask.id, runningTask.executionId, runningTask.status, json(runningTask), json(runningCommand));
    const insertFact = db.prepare('INSERT INTO facts(key,body) VALUES(?,?)');
    for (const fact of facts) insertFact.run(fact.key, json(fact));
    db.prepare('INSERT INTO artifacts(id,task_id,body) VALUES(?,?,?)').run(artifact.id, artifact.taskId, json(artifact));
    const insertCommand = db.prepare('INSERT INTO commands(id,fingerprint,body) VALUES(?,?,?)');
    insertCommand.run(messageInput.commandId, fingerprint({ kind: 'message', payload: messageInput }), json(receipt(messageInput.commandId, message.id)));
    for (const command of factCommands) insertCommand.run(command.commandId, fingerprint({ kind: 'fact', payload: command }), json(receipt(command.commandId)));
    for (const [command, task] of [[completedCommand, completedTask], [runningCommand, runningTask]])
      insertCommand.run(command.commandId, fingerprint({ kind: 'task', payload: command }), json(receipt(command.commandId, null, task.id)));
    const entries = [
      ['message', { messageId: message.id, inputId: message.inputId, taskId: null, role: 'user' }],
      ['message', { messageId: reply.id, inputId: reply.inputId, taskId: null, role: 'assistant' }],
      ['fact', { key: facts[0].key, revision: 1 }], ['fact', { key: facts[0].key, revision: 2 }],
      ['fact', { key: facts[0].key, revision: 3 }], ['fact', { key: facts[1].key, revision: 1 }],
      ['task', { taskId: completedTask.id, executionId: completedTask.executionId, status: 'accepted' }],
      ['task', { taskId: completedTask.id, executionId: completedTask.executionId, status: 'running', artifactIds: [] }],
      ['task', { taskId: completedTask.id, executionId: completedTask.executionId, status: 'completed', artifactIds: [artifact.id] }],
      ['task', { taskId: runningTask.id, executionId: runningTask.executionId, status: 'accepted' }],
      ['task', { taskId: runningTask.id, executionId: runningTask.executionId, status: 'running', artifactIds: [] }],
    ];
    const insertEvent = db.prepare('INSERT INTO events(sequence,body) VALUES(?,?)');
    entries.forEach(([kind, data], index) => {
      const sequence = index + 1;
      insertEvent.run(sequence, json({ id: `${identity.epoch}:${sequence}`, epoch: identity.epoch,
        sequence, time: timestamp + sequence, kind, data }));
    });
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* The database can already be closed or rolled back. */ }
    throw error;
  } finally { db.close(); }
  return { dataDirectory, stateDirectory, dbPath, identity, facts, factCommands,
    message, reply, completedTask, runningTask, artifact, artifactBytes: output };
}

// Read-only inspection preserves exact rows for later before/after and backup comparison.
export async function inspectSyntheticV1(fixture) {
  const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const tables = ['identity', 'messages', 'tasks', 'facts', 'artifacts', 'commands', 'events'];
    const rows = Object.fromEntries(tables.map((name) => [name,
      db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map((row) => ({ ...row }))]));
    assert.deepEqual(JSON.parse(rows.identity[0].body), fixture.identity);
    assert.equal(rows.messages.length, 2); assert.equal(rows.tasks.length, 2);
    assert.equal(rows.facts.length, 2); assert.equal(rows.artifacts.length, 1);
    assert.equal(rows.commands.length, 7); assert.equal(rows.events.length, 11);
    assert.equal(JSON.parse(rows.tasks[1].body).status, 'running');
    const replay = rows.commands.find((row) => row.id === fixture.factCommands[2].commandId);
    assert.equal(replay.fingerprint, fingerprint({ kind: 'fact', payload: fixture.factCommands[2] }));
    assert.deepEqual(JSON.parse(replay.body), receipt(fixture.factCommands[2].commandId));
    assert.equal(JSON.parse(rows.facts.find((row) => row.key === 'legacy-long').body).value, fixture.facts[1].value);
    assert.deepEqual(await readFile(path.join(fixture.dataDirectory, 'plugin-data/pet.cloud-exec/jobs', fixture.artifact.relativePath)), fixture.artifactBytes);
    return { version: 1, rows, identity: fixture.identity, artifactSha256: createHash('sha256').update(fixture.artifactBytes).digest('hex') };
  } finally { db.close(); }
}
