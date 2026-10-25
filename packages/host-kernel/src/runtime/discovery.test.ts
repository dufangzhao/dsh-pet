import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { discoverPlugins, createVerifiedPluginLoader } from './discovery.js';
const roots: string[] = [];
async function root() {
  const r = await fs.mkdtemp(path.join(tmpdir(), 'pet-discovery-'));
  roots.push(r);
  return r;
}
const manifest = {
  schemaVersion: 1,
  id: 'test.file',
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '测试' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'index.mjs' },
};
async function pack(root: string) {
  const p = path.join(root, 'package');
  await fs.mkdir(p);
  await fs.writeFile(path.join(p, 'plugin.json'), JSON.stringify(manifest));
  await fs.writeFile(
    path.join(p, 'index.mjs'),
    'export default { activate(context) { context.effect(() => () => {}); } };',
  );
  return p;
}
afterEach(async () => {
  for (const r of roots.splice(0)) {
    if (!path.basename(r).startsWith('pet-discovery-')) throw new Error('Unsafe cleanup');
    await fs.rm(r, { recursive: true, force: true });
  }
});
it('discovers without evaluating entry code and records bounded evidence', async () => {
  const r = await root();
  const p = await pack(r);
  await fs.writeFile(
    path.join(p, 'index.mjs'),
    'throw new Error("must-not-run-during-discovery");',
  );
  const report = await discoverPlugins([{ directory: r, origin: 'user' }]);
  expect(report.complete).toBe(true);
  expect(report.issues).toEqual([]);
  expect(report.plugins).toHaveLength(1);
  expect(report.plugins[0]?.files).toHaveLength(2);
  expect(Object.isFrozen(report.plugins[0]?.manifest)).toBe(true);
});
it('imports only after rechecking the discovered manifest and entry', async () => {
  const r = await root();
  const p = await pack(r);
  const report = await discoverPlugins([{ directory: r, origin: 'builtin' }]);
  const candidate = report.plugins[0]!;
  const loader = createVerifiedPluginLoader(report.plugins);
  const activation = {
    owner: { pluginId: manifest.id, instanceId: 'default', generation: 1 },
    manifest: candidate.manifest,
    entryPath: path.join(p, 'index.mjs'),
    config: {},
    signal: new AbortController().signal,
  };
  expect(typeof (await loader(activation)).activate).toBe('function');
  await fs.appendFile(path.join(p, 'index.mjs'), String.fromCharCode(10) + '// changed');
  await expect(loader(activation)).rejects.toThrow('Package changed');
});
it('refuses fabricated candidates and does not read through junctions', async () => {
  expect(() => createVerifiedPluginLoader([{} as never])).toThrow('Unverified package');
  const r = await root();
  const actual = path.join(r, 'real');
  await fs.mkdir(actual);
  await pack(actual);
  const alias = path.join(r, 'alias');
  await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const report = await discoverPlugins([{ directory: alias, origin: 'user' }]);
  expect(report.complete).toBe(false);
  expect(report.plugins).toEqual([]);
});
it('rejects an entry reached through an intermediate junction', async () => {
  const r = await root();
  const p = await pack(r);
  const target = await root();
  await fs.writeFile(path.join(target, 'index.mjs'), 'export default {};');
  await fs.symlink(
    target,
    path.join(p, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await fs.writeFile(
    path.join(p, 'plugin.json'),
    JSON.stringify({ ...manifest, entries: { runtime: 'linked/index.mjs' } }),
  );
  const report = await discoverPlugins([{ directory: r, origin: 'user' }]);
  expect(report.plugins).toEqual([]);
  expect(report.issues).toHaveLength(1);
});
it('rejects oversized or malformed manifests with fixed errors', async () => {
  const r = await root();
  const p = await pack(r);
  await fs.writeFile(path.join(p, 'plugin.json'), 'private-fixture'.repeat(6000));
  const report = await discoverPlugins([{ directory: r, origin: 'user' }]);
  expect(report.plugins).toEqual([]);
  expect(JSON.stringify(report.issues)).not.toContain('private-fixture');
  expect(report.issues[0]?.error.code).toBe('invalid-input');
});
it('does not choose a fallback directory for a missing source', async () => {
  const r = await root();
  const report = await discoverPlugins([{ directory: path.join(r, 'missing'), origin: 'user' }]);
  expect(report.complete).toBe(false);
  expect(report.plugins).toEqual([]);
});
