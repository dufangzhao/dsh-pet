import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function sourceFiles(repository) {
  const git = spawn('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repository,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks = [];
  git.stdout.on('data', (bytes) => chunks.push(bytes));
  let errors = '';
  git.stderr.on('data', (bytes) => {
    errors += bytes;
  });
  const [code] = await once(git, 'exit');
  assert.equal(code, 0, errors);
  return [...new Set(Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean))].sort();
}
export async function cloneWorkspace(repository, destination, names) {
  let copied = 0;
  for (const name of names) {
    if (
      /(^|\/)(?:node_modules|\.git|\.cache|\.companion-data|userdata|Coopanion|\.env[^/]*|\.npmrc)(\/|$)/.test(
        name,
      ) ||
      name.startsWith('.trellis/') ||
      /\/evidence\//.test(name)
    )
      continue;
    if (
      !/\.(?:[cm]?[jt]sx?|json|ya?ml|patch|html|css|md|svg|ps1)$/.test(name) &&
      !['pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(name)
    )
      continue;
    assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'));
    const source = path.join(repository, name),
      target = path.join(destination, name),
      info = await lstat(source);
    assert.ok(info.isFile() && !info.isSymbolicLink(), `Nonregular source file ${name}`);
    const before = digest(await readFile(source));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
    assert.equal(digest(await readFile(source)), before, `Source changed during copy: ${name}`);
    assert.equal(digest(await readFile(target)), before, `Partial source copy: ${name}`);
    copied++;
  }
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    assert.ok((await lstat(path.join(destination, name))).isFile());
  return copied;
}
/** Metadata and dependency links are a separate fence from the raw lockfile. Never mutate the source modules. */
export async function sourceModulesState(repository, names) {
  const result = {};
  const roots = [
    '',
    ...names
      .filter((name) => /^(?:apps|packages|plugins)\/[^/]+\/package\.json$/.test(name))
      .map((name) => path.dirname(name)),
  ];
  const capture = async (name) => {
    const absolute = path.join(repository, name);
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) result[name] = { link: await readlink(absolute) };
      else if (info.isFile()) result[name] = { sha256: digest(await readFile(absolute)) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      result[name] = null;
    }
  };
  for (const name of [
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'node_modules/.modules.yaml',
    'node_modules/.pnpm-workspace-state-v1.json',
    'node_modules/.pnpm/lock.yaml',
  ])
    await capture(name);
  const links = async (folder, depth) => {
    let entries;
    try {
      entries = await readdir(path.join(repository, folder), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const name = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) await capture(name);
      else if (entry.isFile() && folder.endsWith('.bin')) await capture(name);
      else if (
        entry.isDirectory() &&
        depth > 0 &&
        (entry.name.startsWith('@') || entry.name === '.bin')
      )
        await links(name, depth - 1);
    }
  };
  for (const root of roots) await links(path.join(root, 'node_modules'), 2);
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}
