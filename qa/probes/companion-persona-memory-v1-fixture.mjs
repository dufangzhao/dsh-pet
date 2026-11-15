// Standalone synthetic-v1 preflight only. This does not run the new provider or migration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createSyntheticV1, inspectSyntheticV1 } from '../fixtures/companion-persona-memory/v1-fixture.mjs';

const child = `
  import { DatabaseSync } from 'node:sqlite';
  let db;
  try {
    db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
    db.exec('ROLLBACK');
    console.log(JSON.stringify({ acquired: true }));
  } catch (error) {
    console.log(JSON.stringify({ acquired: false, locked: /database is locked/i.test(String(error.message)) }));
  } finally { db?.close(); }
`;
function tryWriter(dbPath) {
  const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', child, dbPath],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 16384 });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, 'synthetic SQLite child did not exit normally');
  return JSON.parse(run.stdout);
}

const fixture = await createSyntheticV1();
const initial = await inspectSyntheticV1(fixture);
const writer = new DatabaseSync(fixture.dbPath);
try {
  writer.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  const blocked = tryWriter(fixture.dbPath);
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.locked, true, 'second process must fail on the real SQLite lock');
} finally { writer.close(); }
assert.equal(tryWriter(fixture.dbPath).acquired, true, 'exclusive lock must release on close');
const after = await inspectSyntheticV1(fixture);
assert.deepEqual(after, initial);
console.log(JSON.stringify({
  status: 'synthetic-v1-preflight-passed', scope: 'fixture-schema-ledger-and-sqlite-lock-only',
  baseline: 'cab4d79', dataDirectory: fixture.dataDirectory, version: initial.version,
  identity: initial.identity, rowCounts: Object.fromEntries(Object.entries(initial.rows).map(([name, rows]) => [name, rows.length])),
  artifactSha256: initial.artifactSha256, legacyFactRetry: fixture.factCommands[2].commandId,
  lock: 'second process rejected while exclusive owner open; accepted after close',
  limit: 'No new provider, migration, service, Electron or model was run. Synthetic running task is a row only; no worker was started.',
}, null, 2));
