import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { PluginSnapshot } from '@pet/host-kernel';
import { removeUserPlugin } from './plugin-removal.js';
const dirs: string[] = [];
const plugin: PluginSnapshot = {
  owner: { pluginId: 'test.remove', instanceId: 'default', generation: 1 },
  state: 'disabled',
  origin: 'user',
  protected: false,
  manifest: {
    schemaVersion: 1,
    id: 'test.remove',
    version: '1.0.0',
    displayName: { en: 'Remove' },
    description: { en: 'Remove' },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['win32-x64'],
    entries: { runtime: 'index.mjs' },
  },
};
async function setup() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pet-removal-'));
  dirs.push(dir);
  const root = path.join(dir, 'plugins'),
    pkg = path.join(root, 'example');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(pkg, 'index.mjs'), 'fixture');
  return { dir, root, pkg };
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    if (!path.basename(dir).startsWith('pet-removal-')) throw new Error('Invalid cleanup');
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('removes the registered user code package and preserves neighboring configuration/data', async () => {
  const { dir, root, pkg } = await setup();
  const data = path.join(dir, 'plugin-data');
  await fs.mkdir(data);
  await fs.writeFile(path.join(data, 'keep'), 'keep');
  expect(await removeUserPlugin(root, plugin, { directory: pkg, origin: 'user' })).toBe(true);
  await expect(fs.stat(pkg)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(data, 'keep'), 'utf8')).toBe('keep');
});
it('rejects protected, builtin, root and out-of-root targets', async () => {
  const { dir, root, pkg } = await setup();
  const outside = path.join(dir, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep'), 'keep');
  expect(
    await removeUserPlugin(
      root,
      { ...plugin, protected: true },
      { directory: pkg, origin: 'user' },
    ),
  ).toBe(false);
  expect(
    await removeUserPlugin(
      root,
      { ...plugin, origin: 'builtin' },
      { directory: pkg, origin: 'builtin' },
    ),
  ).toBe(false);
  for (const target of [root, outside])
    expect(await removeUserPlugin(root, plugin, { directory: target, origin: 'user' })).toBe(false);
  expect(await fs.readFile(path.join(pkg, 'index.mjs'), 'utf8')).toBe('fixture');
  expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('keep');
});
it('rejects linked package/root directories and does not traverse nested junctions when removing code', async () => {
  const { dir, root, pkg } = await setup();
  const outside = path.join(dir, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep'), 'keep');
  const linked = path.join(root, 'linked');
  await fs.symlink(outside, linked, 'junction');
  expect(await removeUserPlugin(root, plugin, { directory: linked, origin: 'user' })).toBe(false);
  const alias = path.join(dir, 'alias');
  await fs.symlink(root, alias, 'junction');
  expect(
    await removeUserPlugin(alias, plugin, {
      directory: path.join(alias, 'example'),
      origin: 'user',
    }),
  ).toBe(false);
  await fs.symlink(outside, path.join(pkg, 'resources'), 'junction');
  expect(await removeUserPlugin(root, plugin, { directory: pkg, origin: 'user' })).toBe(true);
  expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('keep');
});
