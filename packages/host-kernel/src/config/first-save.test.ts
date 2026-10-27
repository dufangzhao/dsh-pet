import { expect, it, vi } from 'vitest';
import type { PluginManifest } from '@pet/contracts';
import { ConfigService } from './service.js';
import { MemoryConfigStore } from './store.js';
const id = { pluginId: 'test.first-save', instanceId: 'default' };
const manifest: PluginManifest = {
  schemaVersion: 1,
  id: id.pluginId,
  version: '1.0.0',
  displayName: { en: 'Config' },
  description: { en: 'Config' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'index.js' },
  config: {
    version: 1,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1 },
        count: { type: 'integer', default: 2 },
      },
    },
    apply: { name: 'restart', count: 'immediate' },
  },
};
function setup(store = new MemoryConfigStore()) {
  const service = new ConfigService(store);
  expect(service.register(id, manifest).ok).toBe(true);
  return { service, store };
}
it('inspects absent required data without writing, then creates revision one from a complete candidate', async () => {
  const { service, store } = setup();
  const write = vi.spyOn(store, 'compareAndSet');
  expect(await service.initialize(id)).toMatchObject({ ok: false, error: { code: 'not-ready' } });
  const inspected = await service.inspect(id);
  expect(inspected).toMatchObject({
    ok: true,
    value: { snapshot: null, definition: { defaults: { count: 2 } } },
  });
  if (!inspected.ok) throw new Error('inspect');
  expect(Object.keys(inspected.value.definition).sort()).toEqual([
    'defaults',
    'fields',
    'schema',
    'version',
  ]);
  expect(write).not.toHaveBeenCalled();
  expect(await service.save(id, {}, 0)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(await service.save(id, { name: 'first' }, 0)).toMatchObject({
    ok: true,
    value: {
      changeMode: 'restart',
      snapshot: { revision: 1, schemaVersion: 1, data: { name: 'first' } },
    },
  });
  expect(write).toHaveBeenCalledWith(id, null, expect.anything(), expect.any(AbortSignal));
  expect(await service.inspect(id)).toMatchObject({
    ok: true,
    value: { snapshot: { revision: 1 } },
  });
  expect(await service.save(id, { name: 'overwrite' }, 0)).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(await service.save(id, { name: 'first' }, 1)).toMatchObject({
    ok: true,
    value: { changeMode: null, snapshot: { revision: 1 } },
  });
});
it('serializes first saves and catches a competing CAS from another service', async () => {
  const { service, store } = setup();
  const raced = await Promise.all([
    service.save(id, { name: 'a' }, 0),
    service.save(id, { name: 'b' }, 0),
  ]);
  expect(raced.filter((r) => r.ok)).toHaveLength(1);
  expect(raced.find((r) => !r.ok)).toMatchObject({ error: { code: 'conflict' } });
  const other = setup(store).service;
  const updated = await Promise.all([
    service.save(id, { name: 'c' }, 1),
    other.save(id, { name: 'd' }, 1),
  ]);
  expect(updated.filter((r) => r.ok)).toHaveLength(1);
  expect(updated.find((r) => !r.ok)).toMatchObject({ error: { code: 'conflict' } });
  expect((await store.read(id))?.revision).toBe(2);
});
it('never treats schema mismatch, invalid data or a read error as an empty configuration', async () => {
  for (const row of [
    { schemaVersion: 2, data: { name: 'old' } },
    { schemaVersion: 1, data: { name: '' } },
  ]) {
    const { service, store } = setup();
    await store.compareAndSet(id, null, { format: 1, ...id, revision: 1, ...row });
    expect(await service.inspect(id)).toMatchObject({ ok: false, error: { code: 'not-ready' } });
    expect(await service.save(id, { name: 'new' }, 0)).toMatchObject({
      ok: false,
      error: { code: 'not-ready' },
    });
    expect((await store.read(id))?.data).toEqual(row.data);
  }
  const { service, store } = setup();
  vi.spyOn(store, 'read').mockRejectedValue(new Error('PRIVATE_FILE'));
  expect(await service.inspect(id)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(await service.save(id, { name: 'new' }, 0)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
});
it('keeps publication outside an open inspection to avoid Windows replacement sharing failures', async () => {
  const { service, store } = setup();
  await service.save(id, { name: 'before' }, 0);
  const write = vi.spyOn(store, 'compareAndSet'),
    read = store.read.bind(store);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(store, 'read').mockImplementationOnce(async (identity) => {
    const value = await read(identity);
    entered();
    await gate;
    return value;
  });
  const inspecting = service.inspect(id);
  await began;
  const saving = service.save(id, { name: 'after' }, 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const writesWhileReading = write.mock.calls.length;
  release();
  const [inspected, saved] = await Promise.all([inspecting, saving]);
  expect(writesWhileReading).toBe(0);
  expect(inspected).toMatchObject({ ok: true, value: { snapshot: { revision: 1 } } });
  expect(saved).toMatchObject({ ok: true, value: { snapshot: { revision: 2 } } });
});
it('does not report a cancelled unchanged save as successful after a pending read', async () => {
  const { service, store } = setup();
  await service.save(id, { name: 'kept' }, 0);
  const abort = new AbortController();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const read = store.read.bind(store);
  vi.spyOn(store, 'read').mockImplementationOnce(async (identity) => {
    entered();
    await gate;
    return read(identity);
  });
  const pending = service.save(id, { name: 'kept' }, 1, abort.signal);
  await began;
  abort.abort();
  release();
  expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect((await store.read(id))?.revision).toBe(1);
});
it('does not create a first record after cancellation', async () => {
  const { service, store } = setup();
  const abort = new AbortController();
  abort.abort();
  expect(await service.save(id, { name: 'new' }, 0, abort.signal)).toMatchObject({
    ok: false,
    error: { code: 'cancelled' },
  });
  expect(await store.read(id)).toBeNull();
});
