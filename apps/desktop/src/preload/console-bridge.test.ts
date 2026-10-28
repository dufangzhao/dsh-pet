import { expect, it, vi } from 'vitest';
import {
  createConsoleBridge as createFullConsoleBridge,
  createSettingsLauncher,
} from './console-bridge.js';
import { createSecurityBridge } from './security-bridge.js';
const security = createSecurityBridge(
  async () => ({ ok: false, error: makeError('not-ready', false) }),
  () => () => {},
);
function createConsoleBridge(
  read: Parameters<typeof createFullConsoleBridge>[0],
  stop: Parameters<typeof createFullConsoleBridge>[1],
  config: Parameters<typeof createFullConsoleBridge>[2],
) {
  return createFullConsoleBridge(read, stop, config, security);
}
import { makeError, type ConsoleSnapshot, type Result } from '@pet/contracts';
const config = {
  inspectConfig: vi.fn(async () => ({ ok: false as const, error: makeError('not-ready', false) })),
  saveConfig: vi.fn(async () => ({ ok: false as const, error: makeError('conflict', false) })),
  runPluginAction: vi.fn(async () => ({
    ok: true as const,
    value: { snapshot, operationError: null },
  })),
};
const snapshot: ConsoleSnapshot = {
  version: 1,
  host: {
    version: 1,
    runtime: 'ready',
    installedPlugins: 0,
    activePlugins: 0,
    unreadyPlugins: 0,
    pendingRestartPlugins: 0,
    runningTasks: 0,
    pendingWork: 0,
  },
  plugins: [],
  contributions: [],
  app: { name: 'AI 桌宠', version: '0.0.0', electron: '45', node: '24', platform: 'win32-x64' },
};
it('exposes only the snapshot and stop actions on a frozen bridge', async () => {
  const invoke = vi.fn(async () => ({ ok: true as const, value: snapshot })),
    bridge = createConsoleBridge(invoke, async () => ({ ok: true, value: snapshot.host }), config);
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge)).toEqual([
    'version',
    'getSnapshot',
    'stopAll',
    'inspectConfig',
    'saveConfig',
    'runPluginAction',
    'getSecurity',
    'setTrust',
    'setPermissionPreset',
    'answerApproval',
    'getAudit',
    'restoreBuiltin',
    'onSecurityChanged',
  ]);
  expect(await bridge.getSnapshot()).toEqual({ ok: true, value: snapshot });
  const call = bridge.getSnapshot as (...args: unknown[]) => Promise<Result<ConsoleSnapshot>>;
  expect(await call('extra')).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(invoke).toHaveBeenCalledOnce();
});
it('forwards stopAll without accepting an argument', async () => {
  const stop = vi.fn(async () => ({ ok: true as const, value: snapshot.host }));
  const bridge = createConsoleBridge(async () => ({ ok: true, value: snapshot }), stop, config);
  expect(await bridge.stopAll()).toEqual({ ok: true, value: snapshot.host });
  const call = bridge.stopAll as (...args: unknown[]) => Promise<Result<typeof snapshot.host>>;
  expect(await call('plugin-id')).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(stop).toHaveBeenCalledOnce();
});
it('forwards one settings payload, preserves conflicts and rejects wrong arity', async () => {
  const bridge = createConsoleBridge(
    async () => ({ ok: true, value: snapshot }),
    async () => ({ ok: true, value: snapshot.host }),
    config,
  );
  const owner = { pluginId: 'test.config', instanceId: 'default', generation: 1 };
  const request = { owner, expectedRevision: 0, data: { name: 'first' } };
  expect(await bridge.saveConfig(request)).toEqual({
    ok: false,
    error: makeError('conflict', false),
  });
  expect(config.saveConfig).toHaveBeenLastCalledWith(request);
  expect(await bridge.inspectConfig(owner)).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
  expect(config.inspectConfig).toHaveBeenLastCalledWith(owner);
  for (const method of [bridge.inspectConfig, bridge.saveConfig]) {
    const invoke = method as (...args: unknown[]) => Promise<unknown>;
    expect(await invoke()).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(await invoke(owner, 'extra')).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  }
});
it('forwards one management request and its operation error without wrapping it again', async () => {
  const request = {
    owner: { pluginId: 'test.config', instanceId: 'default', generation: 1 },
    action: 'enable' as const,
  };
  const run = vi.fn(async () => ({
    ok: true as const,
    value: { snapshot, operationError: makeError('permission-denied', false) },
  }));
  const bridge = createConsoleBridge(
    async () => ({ ok: true, value: snapshot }),
    async () => ({ ok: true, value: snapshot.host }),
    { ...config, runPluginAction: run },
  );
  expect(await bridge.runPluginAction(request)).toMatchObject({
    ok: true,
    value: { operationError: { code: 'permission-denied' }, snapshot },
  });
  expect(run).toHaveBeenCalledWith(request);
  const invoke = bridge.runPluginAction as (...args: unknown[]) => Promise<unknown>;
  expect(await invoke()).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(await invoke(request, 'extra')).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(run).toHaveBeenCalledOnce();
});
it('exposes only a frozen settings launcher', async () => {
  const invoke = vi.fn(async () => ({ ok: true as const, value: null })),
    bridge = createSettingsLauncher(invoke);
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge)).toEqual(['open']);
  expect(await bridge.open()).toEqual({ ok: true, value: null });
  const call = bridge.open as (...args: unknown[]) => Promise<Result<null>>;
  expect(await call({ path: 'x' })).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(invoke).toHaveBeenCalledOnce();
});
it('maps failed transport to one fixed error', async () => {
  const fail = async () => {
    throw new Error('PRIVATE_TRANSPORT');
  };
  for (const result of [
    await createConsoleBridge(fail, fail, {
      inspectConfig: fail,
      saveConfig: fail,
      runPluginAction: fail,
    }).getSnapshot(),
    await createConsoleBridge(fail, fail, {
      inspectConfig: fail,
      saveConfig: fail,
      runPluginAction: fail,
    }).stopAll(),
    await createSettingsLauncher(fail).open(),
    await createConsoleBridge(fail, fail, {
      inspectConfig: fail,
      saveConfig: fail,
      runPluginAction: fail,
    }).inspectConfig({
      pluginId: 'test.config',
      instanceId: 'default',
      generation: 1,
    }),
    await createConsoleBridge(fail, fail, {
      inspectConfig: fail,
      saveConfig: fail,
      runPluginAction: fail,
    }).saveConfig({
      owner: { pluginId: 'test.config', instanceId: 'default', generation: 1 },
      expectedRevision: 0,
      data: {},
    }),
  ]) {
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TRANSPORT');
  }
});
