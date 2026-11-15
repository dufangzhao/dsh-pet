import { afterEach, expect, it, vi } from 'vitest';
import { localHostEnvironment } from './client.js';
afterEach(() => vi.unstubAllEnvs());
it('preserves only explicit OS-native paths display locale and per-user directories', () => {
  const source = {
    SystemRoot: 'C:\\Windows',
    PATH: '/fixed/os/bin',
    HOME: '/private/home',
    USERPROFILE: 'C:\\Users\\fixture',
    APPDATA: 'C:\\Users\\fixture\\AppData',
    DISPLAY: ':25',
    XAUTHORITY: '/private/auth',
    XDG_RUNTIME_DIR: '/private/runtime',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/private/bus',
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
  };
  const result = localHostEnvironment(source);
  expect(result).toEqual(source);
  expect(result).not.toBe(source);
});
it('never implicitly forwards Agent model DSH keys or Electron/Node loader modes from the actual GUI environment', () => {
  for (const name of [
    'AGENT_TOKEN',
    'MODEL_API_KEY',
    'DSH_API_KEY',
    'G0_UNDECLARED_KEY',
    'RANDOM_TOKEN',
    'NODE_OPTIONS',
    'ELECTRON_RUN_AS_NODE',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
  ])
    vi.stubEnv(name, 'synthetic-not-a-real-secret');
  vi.stubEnv('HOME', '/controlled/gui/home');
  vi.stubEnv('DISPLAY', ':25');
  const environment = localHostEnvironment();
  expect(environment['HOME']).toBe('/controlled/gui/home');
  expect(environment['DISPLAY']).toBe(':25');
  for (const name of [
    'AGENT_TOKEN',
    'MODEL_API_KEY',
    'DSH_API_KEY',
    'G0_UNDECLARED_KEY',
    'RANDOM_TOKEN',
    'NODE_OPTIONS',
    'ELECTRON_RUN_AS_NODE',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
  ])
    expect(Object.hasOwn(environment, name)).toBe(false);
});
