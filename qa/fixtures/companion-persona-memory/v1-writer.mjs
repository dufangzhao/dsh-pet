// Loads exact cab4d79 v1 provider source in a synthetic temporary module tree.
// Current browser-safe contracts resolve from the workspace; no old user profile is read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

export async function loadBaselineV1Writer() {
  const workspace = fileURLToPath(new URL('../../..', import.meta.url));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-old-writer-'));
  await mkdir(path.join(directory, 'node_modules', '@pet'), { recursive: true });
  await symlink(path.join(workspace, 'packages/contracts'), path.join(directory, 'node_modules/@pet/contracts'), 'dir');
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n', { flag: 'wx' });
  const sourceHashes = {};
  for (const name of ['state.ts', 'types.ts', 'validation.ts']) {
    const result = spawnSync('git', ['show', `cab4d79:plugins/state-sqlite/src/${name}`],
      { cwd: workspace, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Cannot load baseline v1 ${name}`);
    await writeFile(path.join(directory, name), result.stdout, { flag: 'wx' });
    const { createHash } = await import('node:crypto');
    sourceHashes[name] = createHash('sha256').update(result.stdout).digest('hex');
  }
  register();
  const { SqliteState } = await import(pathToFileURL(path.join(directory, 'state.ts')).href);
  assert.equal(typeof SqliteState, 'function');
  return { SqliteState, sourceHashes };
}
