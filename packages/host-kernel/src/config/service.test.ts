import { expect, it, vi } from 'vitest';
import type { PluginManifest, Result } from '@pet/contracts';
import { ConfigService } from './service.js';
import { MemoryConfigStore } from './store.js';
const id = { pluginId: 'test.config', instanceId: 'default' };
const unwrap = <T>(r: Result<T>) => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const manifest = (version = 1): PluginManifest => ({
  schemaVersion: 1,
  id: id.pluginId,
  version: '1.0.0',
  displayName: { 'zh-CN': '测试' },
  description: { 'zh-CN': '测试' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'index.js' },
  config: {
    version,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'integer', default: 1 }, label: { type: 'string' } },
      required: ['value'],
    },
    apply: { value: 'immediate', label: 'restart' },
  },
});
async function setup() {
  const store = new MemoryConfigStore();
  let live = true;
  const service = new ConfigService(store, () => live);
  unwrap(service.register(id, manifest()));
  const first = unwrap(await service.initialize(id));
  return {
    store,
    service,
    first,
    expire: () => {
      live = false;
    },
  };
}
it('initializes defaults and saves only validated fresh revisions', async () => {
  const f = await setup();
  expect(f.first.data).toEqual({ value: 1 });
  expect((await f.service.save(id, { value: 'wrong' }, 1)).ok).toBe(false);
  const saved = unwrap(await f.service.save(id, { value: 2 }, 1));
  expect(saved.changeMode).toBe('immediate');
  expect(saved.snapshot.revision).toBe(2);
  expect((await f.service.save(id, { value: 3 }, 1)).ok).toBe(false);
  expect(unwrap(await f.service.get(id)).data).toEqual({ value: 2 });
});
it('does not create defaults when required data is absent', async () => {
  const f = await setup();
  const missing = manifest();
  missing.config!.schema = {
    type: 'object',
    additionalProperties: false,
    properties: { needed: { type: 'string' } },
    required: ['needed'],
  };
  missing.config!.apply = {};
  unwrap(f.service.register({ ...id, instanceId: 'missing' }, missing));
  expect(await f.service.initialize({ ...id, instanceId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
});
it('keeps old data on migration exception and rejects invalid migration output', async () => {
  const f = await setup();
  unwrap(f.service.register(id, manifest(2)));
  expect(
    await f.service.prepareMigration(id, async () => {
      throw new Error('private');
    }),
  ).toMatchObject({ ok: false, error: { code: 'internal' } });
  expect(await f.service.prepareMigration(id, async () => ({ value: 'invalid' }))).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect((await f.store.read(id))?.schemaVersion).toBe(1);
  expect((await f.store.read(id))?.data).toEqual({ value: 1 });
});
it('stages without writing then commits and rolls back with increasing revisions', async () => {
  const f = await setup();
  unwrap(f.service.register(id, manifest(2)));
  const tx = unwrap(
    await f.service.prepareMigration(id, async (old) => ({
      value: old.data['value'],
      label: 'migrated',
    })),
  );
  expect((await f.store.read(id))?.revision).toBe(1);
  expect(unwrap(await tx.commit()).revision).toBe(2);
  const restored = unwrap(await tx.rollback());
  expect(restored.schemaVersion).toBe(1);
  expect(restored.revision).toBe(3);
  expect(restored.data).toEqual({ value: 1 });
  expect(f.service.diagnostics().migrations).toBe(0);
  expect((await tx.commit()).ok).toBe(false);
});
it('never rolls back over a later user save', async () => {
  const f = await setup();
  unwrap(f.service.register(id, manifest(2)));
  const tx = unwrap(await f.service.prepareMigration(id, async () => ({ value: 2 })));
  unwrap(await tx.commit());
  unwrap(await f.service.save(id, { value: 3 }, 2));
  expect((await tx.rollback()).ok).toBe(false);
  expect(unwrap(await f.service.get(id)).data).toEqual({ value: 3 });
  tx.discard();
  expect(f.service.diagnostics().migrations).toBe(0);
});
it('rejects stale prepared migrations after a competing commit', async () => {
  const f = await setup();
  unwrap(f.service.register(id, manifest(2)));
  const a = unwrap(await f.service.prepareMigration(id, async () => ({ value: 2 }))),
    b = unwrap(await f.service.prepareMigration(id, async () => ({ value: 3 })));
  unwrap(await a.commit());
  expect((await b.commit()).ok).toBe(false);
  a.discard();
  b.discard();
});
it('ends a timed-out migration without accepting its late output', async () => {
  vi.useFakeTimers();
  try {
    const f = await setup();
    unwrap(f.service.register(id, manifest(2)));
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((r) => {
      release = r;
    });
    const pending = f.service.prepareMigration(id, () => gate, { timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(f.service.diagnostics().migrations).toBe(1);
    release({ value: 2 });
    await vi.runAllTimersAsync();
    expect((await f.store.read(id))?.revision).toBe(1);
    expect(f.service.diagnostics().migrations).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it('binds readonly clients to generation validity and never accepts a foreign namespace argument', async () => {
  const f = await setup();
  const client = f.service.issueClient({ ...id, generation: 1 });
  expect(Object.keys(client)).toEqual(['get']);
  expect((await client.get()).ok).toBe(true);
  f.expire();
  expect(await client.get()).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
});
it('closes prepared transactions without applying or leaking migration capacity', async () => {
  const f = await setup();
  unwrap(f.service.register(id, manifest(2)));
  const tx = unwrap(await f.service.prepareMigration(id, async () => ({ value: 2 })));
  f.service.close();
  expect((await tx.commit()).ok).toBe(false);
  expect(f.service.diagnostics().migrations).toBe(0);
  expect((await f.store.read(id))?.revision).toBe(1);
});
