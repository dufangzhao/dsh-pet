import {
  companionAudienceKey,
  QQ_GROUP_CONTEXT_MAX_MESSAGES,
  QQ_GROUP_CONTEXT_MAX_AGE_MS,
  QQ_GROUP_CONTEXT_MAX_BYTES,
} from '@pet/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { StateObservation, StateMethodInputs, StateMethodOutputs } from './types.js';
import { decode, fingerprint } from './records.js';
import { assertVisible, scopeWhere } from './scope.js';
import { jsonBytes } from './validation.js';
import { StateFailure } from './failure.js';
import { getMaterial } from './inputs.js';

export function getObservation(
  db: DatabaseSync,
  input: StateMethodInputs['getObservation'],
): StateObservation {
  const observation = decode<StateObservation>(
    db
      .prepare('SELECT body FROM conversation_observations WHERE id=? AND observed_at>=?')
      .get(input.id, Date.now() - QQ_GROUP_CONTEXT_MAX_AGE_MS),
  );
  assertVisible(observation.audience, input.scope);
  return observation;
}

export function pruneObservations(
  db: DatabaseSync,
  input: StateMethodInputs['pruneObservations'],
): StateMethodOutputs['pruneObservations'] {
  const removed = db
    .prepare('DELETE FROM conversation_observations WHERE observed_at<?')
    .run((input.now ?? Date.now()) - QQ_GROUP_CONTEXT_MAX_AGE_MS).changes;
  return { removed: Number(removed) };
}

function observationFingerprint(observation: StateObservation): string {
  const intent: Record<string, unknown> = { ...observation };
  // Receipt time is local metadata; stable native identity and content define the intent.
  delete intent['observedAt'];
  return fingerprint(intent);
}

export function observe(
  db: DatabaseSync,
  input: StateMethodInputs['observe'],
): StateMethodOutputs['observe'] {
  const observation = input.observation;
  const digest = observationFingerprint(observation);
  const known = db
    .prepare('SELECT body FROM conversation_observations WHERE id=?')
    .get(observation.id);
  if (known) {
    const stored = decode<StateObservation>(known);
    if (observationFingerprint(stored) !== digest) throw new StateFailure('conflict');
    pruneObservations(db, {});
    return {
      observation: stored,
      duplicate: true,
      retained: !!db
        .prepare('SELECT id FROM conversation_observations WHERE id=?')
        .get(observation.id),
    };
  }
  if (jsonBytes([observation]) > QQ_GROUP_CONTEXT_MAX_BYTES)
    throw new StateFailure('quota-exceeded');
  if (observation.observedAt > Date.now()) throw new StateFailure('invalid-input');
  for (const id of observation.materialIds) {
    const material = getMaterial(db, {
      id,
      scope: {
        kind: 'conversation',
        audience: observation.audience,
        principalId: observation.principalId,
      },
    });
    if (material.phase !== 'ready') throw new StateFailure('not-ready');
  }
  const audience = companionAudienceKey(observation.audience);
  db.prepare(
    'INSERT INTO conversation_observations(id,audience_key,observed_at,fingerprint,body) VALUES(?,?,?,?,?)',
  ).run(observation.id, audience, observation.observedAt, digest, JSON.stringify(observation));
  pruneObservations(db, {});
  const rows = db
    .prepare(
      'SELECT id,body FROM conversation_observations WHERE audience_key=? ORDER BY observed_at DESC,sequence DESC',
    )
    .all(audience);
  const retained: StateObservation[] = [];
  for (const row of rows) {
    const item = decode<StateObservation>(row);
    if (
      retained.length >= QQ_GROUP_CONTEXT_MAX_MESSAGES ||
      jsonBytes([...retained, item]) > QQ_GROUP_CONTEXT_MAX_BYTES
    )
      db.prepare('DELETE FROM conversation_observations WHERE id=?').run(String(row['id']));
    else retained.push(item);
  }
  return {
    observation,
    duplicate: false,
    retained: !!db
      .prepare('SELECT id FROM conversation_observations WHERE id=?')
      .get(observation.id),
  };
}

export function observations(
  db: DatabaseSync,
  input: StateMethodInputs['observations'],
): StateMethodOutputs['observations'] {
  const selected = scopeWhere(input.scope, 'other');
  const rows = db
    .prepare(
      `SELECT body FROM conversation_observations WHERE ${selected.sql} AND observed_at>=? ORDER BY observed_at DESC,sequence DESC LIMIT ?`,
    )
    .all(
      ...selected.params,
      (input.now ?? Date.now()) - QQ_GROUP_CONTEXT_MAX_AGE_MS,
      QQ_GROUP_CONTEXT_MAX_MESSAGES + 1,
    );
  const result: StateObservation[] = [];
  for (const row of rows.slice(0, QQ_GROUP_CONTEXT_MAX_MESSAGES)) {
    const item = decode<StateObservation>(row);
    if (jsonBytes([...result, item]) > QQ_GROUP_CONTEXT_MAX_BYTES) break;
    result.push(item);
  }
  return { observations: result.reverse(), hasMore: rows.length > result.length };
}
