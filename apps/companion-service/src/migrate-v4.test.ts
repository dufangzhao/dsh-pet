import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { SqliteState, openStateDatabase, upgradeStateV3ToV4 } from '@pet/state-sqlite';
import type {
  CompanionInputOrigin,
  QQDeliveryAttempt,
  QQDeliveryView,
  QQReplyRoute,
} from '@pet/contracts';
import { migrateCompanionData } from './migrate.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('non-json fixture');
  return result;
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-migrate-v4-'));
  const root = path.join(directory, 'data'),
    stateRoot = path.join(root, 'state');
  await mkdir(stateRoot, { recursive: true });
  await writeFile(path.join(root, 'owned-material.bin'), Buffer.from([0, 255, 17, 128]));
  const database = path.join(stateRoot, 'state.sqlite');
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE identity(singleton INTEGER PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,body TEXT NOT NULL,audience_key TEXT NOT NULL,principal_id TEXT);
    CREATE TABLE tasks(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,execution_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,body TEXT NOT NULL,command TEXT NOT NULL,audience_key TEXT NOT NULL,principal_id TEXT);
    CREATE TABLE facts(audience_key TEXT NOT NULL,key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(audience_key,key));
    CREATE TABLE artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),body TEXT NOT NULL);
    CREATE TABLE commands(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL,audience_key TEXT NOT NULL,principal_id TEXT);
    CREATE TABLE input_admissions(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,command_id TEXT UNIQUE,fingerprint TEXT NOT NULL,audience_key TEXT NOT NULL,principal_id TEXT,phase TEXT NOT NULL,body TEXT NOT NULL,evidence TEXT NOT NULL);
    CREATE TABLE conversation_observations(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,audience_key TEXT NOT NULL,observed_at INTEGER NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE materials(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,input_id TEXT REFERENCES input_admissions(id),observation_id TEXT,audience_key TEXT NOT NULL,phase TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE qq_deliveries(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,audience_key TEXT NOT NULL,principal_id TEXT,phase TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE qq_judgments(id TEXT PRIMARY KEY,event_key TEXT NOT NULL,audience_key TEXT NOT NULL,claimed_at INTEGER NOT NULL,phase TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(audience_key,event_key));
    PRAGMA user_version=3;
  `);
  db.prepare('INSERT INTO identity VALUES(1,?)').run(
    JSON.stringify({ assistantId: 'agent-preserved', epoch: 'epoch-preserved', memoryRevision: 7 }),
  );
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
      messageId: 'original-native-message',
      occurredAt: 1700000000000,
      displayReference: null,
    },
  };
  const origin: CompanionInputOrigin = {
    kind: 'qq',
    inputId: 'original-input',
    principalId: 'person',
    audience: { kind: 'person-private', principalId: 'person' },
    route,
    policyRevision: 1,
    actor: { account, scene: 'private', senderId: 'sender' },
    eventKey: 'original-event',
    messageId: 'original-native-message',
    trigger: 'direct',
    quote: null,
  };
  const proposal: QQDeliveryView = {
    id: 'original-delivery',
    messageIds: ['original-reply'],
    origins: [origin],
    audience: origin.audience,
    route,
    textRepresentation: 'inline',
    mode: 'official-passive',
    eligibilityExpiresAt: 1700000300000,
    allowedMessageParts: 4,
    phase: 'prepared',
    outcome: 'pending',
    createdAt: 1700000000001,
    updatedAt: 1700000000001,
    error: null,
    parts: [
      {
        id: 'original-part',
        index: 0,
        requirement: 'mandatory-text',
        content: {
          kind: 'inline-text',
          text: 'retained reply',
          sha256: createHash('sha256').update('retained reply').digest('hex'),
        },
        preparation: 'ready',
        error: null,
        msgSeq: null,
        upload: null,
        send: null,
      },
    ],
  };
  const attempt: QQDeliveryAttempt = {
    id: 'original-attempt',
    operation: 'send',
    phase: 'dispatched',
    outcome: 'pending',
    correlationId: 'real-original-echo',
    receipt: null,
    cleanup: 'pending',
    startedAt: 1700000000002,
    settledAt: null,
    error: null,
  };
  const delivery: QQDeliveryView = {
    ...proposal,
    phase: 'sending',
    updatedAt: 1700000000003,
    parts: proposal.parts.map((part) => ({ ...part, msgSeq: 1, send: attempt })),
  };
  const hash = createHash('sha256').update(canonical(proposal)).digest('hex');
  db.prepare(
    'INSERT INTO qq_deliveries(id,audience_key,principal_id,phase,fingerprint,body) VALUES(?,?,?,?,?,?)',
  ).run(
    delivery.id,
    '["person-private","person"]',
    'person',
    delivery.phase,
    hash,
    JSON.stringify(delivery),
  );
  db.prepare('INSERT INTO commands VALUES(?,?,?)').run(
    'old-command',
    'unchanged-command-fingerprint',
    '{"commandId":"old-command","status":"accepted","messageId":"old-message","taskId":null}',
  );
  db.prepare('INSERT INTO events(sequence,body,audience_key,principal_id) VALUES(?,?,?,?)').run(
    4,
    '{"id":"epoch-preserved:4","epoch":"epoch-preserved","sequence":4,"time":1700000000003,"kind":"runtime","data":{"deliveryId":"original-delivery"}}',
    '["person-private","person"]',
    'person',
  );
  return { directory, root, stateRoot, database, db, proposal, delivery, hash };
}
async function cleanup(directory: string): Promise<void> {
  const target = await realpath(directory);
  if (
    path.dirname(target) !== (await realpath(tmpdir())) ||
    !path.basename(target).startsWith('companion-migrate-v4-')
  )
    throw new Error('unexpected fixture path');
  await rm(target, { recursive: true });
}

it('cold upgrades an independent format-three fixture without rewriting claims, epochs, scopes or legacy intent bytes', async () => {
  const f = await fixture();
  f.db.close();
  let state: SqliteState | undefined;
  try {
    const before = await readFile(f.database);
    expect(() => new SqliteState({ dataDirectory: f.stateRoot })).toThrow();
    const result = await migrateCompanionData({
      dataDirectory: f.root,
      backupDirectory: path.join(f.directory, 'backup'),
    });
    expect(result).toMatchObject({
      fromVersion: 3,
      toVersion: 4,
      agentId: 'agent-preserved',
      epoch: 'epoch-preserved',
      memoryRevision: 7,
    });
    expect(await readFile(path.join(result.backupDirectory, 'state', 'state.sqlite'))).toEqual(
      before,
    );
    expect(await readFile(path.join(result.backupDirectory, 'owned-material.bin'))).toEqual(
      Buffer.from([0, 255, 17, 128]),
    );
    const inspect = new DatabaseSync(f.database);
    try {
      expect(inspect.prepare('PRAGMA user_version').get()?.['user_version']).toBe(4);
      expect(
        inspect
          .prepare('SELECT fingerprint,body,execution_json FROM qq_deliveries WHERE id=?')
          .get(f.delivery.id),
      ).toMatchObject({
        fingerprint: f.hash,
        body: JSON.stringify(f.delivery),
        execution_json: null,
      });
      expect(inspect.prepare('SELECT COUNT(*) AS count FROM qq_deliveries').get()?.['count']).toBe(
        1,
      );
      expect(
        inspect.prepare('SELECT fingerprint FROM commands WHERE id=?').get('old-command')?.[
          'fingerprint'
        ],
      ).toBe('unchanged-command-fingerprint');
      expect(inspect.prepare('SELECT COUNT(*) AS count FROM events').get()?.['count']).toBe(1);
    } finally {
      inspect.close();
    }
    state = new SqliteState({ dataDirectory: f.stateRoot });
    expect(
      state.getDeliveryExecution({ id: f.delivery.id, scope: { kind: 'management' } }),
    ).toEqual({ ok: true, value: null });
    expect(state.getDelivery({ id: f.delivery.id, scope: { kind: 'management' } })).toEqual({
      ok: true,
      value: f.delivery,
    });
    expect(state.createDelivery({ delivery: f.proposal })).toEqual({ ok: true, value: f.delivery });
    expect(state.snapshot({ scope: { kind: 'management' } })).toMatchObject({
      ok: true,
      value: {
        assistantId: 'agent-preserved',
        epoch: 'epoch-preserved',
        memoryRevision: 7,
        cursor: 4,
      },
    });
    state.close();
    await expect(
      migrateCompanionData({
        dataDirectory: f.root,
        backupDirectory: path.join(f.directory, 'again'),
      }),
    ).rejects.toThrow();
  } finally {
    state?.close();
    await cleanup(f.directory);
  }
});

it('rejects an active writer and rolls back the new private column/version with a failed maintenance transaction', async () => {
  const f = await fixture();
  try {
    f.db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    await expect(
      migrateCompanionData({
        dataDirectory: f.root,
        backupDirectory: path.join(f.directory, 'locked'),
      }),
    ).rejects.toThrow();
    f.db.close();
    const before = await readFile(f.database);
    const transaction = openStateDatabase(f.stateRoot);
    try {
      upgradeStateV3ToV4(transaction);
      expect(() => transaction.exec('INSERT INTO nonexistent_table VALUES(1)')).toThrow();
    } finally {
      transaction.close();
    }
    expect(await readFile(f.database)).toEqual(before);
    const inspect = new DatabaseSync(f.database);
    try {
      expect(inspect.prepare('PRAGMA user_version').get()?.['user_version']).toBe(3);
      expect(
        inspect
          .prepare('PRAGMA table_info(qq_deliveries)')
          .all()
          .some((row) => row['name'] === 'execution_json'),
      ).toBe(false);
      expect(inspect.prepare('SELECT body FROM qq_deliveries').get()?.['body']).toBe(
        JSON.stringify(f.delivery),
      );
    } finally {
      inspect.close();
    }
  } finally {
    if (f.db.isOpen) f.db.close();
    await cleanup(f.directory);
  }
});
