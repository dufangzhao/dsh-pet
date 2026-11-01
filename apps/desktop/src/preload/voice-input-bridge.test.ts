import { expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_INPUT_SETTINGS, VOICE_INPUT_IPC, makeError } from '@pet/contracts';
import { createVoiceInputBridge } from './voice-input-bridge.js';
import { createDemoBridge } from './demo-bridge.js';
it('freezes named voice input actions, preserves conflicts, and rejects wrong arity', async () => {
  const invoke = vi.fn(async () => ({ ok: false, error: makeError('conflict', false) })),
    off = vi.fn(),
    listen = vi.fn(() => off),
    api = createVoiceInputBridge(invoke, listen);
  expect(Object.isFrozen(api)).toBe(true);
  expect(Object.keys(api)).toEqual([
    'version',
    'getSnapshot',
    'saveSettings',
    'saveApiKey',
    'start',
    'stop',
    'installModel',
    'onChanged',
  ]);
  const request = { expectedRevision: 2, data: DEFAULT_VOICE_INPUT_SETTINGS };
  expect(await api.saveSettings(request)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(invoke).toHaveBeenCalledWith(VOICE_INPUT_IPC.saveSettings, request);
  expect(await (api.start as (...args: unknown[]) => Promise<unknown>)('extra')).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(invoke).toHaveBeenCalledOnce();
  const callback = vi.fn();
  expect(api.onChanged(callback)).toBe(off);
  expect(() => api.onChanged(null as unknown as () => void)).toThrow();
});
it('recording request listeners receive only the fixed receipt and dispose cleanly', async () => {
  let event: (value: unknown) => void = () => {};
  const off = vi.fn(),
    listener = vi.fn();
  const api = createDemoBridge(
    async () => ({ ok: true, value: null }),
    () => () => {},
    (cb) => {
      event = cb as (value: unknown) => void;
      return off;
    },
  );
  expect(api.onRecordingRequested(listener)).toBe(off);
  event({ id: 'request', action: 'toggle', payload: 'ignored' });
  expect(listener).toHaveBeenCalledWith({ id: 'request', action: 'toggle' });
  event({ id: 'bad', action: 'begin-second-recorder' });
  expect(listener).toHaveBeenCalledOnce();
});
