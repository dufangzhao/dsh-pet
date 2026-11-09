import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StateFailure } from './validation.js';

/** The same OS-backed writer boundary serves startup and explicit offline migration. */
export function openStateDatabase(dataDirectory: string): DatabaseSync {
  if (!isAbsolute(dataDirectory)) throw new StateFailure('invalid-input');
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDirectory, 'state.sqlite'));
  try {
    db.exec(
      'PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE;',
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
