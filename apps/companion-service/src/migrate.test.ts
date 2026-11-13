import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteState } from '@pet/state-sqlite';
import { migrateCompanionData } from './migrate.js';

it('backs up a synthetic v1 under the real exclusive lock, fences old writers and preserves legacy replay after forget', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-migrate-fixture-'));
  if (
    path.dirname(directory) !== tmpdir() ||
    !path.basename(directory).startsWith('companion-migrate-fixture-')
  )
    throw new Error('unexpected fixture path');
  const root = path.join(directory, 'data');
  const stateRoot = path.join(root, 'state');
  await mkdir(stateRoot, { recursive: true });
  const file = path.join(stateRoot, 'state.sqlite');
  const legacy = { commandId: 'v1-remember', key: 'language', value: '中文' };
  const canonical = (value: Record<string, unknown>) =>
    JSON.stringify(
      Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      ),
    );
  const digest = createHash('sha256')
    .update(`{"kind":"fact","payload":${canonical(legacy)}}`)
    .digest('hex');
  const receipt = {
    commandId: legacy.commandId,
    status: 'accepted',
    messageId: null,
    taskId: null,
  };
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE identity(singleton INTEGER PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE tasks(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,execution_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,body TEXT NOT NULL,command TEXT NOT NULL);
    CREATE TABLE artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),body TEXT NOT NULL);
    CREATE TABLE facts(key TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE commands(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL);
    PRAGMA user_version=1;`);
  db.prepare('INSERT INTO identity VALUES(1,?)').run(
    JSON.stringify({ assistantId: 'original-agent', epoch: 'original-epoch' }),
  );
  db.prepare('INSERT INTO facts VALUES(?,?)').run(
    'language',
    JSON.stringify({ key: 'language', value: '中文', revision: 3, updatedAt: 1700000000000 }),
  );
  db.prepare('INSERT INTO commands VALUES(?,?,?)').run(
    legacy.commandId,
    digest,
    JSON.stringify(receipt),
  );
  db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
  let state: SqliteState | undefined;
  try {
    await expect(
      migrateCompanionData({
        dataDirectory: root,
        backupDirectory: path.join(directory, 'blocked'),
      }),
    ).rejects.toThrow();
    db.close();
    const before = await readFile(file);
    expect(() => new SqliteState({ dataDirectory: stateRoot })).toThrow();
    const result = await migrateCompanionData({
      dataDirectory: root,
      backupDirectory: path.join(directory, 'backup'),
    });
    expect(result).toMatchObject({
      fromVersion: 1,
      toVersion: 3,
      agentId: 'original-agent',
      epoch: 'original-epoch',
      memoryRevision: 3,
    });
    expect(await readFile(path.join(result.backupDirectory, 'state', 'state.sqlite'))).toEqual(
      before,
    );
    const oldWriter = new DatabaseSync(file);
    expect(oldWriter.prepare('PRAGMA user_version').get()?.['user_version']).toBe(3);
    oldWriter.close();
    state = new SqliteState({ dataDirectory: stateRoot });
    const memory = state.memorySnapshot();
    expect(memory).toMatchObject({
      ok: true,
      value: {
        assistantId: 'original-agent',
        memoryRevision: 3,
        facts: [{ origin: { kind: 'legacy-unknown' } }],
      },
    });
    expect(
      state.forgetFact({
        commandId: 'forget-v1',
        key: 'language',
        expectedMemoryRevision: 3,
        expectedFactRevision: 3,
        origin: { kind: 'owner-form' },
      }).ok,
    ).toBe(true);
    const duplicate = state.rememberFact(legacy);
    expect(duplicate).toMatchObject({
      ok: true,
      value: {
        receipt: { ...receipt, status: 'duplicate' },
        committedRevision: null,
        fact: null,
        memory: { facts: [], memoryRevision: 4 },
      },
    });
    expect(state.rememberFact({ ...legacy, value: 'different' })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(state.rememberFact({ ...legacy, commandId: 'unknown-old' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  } finally {
    state?.close();
    try {
      db.close();
    } catch {
      /* Fixture may already be closed after its lock test. */
    }
    await rm(directory, { recursive: true });
  }
}, 15000);
