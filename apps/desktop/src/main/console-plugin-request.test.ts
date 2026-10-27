import { afterEach, expect, it, vi } from 'vitest';
import type { PluginManifest } from '@pet/contracts';
import {
  ConfigService,
  MemoryConfigStore,
  PluginManager,
  CordisRuntimeDriver,
} from '@pet/host-kernel';
import { ConsolePluginRequests } from './console-plugin-request.js';
import { consoleSnapshot } from './console-snapshot.js';
const source = {
  senderId: 7,
  expectedId: 7,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
};
const id = { pluginId: 'test.actions', instanceId: 'default' };
const hosts: { manager: PluginManager; configs: ConfigService }[] = [];
async function setup(
  options: {
    trust?: boolean;
    remove?: () => Promise<boolean>;
    protected?: boolean;
    cleanupFails?: boolean;
  } = {},
) {
  let received: unknown;
  const manifest: PluginManifest = {
    schemaVersion: 1,
    id: id.pluginId,
    version: '1.0.0',
    displayName: { en: 'Actions' },
    description: { en: 'Actions' },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['win32-x64'],
    entries: { runtime: 'index.mjs' },
    contributes: [
      { id: 'settings', kind: 'settings', section: 'general', title: { en: 'Settings' } },
    ],
    config: {
      version: 1,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { count: { type: 'integer', default: 1 } },
      },
    },
  };
  const directory = 'C:/actions-fixture';
  const manager = new PluginManager({
    driver: new CordisRuntimeDriver(async (activation) => {
      received = activation.config;
      return {
        activate(ctx) {
          ctx.contribute('settings');
          if (options.cleanupFails)
            return () => {
              throw new Error('PRIVATE_CLEANUP');
            };
          return undefined;
        },
      };
    }),
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async () => options.trust !== false,
    readiness: async () => null,
    removeInstallation: options.remove ?? (async () => true),
    ...(options.protected ? { protectedPackages: { [id.pluginId]: directory } } : {}),
  });
  expect(
    manager.install(manifest, { directory, origin: options.protected ? 'builtin' : 'user' }).ok,
  ).toBe(true);
  const configs = new ConfigService(new MemoryConfigStore());
  configs.register(id, manifest);
  await configs.initialize(id);
  const host = { manager, configs };
  hosts.push(host);
  const snapshot = vi.fn(() =>
    consoleSnapshot(
      {
        version: 1,
        runtime: 'ready',
        installedPlugins: manager.list().length,
        activePlugins: manager.list().filter((p) => p.state === 'active').length,
        unreadyPlugins: manager.list().filter((p) => p.state === 'unready').length,
        pendingRestartPlugins: 0,
        runningTasks: 0,
        pendingWork: 0,
      },
      manager.list(),
      { name: 'Pet', version: '1', node: '24', electron: '45', platform: 'win32-x64' },
      manager.contributions(),
    ),
  );
  return {
    host,
    snapshot,
    requests: new ConsolePluginRequests(host, snapshot),
    owner: () => manager.get(id)!.owner,
    received: () => received,
  };
}
afterEach(async () => {
  for (const host of hosts.splice(0)) {
    host.configs.close();
    await host.manager.shutdown();
  }
});
it('enables with the persisted candidate and returns the new owner and real contributions without a followup read', async () => {
  const f = await setup();
  await f.host.configs.save(id, { count: 9 }, 1);
  const old = f.owner();
  const result = await f.requests.handle(source, [{ owner: old, action: 'enable' }]);
  expect(result).toMatchObject({
    ok: true,
    value: {
      operationError: null,
      snapshot: {
        plugins: [{ state: 'active', owner: { generation: 2 } }],
        contributions: [{ id: 'settings' }],
      },
    },
  });
  expect(f.received()).toEqual({ count: 9 });
  const stale = await f.requests.handle(source, [{ owner: old, action: 'disable' }]);
  expect(stale).toMatchObject({
    ok: true,
    value: {
      operationError: { code: 'stale-owner' },
      snapshot: { plugins: [{ state: 'active' }] },
    },
  });
  expect(await f.requests.handle(source, [{ owner: f.owner(), action: 'disable' }])).toMatchObject({
    ok: true,
    value: {
      operationError: null,
      snapshot: { plugins: [{ state: 'disabled' }], contributions: [] },
    },
  });
});
it('returns changed unready generation on denied trust without approving it', async () => {
  const f = await setup({ trust: false });
  expect(await f.requests.handle(source, [{ owner: f.owner(), action: 'enable' }])).toMatchObject({
    ok: true,
    value: {
      operationError: { code: 'permission-denied' },
      snapshot: { plugins: [{ state: 'unready', owner: { generation: 2 } }] },
    },
  });
  expect(f.received()).toBeUndefined();
});
it('retains failed uninstall state, allows explicit retry and preserves stored configuration', async () => {
  let removable = false;
  const remove = vi.fn(async () => removable);
  const f = await setup({ remove });
  await f.requests.handle(source, [{ owner: f.owner(), action: 'enable' }]);
  expect(
    await f.requests.handle(source, [{ owner: f.owner(), action: 'uninstall' }]),
  ).toMatchObject({
    ok: true,
    value: {
      operationError: { code: 'unavailable' },
      snapshot: { plugins: [{ state: 'disabled' }], contributions: [] },
    },
  });
  removable = true;
  expect(
    await f.requests.handle(source, [{ owner: f.owner(), action: 'uninstall' }]),
  ).toMatchObject({
    ok: true,
    value: { operationError: null, snapshot: { plugins: [], contributions: [] } },
  });
  expect((await f.host.configs.get(id)).ok).toBe(true);
  expect(remove).toHaveBeenCalledTimes(2);
});
it('reports incomplete stop as pending restart rather than success', async () => {
  const remove = vi.fn(async () => true),
    f = await setup({ cleanupFails: true, remove });
  await f.requests.handle(source, [{ owner: f.owner(), action: 'enable' }]);
  expect(await f.requests.handle(source, [{ owner: f.owner(), action: 'disable' }])).toMatchObject({
    ok: true,
    value: {
      operationError: expect.objectContaining({ code: expect.any(String) }),
      snapshot: { plugins: [{ state: 'pending_restart' }], contributions: [] },
    },
  });
  expect(
    await f.requests.handle(source, [{ owner: f.owner(), action: 'uninstall' }]),
  ).toMatchObject({ ok: true, value: { operationError: { code: 'not-ready' } } });
  expect(remove).not.toHaveBeenCalled();
});
it('rejects protected operations in the host before cleanup or deletion', async () => {
  const remove = vi.fn(async () => true);
  const f = await setup({ protected: true, remove });
  for (const action of ['disable', 'uninstall'])
    expect(await f.requests.handle(source, [{ owner: f.owner(), action }])).toMatchObject({
      ok: true,
      value: { operationError: { code: 'permission-denied' } },
    });
  expect(remove).not.toHaveBeenCalled();
});
it('rejects invalid payloads and foreign frames without exposing a snapshot', async () => {
  const f = await setup();
  for (const changed of [
    { senderId: 8 },
    { mainFrame: false },
    { frameUrl: source.frameUrl + '?query' },
    { frameUrl: 'https://example.com', expectedUrl: 'https://example.com' },
  ]) {
    expect(
      await f.requests.handle({ ...source, ...changed }, [{ owner: f.owner(), action: 'enable' }]),
    ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  }
  for (const args of [
    [],
    [id, id],
    [{ owner: id, action: 'enable' }],
    [{ owner: f.owner(), action: 'run' }],
    [{ owner: f.owner(), action: 'enable', path: 'PRIVATE' }],
  ])
    expect(await f.requests.handle(source, args)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  expect(f.snapshot).not.toHaveBeenCalled();
});
it('rejects a duplicate while config is loading and a generation that expires before enable', async () => {
  const f = await setup();
  const owner = f.owner(),
    read = f.host.configs.get.bind(f.host.configs);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(f.host.configs, 'get').mockImplementationOnce(async (identity) => {
    await gate;
    return read(identity);
  });
  const first = f.requests.handle(source, [{ owner, action: 'enable' }]);
  expect(await f.requests.handle(source, [{ owner, action: 'enable' }])).toMatchObject({
    ok: true,
    value: { operationError: { code: 'rate-limited' } },
  });
  await f.host.manager.enable(id, { count: 1 });
  release();
  expect(await first).toMatchObject({
    ok: true,
    value: { operationError: { code: 'stale-owner' } },
  });
});
