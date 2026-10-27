import { expect, it, vi } from 'vitest';
import {
  ConfigService,
  MemoryConfigStore,
  PluginManager,
  CordisRuntimeDriver,
} from '@pet/host-kernel';
import type { PluginManifest } from '@pet/contracts';
import { handleConsoleConfigRequest } from './console-config-request.js';
const source = {
  senderId: 7,
  expectedId: 7,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
};
const id = { pluginId: 'test.settings', instanceId: 'default' };
function setup() {
  const manifest: PluginManifest = {
    schemaVersion: 1,
    id: id.pluginId,
    version: '1.0.0',
    displayName: { en: 'Settings' },
    description: { en: 'Settings' },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['win32-x64'],
    entries: { runtime: 'index.js' },
    permissions: [{ kind: 'credentials', keys: ['service-key'] }],
    config: {
      version: 1,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          key: { type: 'string', format: 'credential-ref', enum: ['service-key'] },
        },
      },
    },
  };
  const manager = new PluginManager({
    driver: new CordisRuntimeDriver(async () => ({ activate() {} })),
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
  });
  expect(manager.install(manifest, { origin: 'user', directory: 'C:/settings-fixture' }).ok).toBe(
    true,
  );
  const store = new MemoryConfigStore(),
    configs = new ConfigService(store);
  configs.register(id, manifest);
  const owner = manager.get(id)!.owner;
  return { host: { manager, configs }, owner, store };
}
it('uses the current disabled owner for pure inspection and a single Result on first save', async () => {
  const { host, owner, store } = setup();
  expect(host.manager.isLive(owner)).toBe(false);
  const inspected = await handleConsoleConfigRequest(source, 'inspect', [owner], host);
  expect(inspected).toMatchObject({
    ok: true,
    value: { snapshot: null, definition: { version: 1 } },
  });
  expect(await store.read(id)).toBeNull();
  expect(
    await handleConsoleConfigRequest(
      source,
      'save',
      [{ owner, expectedRevision: 0, data: { name: 'first', key: 'service-key' } }],
      host,
    ),
  ).toMatchObject({ ok: true, value: { snapshot: { revision: 1 } } });
  expect(host.manager.get(id)!.state).toBe('disabled');
  await host.manager.disable(id);
  expect(await handleConsoleConfigRequest(source, 'inspect', [owner], host)).toMatchObject({
    ok: true,
  });
  expect(
    await handleConsoleConfigRequest(
      source,
      'save',
      [{ owner, expectedRevision: 1, data: { name: 'after-disable', key: 'service-key' } }],
      host,
    ),
  ).toMatchObject({ ok: true, value: { snapshot: { revision: 2 } } });
  expect(
    await handleConsoleConfigRequest(
      source,
      'save',
      [{ owner, expectedRevision: 1, data: { name: 'first', key: 'UNDECLARED_KEY' } }],
      host,
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
});
it('rejects other windows, subframes and changed URLs before reaching config storage', async () => {
  const { host, owner } = setup(),
    inspect = vi.spyOn(host.configs, 'inspect'),
    save = vi.spyOn(host.configs, 'save');
  for (const changed of [
    { senderId: 8 },
    { mainFrame: false },
    { frameUrl: 'file:///pet/index.html' },
    { frameUrl: source.frameUrl + '?x=1' },
    { frameUrl: 'https://example.com', expectedUrl: 'https://example.com' },
  ]) {
    for (const action of ['inspect', 'save'] as const)
      expect(
        await handleConsoleConfigRequest({ ...source, ...changed }, action, [owner], host),
      ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  }
  expect(inspect).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it('rejects missing, extra or malformed payloads and stale generations without a write', async () => {
  const { host, owner, store } = setup();
  for (const args of [
    [],
    [owner, owner],
    [{ ...owner, extra: true }],
    [{ ...id }],
    [{ ...owner, generation: 0 }],
  ])
    expect(await handleConsoleConfigRequest(source, 'inspect', args, host)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  expect(
    await handleConsoleConfigRequest(
      source,
      'inspect',
      [{ ...owner, generation: owner.generation + 1 }],
      host,
    ),
  ).toMatchObject({ ok: false, error: { code: 'stale-owner' } });
  const request = { owner, expectedRevision: 0, data: { name: 'first' } };
  for (const payload of [
    { ...request, path: 'PRIVATE' },
    { ...request, expectedRevision: -1 },
    { ...request, expectedRevision: 0.5 },
    { ...request, owner: { ...owner, generation: 99 } },
  ])
    expect((await handleConsoleConfigRequest(source, 'save', [payload], host)).ok).toBe(false);
  expect(await store.read(id)).toBeNull();
});
it('does not commit a stopped generation after enable renews its owner during a read', async () => {
  const { host, owner, store } = setup();
  await host.manager.disable(id);
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
  const pending = handleConsoleConfigRequest(
    source,
    'save',
    [{ owner, expectedRevision: 0, data: { name: 'old-generation' } }],
    host,
  );
  await began;
  await host.manager.enable(id);
  expect(host.manager.get(id)!.owner.generation).toBeGreaterThan(owner.generation);
  release();
  expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(await store.read(id)).toBeNull();
});
it('cancels a queued save when the owner expires before commit', async () => {
  const { host, owner, store } = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = store.read.bind(store);
  vi.spyOn(store, 'read').mockImplementationOnce(async (identity) => {
    await gate;
    return read(identity);
  });
  const pending = handleConsoleConfigRequest(
    source,
    'save',
    [{ owner, expectedRevision: 0, data: { name: 'first' } }],
    host,
  );
  await host.manager.disable(id);
  release();
  expect((await pending).ok).toBe(false);
  expect(await store.read(id)).toBeNull();
});
