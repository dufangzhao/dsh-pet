import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
  symlink,
  readlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteState } from '@pet/state-sqlite';
import { isCompanionTaskOrigin } from '@pet/contracts';
import { migrateCompanionData } from './migrate.js';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-migrate-v3-'));
  const root = path.join(directory, 'data');
  const stateRoot = path.join(root, 'state');
  await mkdir(stateRoot, { recursive: true });
  await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config', 'settings.json'), '{"synthetic":"preserved"}');
  await symlink('config/settings.json', path.join(root, 'settings-link'));
  const database = path.join(stateRoot, 'state.sqlite');
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE identity(singleton INTEGER PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE tasks(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,execution_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,body TEXT NOT NULL,command TEXT NOT NULL);
    CREATE TABLE artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),body TEXT NOT NULL);
    CREATE TABLE facts(key TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE commands(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL);
    PRAGMA user_version=2;`);
  const message = {
    id: 'old-message',
    role: 'user',
    text: 'owner private canary',
    createdAt: 1700000000000,
    inputId: 'old-command',
    taskId: null,
  };
  const task = {
    id: 'old-task',
    executionId: 'old-execution',
    title: 'retained task',
    status: 'running',
    createdAt: 1700000000001,
    updatedAt: 1700000000002,
    exitCode: null,
    stdout: 'retained output',
    stderr: '',
    logsTruncated: false,
    artifacts: [
      {
        id: 'old-artifact',
        taskId: 'old-task',
        name: 'result.txt',
        mediaType: 'text/plain',
        sizeBytes: 4,
      },
    ],
    error: null,
  };
  const artifact = {
    ...task.artifacts[0],
    provider: 'docker',
    relativePath: 'retained/result.txt',
  };
  const fact = {
    key: 'language',
    value: 'English',
    revision: 3,
    updatedAt: 1700000000003,
    origin: { kind: 'owner-form' },
  };
  const receipt = {
    commandId: 'old-command',
    status: 'accepted',
    messageId: message.id,
    taskId: null,
  };
  const fingerprint = createHash('sha256')
    .update(
      '{"kind":"message","payload":{"commandId":"old-command","text":"owner private canary"}}',
    )
    .digest('hex');
  const event = {
    id: 'retained-epoch:1',
    epoch: 'retained-epoch',
    sequence: 1,
    time: message.createdAt,
    kind: 'message',
    data: { messageId: message.id, role: 'user', inputId: message.inputId, taskId: null },
  };
  db.prepare('INSERT INTO identity VALUES(1,?)').run(
    JSON.stringify({ assistantId: 'retained-agent', epoch: 'retained-epoch', memoryRevision: 9 }),
  );
  db.prepare('INSERT INTO messages(id,fingerprint,body) VALUES(?,?,?)').run(
    message.id,
    'unchanged-message-fingerprint',
    JSON.stringify(message),
  );
  db.prepare('INSERT INTO tasks(id,execution_id,status,body,command) VALUES(?,?,?,?,?)').run(
    task.id,
    task.executionId,
    task.status,
    JSON.stringify(task),
    '{"original":"task command bytes"}',
  );
  db.prepare('INSERT INTO artifacts VALUES(?,?,?)').run(
    artifact.id ?? '',
    task.id,
    JSON.stringify(artifact),
  );
  db.prepare('INSERT INTO facts VALUES(?,?)').run(fact.key, JSON.stringify(fact));
  db.prepare('INSERT INTO commands VALUES(?,?,?)').run(
    receipt.commandId,
    fingerprint,
    JSON.stringify(receipt),
  );
  db.prepare('INSERT INTO events(sequence,body) VALUES(1,?)').run(JSON.stringify(event));
  return {
    directory,
    root,
    stateRoot,
    database,
    db,
    message,
    task,
    artifact,
    fact,
    receipt,
    fingerprint,
    event,
  };
}
async function cleanup(directory: string): Promise<void> {
  const target = await realpath(directory);
  if (
    path.dirname(target) !== (await realpath(tmpdir())) ||
    !path.basename(target).startsWith('companion-migrate-v3-')
  )
    throw new Error('unexpected fixture directory');
  await rm(target, { recursive: true });
}

it('cold migrates synthetic v2 only after full-root backup, preserving identities/ledgers and creating no deliveries', async () => {
  const f = await fixture();
  f.db.close();
  let state: SqliteState | undefined;
  try {
    expect(() => new SqliteState({ dataDirectory: f.stateRoot })).toThrow();
    const before = await readFile(f.database);
    const result = await migrateCompanionData({
      dataDirectory: f.root,
      backupDirectory: path.join(f.directory, 'backup'),
    });
    expect(result).toMatchObject({
      fromVersion: 2,
      toVersion: 4,
      agentId: 'retained-agent',
      epoch: 'retained-epoch',
      memoryRevision: 9,
    });
    expect(await readFile(path.join(result.backupDirectory, 'state', 'state.sqlite'))).toEqual(
      before,
    );
    expect(
      await readFile(path.join(result.backupDirectory, 'config', 'settings.json'), 'utf8'),
    ).toBe('{"synthetic":"preserved"}');
    expect(await readlink(path.join(result.backupDirectory, 'settings-link'))).toBe(
      'config/settings.json',
    );
    const inspect = new DatabaseSync(f.database);
    try {
      expect(inspect.prepare('PRAGMA user_version').get()?.['user_version']).toBe(4);
      expect(
        inspect.prepare('SELECT fingerprint,body FROM commands WHERE id=?').get('old-command'),
      ).toMatchObject({ fingerprint: f.fingerprint, body: JSON.stringify(f.receipt) });
      expect(
        inspect.prepare('SELECT fingerprint FROM messages WHERE id=?').get(f.message.id)?.[
          'fingerprint'
        ],
      ).toBe('unchanged-message-fingerprint');
      expect(
        inspect.prepare('SELECT command FROM tasks WHERE id=?').get(f.task.id)?.['command'],
      ).toBe('{"original":"task command bytes"}');
      expect(
        inspect.prepare('SELECT body FROM artifacts WHERE id=?').get(f.artifact.id ?? '')?.['body'],
      ).toBe(JSON.stringify(f.artifact));
      expect(inspect.prepare('SELECT body FROM events WHERE sequence=1').get()?.['body']).toBe(
        JSON.stringify(f.event),
      );
      for (const table of [
        'input_admissions',
        'qq_deliveries',
        'materials',
        'conversation_observations',
      ])
        expect(inspect.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.['count']).toBe(0);
    } finally {
      inspect.close();
    }
    state = new SqliteState({ dataDirectory: f.stateRoot });
    const snapshot = state.snapshot();
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        assistantId: 'retained-agent',
        epoch: 'retained-epoch',
        cursor: 1,
        memoryRevision: 9,
        messages: [
          {
            ...f.message,
            audience: { kind: 'owner-private' },
            origins: [{ kind: 'legacy-unknown' }],
          },
        ],
        tasks: [
          { ...f.task, origin: { principalId: 'owner', audience: { kind: 'owner-private' } } },
        ],
        facts: [{ ...f.fact, audience: { kind: 'owner-private' } }],
      },
    });
    if (snapshot.ok) expect(isCompanionTaskOrigin(snapshot.value.tasks[0]?.origin)).toBe(true);
    expect(state.acceptMessage({ commandId: 'old-command', text: f.message.text })).toMatchObject({
      ok: true,
      value: { receipt: { ...f.receipt, status: 'duplicate' } },
    });
    expect(
      state.snapshot({
        scope: {
          kind: 'conversation',
          audience: { kind: 'person-private', principalId: 'external' },
          principalId: 'external',
        },
      }),
    ).toMatchObject({ ok: true, value: { messages: [], tasks: [], facts: [] } });
    state.close();
    await expect(
      migrateCompanionData({
        dataDirectory: f.root,
        backupDirectory: path.join(f.directory, 'second-backup'),
      }),
    ).rejects.toThrow();
  } finally {
    state?.close();
    await cleanup(f.directory);
  }
}, 15000);

it('refuses active writers/unsafe backups and rolls back every v3 change on a record migration failure', async () => {
  const f = await fixture();
  try {
    f.db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    await expect(
      migrateCompanionData({
        dataDirectory: f.root,
        backupDirectory: path.join(f.directory, 'locked'),
      }),
    ).rejects.toThrow();
    await expect(
      migrateCompanionData({ dataDirectory: f.root, backupDirectory: path.join(f.root, 'unsafe') }),
    ).rejects.toThrow();
    f.db.exec(
      "CREATE TRIGGER fail_upgrade BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END;",
    );
    f.db.close();
    const before = await readFile(f.database);
    await expect(
      migrateCompanionData({
        dataDirectory: f.root,
        backupDirectory: path.join(f.directory, 'verified-before-failure'),
      }),
    ).rejects.toThrow();
    expect(await readFile(f.database)).toEqual(before);
    const inspect = new DatabaseSync(f.database);
    try {
      expect(inspect.prepare('PRAGMA user_version').get()?.['user_version']).toBe(2);
      expect(
        inspect.prepare('SELECT body FROM messages WHERE id=?').get(f.message.id)?.['body'],
      ).toBe(JSON.stringify(f.message));
      expect(
        inspect.prepare("SELECT name FROM sqlite_master WHERE name='input_admissions'").get(),
      ).toBeUndefined();
      expect(
        inspect
          .prepare('PRAGMA table_info(messages)')
          .all()
          .some((row) => row['name'] === 'audience_key'),
      ).toBe(false);
    } finally {
      inspect.close();
    }
  } finally {
    if (f.db.isOpen) f.db.close();
    await cleanup(f.directory);
  }
}, 15000);
