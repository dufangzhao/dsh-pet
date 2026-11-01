import { afterEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOICE_INPUT_SETTINGS,
  makeError,
  type VoiceInputBridge,
  type VoiceInputSnapshot,
  type Result,
} from '@pet/contracts';
const harness = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | void)[],
  states: [] as unknown[],
}));
vi.mock('react', () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useCallback: <T>(value: T) => value,
  useState: <T>(value: T) => {
    const index = harness.states.length;
    harness.states.push(value);
    return [
      value,
      (next: T) => {
        harness.states[index] = next;
      },
    ];
  },
  useEffect: (effect: () => (() => void) | void) => {
    harness.effects.push(effect);
  },
}));
import { useVoiceInput } from './use-voice-input.js';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  harness.effects.length = 0;
  harness.states.length = 0;
  vi.unstubAllGlobals();
});
it('keeps a caller draft revision through background refresh and returns its actual CAS conflict', async () => {
  let changed = () => {};
  const newer = {
    version: 1,
    revision: 9,
    settings: DEFAULT_VOICE_INPUT_SETTINGS,
  } as VoiceInputSnapshot;
  const saveSettings = vi.fn(async () => ({
    ok: false as const,
    error: makeError('conflict', false),
  }));
  const api = {
    getSnapshot: vi.fn(async () => ({ ok: true, value: newer })),
    onChanged: (callback: () => void) => {
      changed = callback;
      return () => {};
    },
    saveSettings,
  } as unknown as VoiceInputBridge;
  vi.stubGlobal('window', { petVoiceInput: api });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices: async () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  const state = useVoiceInput();
  for (const effect of harness.effects.splice(0)) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  await Promise.resolve();
  changed();
  await Promise.resolve();
  const outcome = await state.saveSettings(
    { ...DEFAULT_VOICE_INPUT_SETTINGS, microphoneId: 'chosen-mic' },
    5,
  );
  expect(saveSettings).toHaveBeenCalledWith({
    expectedRevision: 5,
    data: { ...DEFAULT_VOICE_INPUT_SETTINGS, microphoneId: 'chosen-mic' },
  });
  expect(outcome.ok).toBe(false);
  expect(outcome.error).toContain('配置已被更新');
  expect(harness.states[0]).toEqual(newer);
});
it('lets an explicit feature stop cancel a pending preparation and keeps busy accurate', async () => {
  let finish: (result: Result<VoiceInputSnapshot>) => void = () => {};
  const pending = new Promise<Result<VoiceInputSnapshot>>((resolve) => {
      finish = resolve;
    }),
    snapshot = { revision: 10 } as VoiceInputSnapshot;
  const start = vi.fn(() => pending),
    stop = vi.fn(async () => ({ ok: true as const, value: snapshot }));
  vi.stubGlobal('window', { petVoiceInput: { start, stop } as unknown as VoiceInputBridge });
  const state = useVoiceInput(),
    starting = state.start();
  expect(start).toHaveBeenCalledOnce();
  expect(await state.stop()).toEqual({ ok: true, error: null });
  expect(stop).toHaveBeenCalledOnce();
  expect(harness.states[2]).toBe(true);
  finish({ ok: false, error: makeError('cancelled', false) });
  await starting;
  expect(harness.states[2]).toBe(false);
  expect(harness.states[3]).toBeNull();
});
