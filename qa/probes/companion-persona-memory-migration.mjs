// Actual offline migration acceptance against generated cab4d79 data only.
// Do not run until the parent freezes product code and authorizes integration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { register } from 'tsx/esm/api';
import { createSyntheticV1, inspectSyntheticV1 } from '../fixtures/companion-persona-memory/v1-fixture.mjs';
import { loadBaselineV1Writer } from '../fixtures/companion-persona-memory/v1-writer.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const child = fileURLToPath(new URL('../fixtures/companion-persona-memory/migrate-child.mjs', import.meta.url));
async function inventory(directory, relative = '') {
  const result = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const key = path.join(relative, entry.name);
    if (entry.isDirectory()) { result.push({ type: 'directory', path: key }); result.push(...await inventory(directory, key)); }
    else if (entry.isFile()) result.push({ type: 'file', path: key,
      sha256: createHash('sha256').update(await readFile(path.join(directory, key))).digest('hex') });
    else throw new Error('Unexpected entry in synthetic migration fixture');
  }
  return result;
}
function rawRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = ['identity', 'messages', 'tasks', 'facts', 'artifacts', 'commands', 'events'];
    return { version: db.prepare('PRAGMA user_version').get().user_version,
      rows: Object.fromEntries(tables.map((name) => [name,
        db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map((row) => ({ ...row }))])) };
  } finally { db.close(); }
}
function unwrap(result) {
  assert.equal(result.ok, true, 'actual state operation was refused');
  return result.value;
}
function childMigration(fixture, backup) {
  const result = spawnSync(process.execPath, ['--no-warnings', child, fixture.dataDirectory, backup],
    { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'migration child did not exit normally');
  return JSON.parse(result.stdout);
}
async function backupTarget() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-backup-'));
  return path.join(parent, 'backup');
}

register();
const { migrateCompanionData } = await import('../../apps/companion-service/dist/migrate.mjs');
const { SqliteState } = await import('../../plugins/state-sqlite/src/state.ts');
const report = { scope: 'synthetic-v1-offline-migration-only', status: 'running', checks: [],
  limit: 'No user data or service/model/Electron; running task is synthetic metadata, not evidence of running work.' };
let stage = 'preflight', exit = 1;
try {
  const fixture = await createSyntheticV1();
  const before = await inspectSyntheticV1(fixture);
  const rootBefore = await inventory(fixture.dataDirectory);
  const legacy = await loadBaselineV1Writer();
  report.baselineSourceHashes = legacy.sourceHashes;
  stage = 'existing-backup-refusal';
  const occupiedBackup = await backupTarget();
  await mkdir(occupiedBackup, { mode: 0o700 });
  const sentinel = path.join(occupiedBackup, 'synthetic-sentinel.txt');
  await writeFile(sentinel, 'retain backup sentinel\n', { flag: 'wx', mode: 0o600 });
  await assert.rejects(migrateCompanionData({ dataDirectory: fixture.dataDirectory, backupDirectory: occupiedBackup }));
  assert.equal(await readFile(sentinel, 'utf8'), 'retain backup sentinel\n');
  assert.deepEqual(await inspectSyntheticV1(fixture), before);
  report.checks.push('occupied-backup-rejected-before-mutation');
  stage = 'normal-startup-and-actual-old-lock';
  assert.throws(() => new SqliteState({ dataDirectory: fixture.stateDirectory }), (error) => error.code === 'not-ready');
  const oldWriter = new legacy.SqliteState({ dataDirectory: fixture.stateDirectory });
  try {
    const oldSnapshot = unwrap(oldWriter.snapshot());
    assert.equal(oldSnapshot.assistantId, fixture.identity.assistantId);
    assert.equal(oldSnapshot.epoch, fixture.identity.epoch);
    const lockedBackup = await backupTarget();
    const locked = childMigration(fixture, lockedBackup);
    assert.equal(locked.ok, false, 'actual v1 writer must block the offline upgrade');
    await assert.rejects(readdir(lockedBackup), (error) => error.code === 'ENOENT');
  } finally { oldWriter.close(); }
  assert.deepEqual(await inspectSyntheticV1(fixture), before);
  report.checks.push('new-startup-rejects-v1-and-real-old-writer-blocks-upgrade');

  stage = 'offline-backup-and-upgrade';
  const backup = await backupTarget();
  const migrated = await migrateCompanionData({ dataDirectory: fixture.dataDirectory, backupDirectory: backup });
  assert.equal(migrated.fromVersion, 1); assert.equal(migrated.toVersion, 2);
  assert.equal(migrated.agentId, fixture.identity.assistantId); assert.equal(migrated.epoch, fixture.identity.epoch);
  assert.equal(migrated.memoryRevision, 3); assert.equal(migrated.backupDirectory, backup);
  assert.deepEqual(await inventory(backup), rootBefore, 'backup must contain all original root files and bytes');
  const backupFixture = { ...fixture, dataDirectory: backup, stateDirectory: path.join(backup, 'state'),
    dbPath: path.join(backup, 'state/state.sqlite') };
  assert.deepEqual(await inspectSyntheticV1(backupFixture), before);
  const after = rawRows(fixture.dbPath);
  assert.equal(after.version, 2);
  for (const name of ['messages', 'tasks', 'facts', 'artifacts', 'commands', 'events'])
    assert.deepEqual(after.rows[name], before.rows[name], `${name} changed during migration`);
  assert.deepEqual(JSON.parse(after.rows.identity[0].body), { ...fixture.identity, memoryRevision: 3 });
  assert.throws(() => new legacy.SqliteState({ dataDirectory: fixture.stateDirectory }), (error) => error.code === 'conflict');
  report.checks.push('verified-full-root-v1-backup-preserved-rows-and-old-writer-rejects-v2');

  stage = 'durable-legacy-replay-and-aba';
  const state = new SqliteState({ dataDirectory: fixture.stateDirectory });
  try {
    const memory = unwrap(state.memorySnapshot());
    assert.equal(memory.memoryRevision, 3);
    assert.equal(memory.facts.find((fact) => fact.key === 'legacy-long').value, fixture.facts[1].value);
    assert.ok(memory.facts.every((fact) => fact.origin?.kind === 'legacy-unknown'));
    const legacyCommand = fixture.factCommands[2];
    const known = unwrap(state.rememberFact(legacyCommand));
    assert.equal(known.receipt.status, 'duplicate'); assert.equal(known.committedRevision, null);
    const forget = { commandId: 'qa-v2-forget', expectedMemoryRevision: 3, expectedFactRevision: 3,
      key: legacyCommand.key, origin: { kind: 'owner-form' } };
    const forgotten = unwrap(state.forgetFact(forget));
    assert.equal(forgotten.committedRevision, 4);
    const cursor = unwrap(state.snapshot()).cursor;
    const retry = unwrap(state.rememberFact(legacyCommand));
    assert.equal(retry.receipt.status, 'duplicate'); assert.equal(retry.committedRevision, null);
    assert.equal(retry.memory.facts.find((fact) => fact.key === legacyCommand.key), undefined);
    assert.equal(unwrap(state.snapshot()).cursor, cursor);
    assert.equal(state.rememberFact({ ...legacyCommand, value: 'changed' }).ok, false);
    const recreated = unwrap(state.rememberFact({ commandId: 'qa-v2-recreate', expectedMemoryRevision: 4,
      expectedFactRevision: 0, key: legacyCommand.key, value: 'new synthetic value', origin: { kind: 'owner-form' } }));
    assert.equal(recreated.committedRevision, 5);
    const duplicateForget = unwrap(state.forgetFact(forget));
    assert.equal(duplicateForget.receipt.status, 'duplicate');
    assert.equal(duplicateForget.memory.facts.find((fact) => fact.key === legacyCommand.key).value, 'new synthetic value');
    const stale = state.rememberFact({ commandId: 'qa-v2-stale', expectedMemoryRevision: 3,
      expectedFactRevision: 3, key: legacyCommand.key, value: 'stale overwrite', origin: { kind: 'owner-form' } });
    assert.equal(stale.ok, false); assert.equal(stale.error.code, 'conflict');
  } finally { state.close(); }
  report.checks.push('known-v1-replay-does-not-resurrect-and-v2-aba-is-fenced');

  stage = 'transaction-rollback';
  const failing = await createSyntheticV1();
  const db = new DatabaseSync(failing.dbPath);
  try { db.exec("CREATE TRIGGER qa_reject_identity BEFORE UPDATE ON identity BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END;"); }
  finally { db.close(); }
  const original = await inspectSyntheticV1(failing);
  const backupOnFailure = await backupTarget();
  await assert.rejects(migrateCompanionData({ dataDirectory: failing.dataDirectory, backupDirectory: backupOnFailure }));
  assert.deepEqual(await inspectSyntheticV1(failing), original);
  const rollbackBackup = { ...failing, dataDirectory: backupOnFailure,
    stateDirectory: path.join(backupOnFailure, 'state'), dbPath: path.join(backupOnFailure, 'state/state.sqlite') };
  assert.deepEqual(await inspectSyntheticV1(rollbackBackup), original);
  report.checks.push('in-transaction-failure-leaves-v1-and-verified-backup');
  report.status = 'migration-subset-passed'; exit = 0;
} catch (error) {
  report.status = 'migration-subset-failed';
  report.failure = `${stage}: ${error instanceof Error ? error.message.slice(0, 500) : 'non-error failure'}`;
} finally {
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
