import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { KernelFault } from '@pet/host-kernel';
import {
  memoryUsage,
  openStateDatabase,
  upgradeStateV2ToV3,
  upgradeStateV3ToV4,
} from '@pet/state-sqlite';
import type { CompanionFact } from '@pet/contracts';

async function inventory(root: string, relative = ''): Promise<readonly string[]> {
  const rows: string[] = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const key = path.join(relative, name);
    const file = path.join(root, key);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) rows.push(JSON.stringify(['link', key, await readlink(file)]));
    else if (stat.isDirectory()) {
      rows.push(JSON.stringify(['dir', key]));
      rows.push(...(await inventory(root, key)));
    } else if (stat.isFile()) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      rows.push(JSON.stringify(['file', key, hash.digest('hex')]));
    } else throw new KernelFault('invalid-input');
  }
  return rows;
}
const nested = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

/** Explicit cold upgrade only. The caller stops/drains the service; SQLite proves writer exclusion. */
export async function migrateCompanionData(options: {
  dataDirectory: string;
  backupDirectory: string;
}): Promise<{
  fromVersion: 1 | 2 | 3;
  toVersion: 4;
  agentId: string;
  epoch: string;
  memoryRevision: number;
  backupDirectory: string;
}> {
  const root = await realpath(options.dataDirectory);
  const requested = path.resolve(options.backupDirectory);
  const backup = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  if (nested(root, backup) || nested(backup, root)) throw new KernelFault('invalid-input');
  const existing = await lstat(backup).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  });
  if (existing) throw new KernelFault('conflict');
  const state = path.join(root, 'state');
  if (
    !(await lstat(state)).isDirectory() ||
    !(await lstat(path.join(state, 'state.sqlite'))).isFile()
  )
    throw new KernelFault('not-ready');
  const db = openStateDatabase(state);
  try {
    const version = db.prepare('PRAGMA user_version').get()?.['user_version'];
    if (version !== 1 && version !== 2 && version !== 3) throw new KernelFault('conflict');
    // Admit the actual old format, not a partial database merely carrying its version marker.
    for (const query of [
      'SELECT sequence,id,fingerprint,body FROM messages LIMIT 0',
      'SELECT sequence,id,execution_id,status,body,command FROM tasks LIMIT 0',
      'SELECT id,task_id,body FROM artifacts LIMIT 0',
      'SELECT id,fingerprint,body FROM commands LIMIT 0',
      'SELECT sequence,body FROM events LIMIT 0',
    ])
      db.prepare(query).all();
    if (version === 3) {
      for (const query of [
        'SELECT audience_key,principal_id FROM messages LIMIT 0',
        'SELECT audience_key,principal_id FROM tasks LIMIT 0',
        'SELECT audience_key,principal_id FROM events LIMIT 0',
        'SELECT audience_key,key,body FROM facts LIMIT 0',
        'SELECT sequence,id,command_id,fingerprint,audience_key,principal_id,phase,body,evidence FROM input_admissions LIMIT 0',
        'SELECT sequence,id,audience_key,observed_at,fingerprint,body FROM conversation_observations LIMIT 0',
        'SELECT sequence,id,input_id,observation_id,audience_key,phase,body FROM materials LIMIT 0',
        'SELECT sequence,id,audience_key,principal_id,phase,fingerprint,body FROM qq_deliveries LIMIT 0',
        'SELECT id,event_key,audience_key,claimed_at,phase,fingerprint,body FROM qq_judgments LIMIT 0',
      ])
        db.prepare(query).all();
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new KernelFault('conflict');
    const row = db.prepare('SELECT body FROM identity WHERE singleton=1').get();
    const identity = JSON.parse(String(row?.['body'])) as Record<string, unknown>;
    if (typeof identity['assistantId'] !== 'string' || typeof identity['epoch'] !== 'string')
      throw new KernelFault('invalid-input');
    const facts = db
      .prepare('SELECT body FROM facts ORDER BY key')
      .all()
      .map((item) => JSON.parse(String(item['body'])) as CompanionFact);
    for (const fact of facts) {
      if (
        typeof fact.key !== 'string' ||
        fact.key.length < 1 ||
        fact.key.length > 128 ||
        typeof fact.value !== 'string' ||
        fact.value.length < 1 ||
        fact.value.length > 2048 ||
        !Number.isSafeInteger(fact.revision) ||
        fact.revision < 1 ||
        !Number.isFinite(fact.updatedAt)
      )
        throw new KernelFault('invalid-input');
    }
    memoryUsage(facts);
    const minimumRevision = Math.max(0, ...facts.map((fact) => fact.revision));
    const revision = version === 1 ? minimumRevision : identity['memoryRevision'];
    if (
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < minimumRevision
    )
      throw new KernelFault('conflict');
    const before = await inventory(root);
    await mkdir(backup, { mode: 0o700 });
    for (const name of await readdir(root))
      await cp(path.join(root, name), path.join(backup, name), {
        recursive: true,
        force: false,
        errorOnExist: true,
        dereference: false,
        verbatimSymlinks: true,
      });
    if (
      JSON.stringify(before) !== JSON.stringify(await inventory(backup)) ||
      JSON.stringify(before) !== JSON.stringify(await inventory(root))
    )
      throw new KernelFault('conflict');
    // The complete old root is verified before either upgrade step changes any record.
    if (version === 1) {
      db.prepare('UPDATE identity SET body=? WHERE singleton=1').run(
        JSON.stringify({ ...identity, memoryRevision: revision }),
      );
      db.exec('PRAGMA user_version=2;');
    }
    if (version !== 3) upgradeStateV2ToV3(db);
    upgradeStateV3ToV4(db);
    db.exec('COMMIT;');
    return {
      fromVersion: version,
      toVersion: 4,
      agentId: identity['assistantId'],
      epoch: identity['epoch'],
      memoryRevision: revision,
      backupDirectory: backup,
    };
  } finally {
    // Closing rolls back both upgrade steps together if any part fails.
    db.close();
  }
}
