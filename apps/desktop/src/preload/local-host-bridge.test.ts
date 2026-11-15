import { expect, it, vi } from 'vitest';
import { DESKTOP_LOCAL_HOST_IPC, makeError } from '@pet/contracts';
import { createDesktopLocalHostBridge } from './companion-bridge.js';

it('exposes only fixed frozen local-host methods and checks arity before IPC', async () => {
  const invoke = vi.fn(async () => ({ ok: false, error: makeError('unavailable', false) }));
  const bridge = createDesktopLocalHostBridge(invoke, () => () => {});
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge).sort()).toEqual(
    [
      ...Object.keys(DESKTOP_LOCAL_HOST_IPC).filter((key) => key !== 'changed'),
      'version',
      'onChanged',
    ].sort(),
  );
  expect((await Reflect.apply(bridge.start, bridge, ['unexpected'])).ok).toBe(false);
  expect((await Reflect.apply(bridge.stop, bridge, [])).ok).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  await bridge.start();
  await bridge.stop({ hostId: 'host-1', bootId: 'boot-1' });
  expect(invoke.mock.calls).toEqual([
    [DESKTOP_LOCAL_HOST_IPC.start],
    [DESKTOP_LOCAL_HOST_IPC.stop, { hostId: 'host-1', bootId: 'boot-1' }],
  ]);
});

it('keeps notification subscription disposable and never returns a mutable IPC object', () => {
  const off = vi.fn();
  const listen = vi.fn(() => off);
  const bridge = createDesktopLocalHostBridge(
    async () => ({ ok: false, error: makeError('unavailable', false) }),
    listen,
  );
  const listener = () => {};
  expect(bridge.onChanged(listener)).toBe(off);
  expect(listen).toHaveBeenCalledWith(listener);
  expect(() => Reflect.apply(bridge.onChanged, bridge, [null])).toThrow(TypeError);
});
