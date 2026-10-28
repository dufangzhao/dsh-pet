import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { discoverPlugins } from '@pet/host-kernel';
import { BuiltinRegistry } from './builtin-registry.js';
const roots: string[] = [];
afterEach(async () => {
  for (const dir of roots.splice(0)) {
    if (!path.basename(dir).startsWith('pet-builtins-')) throw new Error('Unsafe cleanup');
    await fs.rm(dir, { recursive: true, force: true });
  }
});
async function fixture() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pet-builtins-'));
  roots.push(dir);
  const bundled = path.join(dir, 'bundled'),
    pkg = path.join(bundled, 'example');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(
    path.join(pkg, 'plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'test.builtin',
      version: '1.0.0',
      displayName: { en: 'Builtin' },
      description: { en: 'Builtin' },
      license: 'MIT',
      host: '^1.0.0',
      platforms: ['win32-x64'],
      entries: { runtime: 'entry.mjs' },
    }),
  );
  await fs.writeFile(path.join(pkg, 'entry.mjs'), 'export default {activate(){}};');
  const source = (await discoverPlugins([{ directory: bundled, origin: 'builtin' }])).plugins[0]!;
  return { dir, pkg, source };
}
it('persists deliberate removal, preserves packaged code and only verifies the displayed restore token', async () => {
  const f = await fixture();
  const registry = await BuiltinRegistry.create(f.dir);
  registry.register(f.source, false);
  expect(registry.removed(f.source.manifest.id)).toBe(false);
  expect(await registry.mark(f.source.manifest.id, true)).toBe(true);
  const descriptor = registry.available()[0]!;
  const restarted = await BuiltinRegistry.create(f.dir);
  restarted.register(f.source, false);
  expect(restarted.removed(descriptor.pluginId)).toBe(true);
  expect(await restarted.verified(descriptor.pluginId, '0'.repeat(64))).toBeNull();
  expect(await restarted.verified(descriptor.pluginId, descriptor.digest)).toBe(f.source);
  expect(await fs.readFile(path.join(f.pkg, 'entry.mjs'), 'utf8')).toContain('activate');
  await fs.writeFile(path.join(f.pkg, 'entry.mjs'), 'changed');
  expect(await restarted.verified(descriptor.pluginId, descriptor.digest)).toBeNull();
});
it('keeps protected builtin identities installed even if a prior removal marker exists', async () => {
  const f = await fixture(),
    registry = await BuiltinRegistry.create(f.dir);
  registry.register(f.source, false);
  await registry.mark(f.source.manifest.id, true);
  const current = await BuiltinRegistry.create(f.dir);
  current.register(f.source, true);
  expect(current.removed(f.source.manifest.id)).toBe(false);
  expect(current.available()).toEqual([]);
  expect(await current.mark(f.source.manifest.id, true)).toBe(false);
});
