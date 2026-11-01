import { expect, it } from 'vitest';
import {
  DEFAULT_VOICE_INPUT_SETTINGS,
  TALK_KEYS,
  VOICE_INPUT_LOCAL_MODELS,
  voiceInputModel,
} from './voice-input.js';
it('pins fixed Small Whisper files and exposes one physical key with a host label', () => {
  const model = VOICE_INPUT_LOCAL_MODELS.find(
    (model) => model.id === voiceInputModel('whisper-small'),
  );
  expect(model?.id).toBe('whisper-small-int8');
  expect(model?.files.reduce((sum, file) => sum + file.bytes, 0)).toBe(375485327);
  expect(
    model?.files.every((file) => file.url.includes('/8f3c18b358db4d1f2fc1eae49d75cd20989e4309/')),
  ).toBe(true);
  expect(TALK_KEYS[DEFAULT_VOICE_INPUT_SETTINGS.talkKeyCode]).toEqual({
    label: DEFAULT_VOICE_INPUT_SETTINGS.talkKeyLabel,
    virtualKey: 0xa5,
  });
  expect(voiceInputModel('windows-sapi')).toBe('windows-sapi');
  expect(voiceInputModel('openai')).toBe('openai');
});
