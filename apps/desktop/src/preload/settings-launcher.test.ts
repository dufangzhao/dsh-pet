import { expect, it, vi } from 'vitest';
import { CONSOLE_IPC, type Result } from '@pet/contracts';
import { createSettingsLauncher } from './settings-launcher.js';
it('freezes the launcher and supports opening with an optional fixed destination', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: null }));
  const bridge = createSettingsLauncher(invoke, () => () => {});
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge)).toEqual(['open', 'onNavigate']);
  expect(await bridge.open()).toEqual({ ok: true, value: null });
  expect(await bridge.open({ view: 'appearance' })).toEqual({ ok: true, value: null });
  expect(invoke.mock.calls).toEqual([
    [CONSOLE_IPC.open],
    [CONSOLE_IPC.open, { view: 'appearance' }],
  ]);
});
it('rejects malformed optional payloads and extra arguments before transport', async () => {
  const invoke = vi.fn();
  const bridge = createSettingsLauncher(invoke, () => () => {});
  const open = bridge.open as (...args: unknown[]) => Promise<Result<null>>;
  for (const args of [
    [undefined],
    [null],
    [{}],
    ['voice'],
    [{ view: 'unknown' }],
    [{ view: 'voice', path: 'x' }],
    [{ view: 'voice' }, {}],
  ])
    expect(await open(...args)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(invoke).not.toHaveBeenCalled();
});
it('subscribes only with one callback and delivers only valid navigation requests', () => {
  let event = (_request: unknown) => {};
  const off = vi.fn(),
    listener = vi.fn();
  const bridge = createSettingsLauncher(vi.fn(), (callback) => {
    event = callback;
    return off;
  });
  const subscribe = bridge.onNavigate as (...args: unknown[]) => () => void;
  expect(() => subscribe()).toThrow(TypeError);
  expect(() => subscribe(null)).toThrow(TypeError);
  expect(() => subscribe(listener, 'extra')).toThrow(TypeError);
  const dispose = subscribe(listener);
  for (const request of [null, {}, { view: 'unknown' }, { view: 'voice', extra: true }])
    event(request);
  expect(listener).not.toHaveBeenCalled();
  const request = { view: 'voice' };
  event(request);
  request.view = 'about';
  expect(listener).toHaveBeenCalledExactlyOnceWith({ view: 'voice' });
  dispose();
  expect(off).toHaveBeenCalledOnce();
});
it('preserves failed receipts and returns a fixed error on transport failure', async () => {
  const denied = {
    ok: false,
    error: { code: 'permission-denied', messageKey: 'errors.permission-denied', retryable: false },
  };
  expect(
    await createSettingsLauncher(
      async () => denied,
      () => () => {},
    ).open({ view: 'voice' }),
  ).toEqual(denied);
  const result = await createSettingsLauncher(
    async () => {
      throw new Error('PRIVATE_TRANSPORT');
    },
    () => () => {},
  ).open();
  expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TRANSPORT');
});
