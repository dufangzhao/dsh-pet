import { expect, it, vi } from 'vitest';
import { CONSOLE_IPC } from '@pet/contracts';
import { createSecurityBridge } from './security-bridge.js';
it('forwards a fixed one-shot decision and enforces arity and callbacks', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: null })),
    listen = vi.fn(() => () => {});
  const bridge = createSecurityBridge(invoke, listen);
  const decision = {
    requestId: 'one',
    owner: { pluginId: 'test.a', instanceId: 'default', generation: 1 },
    taskId: 'task',
    permissionDigest: 'a'.repeat(64),
    approved: false,
  };
  expect(await bridge.answerApproval(decision)).toEqual({ ok: true, value: null });
  expect(invoke).toHaveBeenCalledWith(CONSOLE_IPC.approval, decision);
  const call = bridge.answerApproval as (...args: unknown[]) => Promise<unknown>;
  expect(await call()).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(await call(decision, 'extra')).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(invoke).toHaveBeenCalledOnce();
  const subscribe = bridge.onSecurityChanged as (...args: unknown[]) => unknown;
  expect(() => subscribe(null)).toThrow('Expected security callback');
  const callback = () => {};
  bridge.onSecurityChanged(callback);
  expect(listen).toHaveBeenCalledWith(callback);
});
it('does not expose an original transport exception', async () => {
  const bridge = createSecurityBridge(
    async () => {
      throw new Error('PRIVATE_PATH');
    },
    () => () => {},
  );
  const result = await bridge.getSecurity();
  expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PATH');
});
