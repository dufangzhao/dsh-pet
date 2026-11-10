import { expect, it, vi } from 'vitest';
import { DESKTOP_VOICE_IPC, makeError } from '@pet/contracts';
import { createDesktopVoiceBridge } from './shared-voice-bridge.js';
it('exposes only frozen fixed channels, exact arity and invalidation-only subscriptions', async () => {
  const invoke = vi.fn(async () => ({ ok: false, error: makeError('conflict', false) }));
  const off = vi.fn(),
    listen = vi.fn(() => off);
  const bridge = createDesktopVoiceBridge(invoke, listen);
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge).sort()).toEqual(
    [
      ...Object.keys(DESKTOP_VOICE_IPC).filter((name) => name !== 'changed'),
      'version',
      'onChanged',
    ].sort(),
  );
  const key = { connectionId: 'connection', captureId: 'capture', sequence: 0 };
  const audio = new Uint8Array(4);
  expect(await bridge.pushAudio(key, audio)).toMatchObject({
    ok: false,
    error: { code: 'conflict' },
  });
  expect(invoke).toHaveBeenCalledWith(DESKTOP_VOICE_IPC.pushAudio, key, audio);
  for (const name of Object.keys(DESKTOP_VOICE_IPC).filter((item) => item !== 'changed')) {
    const method = bridge[name as keyof typeof bridge] as (...args: unknown[]) => Promise<unknown>;
    expect(await method(...Array(3).fill(null))).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  }
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(bridge.onChanged(() => {})).toBe(off);
  expect(() => bridge.onChanged(null as unknown as () => void)).toThrow();
});
