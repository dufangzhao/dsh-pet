import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileConfigStore } from './file-store.js';
import { PluginDataDirectories } from './data-directories.js';
import type { StoredConfig } from './store.js';
const id = { pluginId: 'test.files', instanceId: 'default' };
const row = (revision = 1): StoredConfig => ({
  format: 1,
  ...id,
  schemaVersion: 1,
  revision,
  data: { value: revision },
});
const roots: string[] = [];
async function root() {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pet-config-'));
  roots.push(dir);
  return dir;
}
const filename = () =>
  createHash('sha256')
    .update(JSON.stringify([id.pluginId, id.instanceId]))
    .digest('hex') + '.config.json';
afterEach(async () => {
  for (const dir of roots.splice(0)) {
    if (!path.basename(dir).startsWith('pet-config-')) throw new Error('Unsafe cleanup');
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('publishes one namespace atomically and rejects a stale revision', async () => {
  const dir = await root(),
    store = new FileConfigStore(dir);
  expect(await store.read(id)).toBeNull();
  expect(await store.compareAndSet(id, null, row())).toBe(true);
  expect(await store.compareAndSet(id, 1, row(2))).toBe(true);
  expect(await store.compareAndSet(id, 1, row(2))).toBe(false);
  expect(await store.read(id)).toEqual(row(2));
  expect(
    (await fs.readdir(dir)).filter((name) => name.endsWith('.lock') || name.endsWith('.tmp')),
  ).toEqual([]);
});
it('does not expose one instance through another namespace', async () => {
  const dir = await root(),
    store = new FileConfigStore(dir);
  await store.compareAndSet(id, null, row());
  expect(await store.read({ ...id, instanceId: 'other' })).toBeNull();
  const file = path.join(dir, filename());
  await fs.writeFile(file, JSON.stringify({ ...row(), pluginId: 'other.plugin' }));
  await expect(store.read(id)).rejects.toThrow('Configuration storage unavailable');
});
it('retains corrupt records rather than silently overwriting defaults', async () => {
  const dir = await root(),
    store = new FileConfigStore(dir);
  await fs.writeFile(path.join(dir, filename()), 'private-corrupt-fixture');
  await expect(store.read(id)).rejects.toThrow('Configuration storage unavailable');
  await expect(store.compareAndSet(id, null, row())).rejects.toThrow(
    'Configuration storage unavailable',
  );
  expect(await fs.readFile(path.join(dir, filename()), 'utf8')).toBe('private-corrupt-fixture');
  expect((await fs.readdir(dir)).some((n) => n.endsWith('.lock'))).toBe(false);
});
it('does not write when cancellation precedes the commit fence', async () => {
  const dir = await root(),
    store = new FileConfigStore(dir),
    abort = new AbortController();
  await store.compareAndSet(id, null, row());
  abort.abort();
  await expect(store.compareAndSet(id, 1, row(2), abort.signal)).rejects.toThrow(
    'Configuration storage unavailable',
  );
  expect(await store.read(id)).toEqual(row());
});
it('refuses linked roots and hard-linked configuration files', async () => {
  const dir = await root(),
    real = path.join(dir, 'real'),
    alias = path.join(dir, 'alias');
  await fs.mkdir(real);
  await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(new FileConfigStore(alias).read(id)).rejects.toThrow();
  const store = new FileConfigStore(real);
  await store.compareAndSet(id, null, row());
  await fs.link(path.join(real, filename()), path.join(real, 'second-link'));
  await expect(store.read(id)).rejects.toThrow();
});
it('does not remove another writer lock or assume it is stale', async () => {
  const dir = await root(),
    store = new FileConfigStore(dir);
  const name = filename().replace('.config.json', '.lock');
  await fs.writeFile(path.join(dir, name), '');
  await expect(store.compareAndSet(id, null, row())).rejects.toThrow();
  expect(await fs.readFile(path.join(dir, name), 'utf8')).toBe('');
});
it('isolates data directories and rejects an ancestor junction', async () => {
  const dir = await root(),
    data = new PluginDataDirectories(dir);
  const a = await data.get(id),
    b = await data.get({ ...id, instanceId: 'other' });
  expect(a.ok && b.ok && a.value !== b.value).toBe(true);
  if (a.ok) expect(path.relative(dir, a.value).startsWith('..')).toBe(false);
  const target = await root(),
    alias = path.join(dir, 'linked-root');
  await fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  expect(await new PluginDataDirectories(alias).get(id)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
});
it('persists bounded JSON through a real write and a fresh store instance', async () => {
  const dir = await root(),
    store = new FileConfigStore(dir);
  const value = { ...row(), data: { text: '测试配置', nested: { enabled: true } } };
  expect(await store.compareAndSet(id, null, value)).toBe(true);
  expect(await new FileConfigStore(dir).read(id)).toEqual(value);
});
