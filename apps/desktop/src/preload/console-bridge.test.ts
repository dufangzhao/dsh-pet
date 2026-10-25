import { expect, it, vi } from 'vitest';
import { createConsoleBridge, createSettingsLauncher } from './console-bridge.js';
import type { ConsoleSnapshot, Result } from '@pet/contracts';
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
it('exposes a frozen parameterless snapshot API only', async () => {
  const invoke = vi.fn(async () => ({ ok: true as const, value: snapshot })),
    bridge = createConsoleBridge(invoke);
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge)).toEqual(['version', 'getSnapshot']);
  expect(await bridge.getSnapshot()).toEqual({ ok: true, value: snapshot });
  const call = bridge.getSnapshot as (...args: unknown[]) => Promise<Result<ConsoleSnapshot>>;
  expect(await call('extra')).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(invoke).toHaveBeenCalledOnce();
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
    await createConsoleBridge(fail).getSnapshot(),
    await createSettingsLauncher(fail).open(),
  ]) {
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TRANSPORT');
  }
});
