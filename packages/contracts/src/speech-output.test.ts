import { describe, expect, it } from 'vitest';
import {
  isSpeechOutputAudioDescriptor,
  isSpeechOutputRequest,
  isSpeechOutputSaveSettings,
  SPEECH_OUTPUT_MAX_BYTES,
  SPEECH_OUTPUT_MAX_TEXT,
} from './speech-output.js';
const provider = { pluginId: 'pet.system-tts', instanceId: 'default', providerId: 'system' };
const request = {
  utteranceId: 'reply-1',
  text: '你好，世界。',
  language: 'zh-CN',
  voice: null,
  rate: 0,
};
const descriptor = {
  utteranceId: 'reply-1',
  codec: 'pcm-s16le',
  sampleRate: 24000,
  channels: 1,
  frames: 480,
  media: {
    streamId: 'stream-1',
    taskId: 'task-1',
    owner: { pluginId: 'pet.system-tts', instanceId: 'default', generation: 1 },
  },
};
describe('speech output contract', () => {
  it('keeps plain multilingual text and selected options in one bounded request', () => {
    expect(isSpeechOutputRequest(request)).toBe(true);
    expect(isSpeechOutputRequest({ ...request, text: '蓝'.repeat(SPEECH_OUTPUT_MAX_TEXT) })).toBe(
      true,
    );
    for (const patch of [
      { text: '蓝'.repeat(SPEECH_OUTPUT_MAX_TEXT + 1) },
      { text: '\u0000' },
      { language: 'zh-CN\n' },
      { voice: '' },
      { rate: 10.5 },
      { shell: 'cmd' },
    ])
      expect(isSpeechOutputRequest({ ...request, ...patch })).toBe(false);
  });
  it('persists a stable selection without accepting generation or target owner injection', () => {
    const settings = {
      expectedRevision: 3,
      enabled: true,
      provider,
      voice: null,
      rate: 0,
      volume: 85,
    };
    expect(isSpeechOutputSaveSettings(settings)).toBe(true);
    expect(
      isSpeechOutputSaveSettings({ ...settings, provider: { ...provider, generation: 9 } }),
    ).toBe(false);
    expect(isSpeechOutputSaveSettings({ ...settings, owner: provider })).toBe(false);
    expect(isSpeechOutputSaveSettings({ ...settings, expectedRevision: 2.5 })).toBe(false);
    expect(
      isSpeechOutputSaveSettings({
        ...settings,
        provider: { ...provider, providerId: '__proto__' },
      }),
    ).toBe(false);
  });
  it('requires concrete PCM format, bounded total bytes and a generation-bound media reference', () => {
    expect(isSpeechOutputAudioDescriptor(descriptor)).toBe(true);
    for (const patch of [
      { codec: 'guess' },
      { channels: 0 },
      { sampleRate: 0 },
      { frames: SPEECH_OUTPUT_MAX_BYTES },
      { bytes: [1, 2] },
    ])
      expect(isSpeechOutputAudioDescriptor({ ...descriptor, ...patch })).toBe(false);
    expect(
      isSpeechOutputAudioDescriptor({
        ...descriptor,
        media: { ...descriptor.media, owner: { ...descriptor.media.owner, generation: 0 } },
      }),
    ).toBe(false);
    expect(
      isSpeechOutputAudioDescriptor({
        ...descriptor,
        media: { ...descriptor.media, taskId: 'task-1\n' },
      }),
    ).toBe(false);
  });
});
