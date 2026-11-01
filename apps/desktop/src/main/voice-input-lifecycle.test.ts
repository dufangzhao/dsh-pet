import { expect, it, vi } from 'vitest';
import {
  APPLICATION_PLUGIN_IDS,
  DEFAULT_VOICE_INPUT_SETTINGS,
  type VoiceInputSnapshot,
} from '@pet/contracts';
import type { DesktopHost } from './desktop-host.js';
import type { DemoController } from './demo-controller.js';
import { VoiceInputController } from './voice-input-controller.js';
it('stops the canonical input feature while retaining the functional module and its page', async () => {
  const disable = vi.fn(),
    setFeature = vi.fn(async () => ({ ok: true as const, value: null })),
    cancelCapture = vi.fn();
  const host = { manager: { disable } } as unknown as DesktopHost,
    controller = new VoiceInputController(
      host,
      'unused',
      { onVoiceDisabled: cancelCapture } as unknown as DemoController,
      vi.fn(),
      () => true,
      setFeature,
    );
  const snapshot = { active: false } as VoiceInputSnapshot;
  vi.spyOn(controller, 'snapshot').mockResolvedValue(snapshot);
  expect(await controller.stop()).toEqual({ ok: true, value: snapshot });
  expect(setFeature).toHaveBeenCalledWith(false);
  expect(cancelCapture).toHaveBeenCalledOnce();
  expect(disable).not.toHaveBeenCalled();
});
it('restoration preserves a deliberately disabled selected ASR and does not save feature preferences', async () => {
  const setFeature = vi.fn(),
    get = vi.fn(async ({ pluginId }: { pluginId: string }) => ({
      ok: true,
      value: {
        revision: 1,
        data:
          pluginId === APPLICATION_PLUGIN_IDS.profile
            ? { voiceEnabled: true }
            : { ...DEFAULT_VOICE_INPUT_SETTINGS },
      },
    })),
    changed = vi.fn();
  const host = { configs: { get }, manager: { get: () => undefined } } as unknown as DesktopHost,
    controller = new VoiceInputController(
      host,
      'unused',
      { onVoiceDisabled: vi.fn() } as unknown as DemoController,
      changed,
      (id) => id !== 'pet.asr-local',
      setFeature,
    );
  await controller.restore();
  expect(setFeature).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});
