import type { DatabaseSync } from 'node:sqlite';
import type { CompanionFact, CompanionMessage, CompanionTask } from '@pet/contracts';
import { legacyOrigin, legacyTaskOrigin, OWNER_AUDIENCE, OWNER_AUDIENCE_KEY } from './scope.js';

export const STATE_FORMAT_VERSION = 3;

/** Called only inside the writer's existing transaction, after any required cold backup. */
export function upgradeStateV2ToV3(db: DatabaseSync): void {
  if (!db.isTransaction || db.prepare('PRAGMA user_version').get()?.['user_version'] !== 2)
    throw new Error('state-migration-transaction-required');
  db.exec(`
    ALTER TABLE messages ADD COLUMN audience_key TEXT NOT NULL DEFAULT '${OWNER_AUDIENCE_KEY}';
    ALTER TABLE messages ADD COLUMN principal_id TEXT;
    ALTER TABLE tasks ADD COLUMN audience_key TEXT NOT NULL DEFAULT '${OWNER_AUDIENCE_KEY}';
    ALTER TABLE tasks ADD COLUMN principal_id TEXT;
    ALTER TABLE events ADD COLUMN audience_key TEXT NOT NULL DEFAULT '${OWNER_AUDIENCE_KEY}';
    ALTER TABLE events ADD COLUMN principal_id TEXT;
    CREATE INDEX messages_audience ON messages(audience_key,sequence);
    CREATE INDEX tasks_audience ON tasks(audience_key,principal_id,sequence);
    CREATE INDEX events_audience ON events(audience_key,sequence);
    CREATE TABLE facts_v3 (audience_key TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(audience_key,key));
    CREATE TABLE input_admissions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, command_id TEXT UNIQUE, fingerprint TEXT NOT NULL, audience_key TEXT NOT NULL, principal_id TEXT, phase TEXT NOT NULL, body TEXT NOT NULL, evidence TEXT NOT NULL);
    CREATE INDEX inputs_scope ON input_admissions(audience_key,phase,sequence);
    CREATE TABLE conversation_observations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, audience_key TEXT NOT NULL, observed_at INTEGER NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX observations_scope ON conversation_observations(audience_key,observed_at,sequence);
    CREATE TABLE materials (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, input_id TEXT REFERENCES input_admissions(id), observation_id TEXT, audience_key TEXT NOT NULL, phase TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX materials_scope ON materials(audience_key,sequence);
    CREATE TABLE qq_deliveries (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, audience_key TEXT NOT NULL, principal_id TEXT, phase TEXT NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX deliveries_scope ON qq_deliveries(audience_key,sequence);
    CREATE TABLE qq_judgments (id TEXT PRIMARY KEY, event_key TEXT NOT NULL, audience_key TEXT NOT NULL, claimed_at INTEGER NOT NULL, phase TEXT NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(audience_key,event_key));
    CREATE INDEX judgments_hour ON qq_judgments(claimed_at);
    CREATE INDEX judgments_group ON qq_judgments(audience_key,claimed_at);
  `);
  for (const row of db.prepare('SELECT id,body FROM messages').all()) {
    const message = JSON.parse(String(row['body'])) as CompanionMessage;
    db.prepare('UPDATE messages SET principal_id=?,body=? WHERE id=?').run(
      'owner',
      JSON.stringify({
        ...message,
        audience: OWNER_AUDIENCE,
        origins: [legacyOrigin()],
        materials: [],
        content: { kind: 'inline-text' },
      }),
      String(row['id']),
    );
  }
  for (const row of db.prepare('SELECT id,body FROM tasks').all()) {
    const task = JSON.parse(String(row['body'])) as CompanionTask;
    db.prepare('UPDATE tasks SET principal_id=?,body=? WHERE id=?').run(
      'owner',
      JSON.stringify({ ...task, origin: legacyTaskOrigin() }),
      String(row['id']),
    );
  }
  for (const row of db.prepare('SELECT key,body FROM facts').all()) {
    const fact = JSON.parse(String(row['body'])) as CompanionFact;
    db.prepare('INSERT INTO facts_v3(audience_key,key,body) VALUES(?,?,?)').run(
      OWNER_AUDIENCE_KEY,
      String(row['key']),
      JSON.stringify({ ...fact, audience: OWNER_AUDIENCE }),
    );
  }
  db.exec(
    "UPDATE events SET principal_id='owner'; DROP TABLE facts; ALTER TABLE facts_v3 RENAME TO facts; PRAGMA user_version=3;",
  );
}
