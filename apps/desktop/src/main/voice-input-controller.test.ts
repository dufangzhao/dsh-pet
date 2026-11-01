import { expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_INPUT_SETTINGS, makeError, type VoiceInputSnapshot } from '@pet/contracts';
import type { DesktopHost } from './desktop-host.js';
import type { DemoController } from './demo-controller.js';
import type { DemoRequestSource } from './demo-request.js';
import { VoiceInputController, handleVoiceInputRequest } from './voice-input-controller.js';
const source: DemoRequestSource = {
  senderId: 1,
  expectedId: 1,
  mainFrame: true,
  frameUrl: 'file:///console/index.html',
  expectedUrl: 'file:///console/index.html',
  role: 'console',
};
it('validates exact trusted settings and rejects undeclared origins before configuration mutation', async () => {
  const saveSettings = vi.fn(async () => ({ ok: true, value: {} })),
    controller = { saveSettings } as unknown as VoiceInputController;
  for (const data of [
    { ...DEFAULT_VOICE_INPUT_SETTINGS, talkKeyCode: 'constructor' },
    { ...DEFAULT_VOICE_INPUT_SETTINGS, apiKey: 'forbidden' },
    { ...DEFAULT_VOICE_INPUT_SETTINGS, cloudBaseUrl: 'https://unowned.invalid/v1' },
  ])
    expect(
      await handleVoiceInputRequest(
        source,
        'saveSettings',
        [{ expectedRevision: 1, data }],
        controller,
      ),
    ).toMatchObject({ ok: false });
  expect(
    await handleVoiceInputRequest(
      { ...source, mainFrame: false },
      'saveSettings',
      [{ expectedRevision: 1, data: DEFAULT_VOICE_INPUT_SETTINGS }],
      controller,
    ),
  ).toMatchObject({ error: { code: 'permission-denied' } });
  expect(
    await handleVoiceInputRequest(
      { ...source, role: 'pet' },
      'saveSettings',
      [{ expectedRevision: 1, data: DEFAULT_VOICE_INPUT_SETTINGS }],
      controller,
    ),
  ).toMatchObject({ error: { code: 'permission-denied' } });
  expect(saveSettings).not.toHaveBeenCalled();
  await handleVoiceInputRequest(
    source,
    'saveSettings',
    [
      {
        expectedRevision: 1,
        data: { ...DEFAULT_VOICE_INPUT_SETTINGS, cloudBaseUrl: 'https://api.groq.com/openai/v1/' },
      },
    ],
    controller,
  );
  expect(saveSettings).toHaveBeenCalledWith(1, {
    ...DEFAULT_VOICE_INPUT_SETTINGS,
    cloudBaseUrl: 'https://api.groq.com/openai/v1',
  });
});
it('keeps config CAS and host-generated key labels without changing conversation settings', async () => {
  const save = vi.fn(async () => ({ ok: true, value: {} })),
    get = vi.fn(async () => ({
      ok: true,
      value: {
        revision: 4,
        data: { mode: 'demo', autoSend: false, ...DEFAULT_VOICE_INPUT_SETTINGS },
      },
    }));
  const host = { configs: { get, save } } as unknown as DesktopHost,
    demo = { onVoiceDisabled: vi.fn() } as unknown as DemoController,
    controller = new VoiceInputController(host, 'unused', demo, vi.fn());
  const snapshot = {} as VoiceInputSnapshot;
  vi.spyOn(controller, 'snapshot').mockResolvedValue(snapshot);
  expect(await controller.saveSettings(3, DEFAULT_VOICE_INPUT_SETTINGS)).toEqual({
    ok: false,
    error: makeError('conflict', false),
  });
  expect(save).not.toHaveBeenCalled();
  expect(
    await controller.saveSettings(4, {
      ...DEFAULT_VOICE_INPUT_SETTINGS,
      talkKeyCode: 'F9',
      talkKeyLabel: 'untrusted label',
    }),
  ).toEqual({ ok: true, value: snapshot });
  expect(save).toHaveBeenCalledWith(
    { pluginId: 'pet.voice-chat', instanceId: 'default' },
    {
      mode: 'demo',
      autoSend: false,
      ...DEFAULT_VOICE_INPUT_SETTINGS,
      talkKeyCode: 'F9',
      talkKeyLabel: 'F9',
    },
    4,
  );
});
