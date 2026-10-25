import { expect, it, vi } from 'vitest';
import { createHostStatusBridge } from './host-bridge.js';
it('exposes only frozen version and a no-argument status method', async () => {
  const invoke = vi.fn(async () => ({
    ok: false as const,
    error: { code: 'not-ready' as const, messageKey: 'errors.not-ready' as const, retryable: true },
  }));
  const bridge = createHostStatusBridge(invoke);
  expect(Object.keys(bridge).sort()).toEqual(['getStatus', 'version']);
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(bridge.version).toBe(1);
  expect(await bridge.getStatus()).toMatchObject({ ok: false, error: { code: 'not-ready' } });
  expect(invoke).toHaveBeenCalledWith();
});
it('refuses extra arguments instead of forwarding arbitrary IPC', async () => {
  const invoke = vi.fn();
  const bridge = createHostStatusBridge(invoke);
  expect(await Reflect.apply(bridge.getStatus, null, ['private.execute'])).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(invoke).not.toHaveBeenCalled();
});
it('maps transport exceptions to a fixed unavailable error', async () => {
  const bridge = createHostStatusBridge(async () => {
    throw new Error('private');
  });
  expect(await bridge.getStatus()).toEqual({
    ok: false,
    error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: false },
  });
});
