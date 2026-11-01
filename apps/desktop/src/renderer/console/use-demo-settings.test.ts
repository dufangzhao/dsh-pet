import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_INPUT_SETTINGS, type ConsoleBridge, type OwnerRef } from '@pet/contracts';
vi.mock('react', () => ({
  useCallback: <T>(value: T) => value,
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(value: T) => [value, vi.fn()],
}));
import { useDemoSettings } from './use-demo-settings.js';
afterEach(() => vi.unstubAllGlobals());
it('preserves all engine, microphone, physical key and API settings when changing auto-send', async () => {
  const data = {
    ...DEFAULT_VOICE_INPUT_SETTINGS,
    engine: 'openai',
    microphoneId: 'real-device-id',
    talkKeyCode: 'F8',
    talkKeyLabel: 'F8',
    cloudBaseUrl: 'https://api.groq.com/openai/v1',
    mode: 'deepseek',
    autoSend: true,
  };
  const owner: OwnerRef = { pluginId: 'pet.voice-chat', instanceId: 'default', generation: 2 };
  const inspectConfig = vi.fn(async () => ({
      ok: true,
      value: { snapshot: { revision: 7, data }, definition: { defaults: {} } },
    })),
    saveConfig = vi.fn(async () => ({ ok: true, value: {} }));
  vi.stubGlobal('window', {
    petConsole: { inspectConfig, saveConfig } as unknown as ConsoleBridge,
  });
  expect(await useDemoSettings().saveVoice(owner, 7, 'deepseek', false)).toEqual({
    ok: true,
    error: null,
  });
  expect(saveConfig).toHaveBeenCalledWith({
    owner,
    expectedRevision: 7,
    data: { ...data, autoSend: false },
  });
});
it('does not promote an inspected newer revision to overwrite a stale form', async () => {
  const inspectConfig = vi.fn(async () => ({
      ok: true,
      value: { snapshot: { revision: 8, data: DEFAULT_VOICE_INPUT_SETTINGS } },
    })),
    saveConfig = vi.fn();
  vi.stubGlobal('window', {
    petConsole: { inspectConfig, saveConfig } as unknown as ConsoleBridge,
  });
  expect(
    await useDemoSettings().saveVoice(
      { pluginId: 'pet.voice-chat', instanceId: 'default', generation: 2 },
      7,
      'demo',
      false,
    ),
  ).toMatchObject({ ok: false });
  expect(saveConfig).not.toHaveBeenCalled();
});
