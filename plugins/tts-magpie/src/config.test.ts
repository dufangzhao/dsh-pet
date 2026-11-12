import { expect, it } from 'vitest';
import { normalizeSpeechCatalog, parseMagpieSpeechSettings } from './config.js';
const settings = {
  baseUrl: 'http://127.0.0.1:3425/v1',
  modelRef: '',
  authMode: 'local-client-id',
  protocol: 'mimo-native-pcm16-sse',
  voice: 'Mia',
};
it('uses one pure configuration projector without catalog or inference', () => {
  expect(parseMagpieSpeechSettings(settings)).toEqual(settings);
  expect(
    parseMagpieSpeechSettings({
      ...settings,
      baseUrl: 'https://gateway.example/audio/v1/',
      authMode: 'gateway-key',
      modelRef: 'xiaomi/mimo-v2.5-tts',
    }).baseUrl,
  ).toBe('https://gateway.example/audio/v1');
  for (const change of [
    { baseUrl: 'http://gateway.example/v1', authMode: 'gateway-key' },
    { baseUrl: 'https://gateway.example/v1' },
    { baseUrl: 'http://user@127.0.0.1:3425/v1' },
    { baseUrl: 'http://127.0.0.1:3425/v1?key=secret' },
    { modelRef: 'group/mimo-v2.5-tts' },
    { modelRef: 'xiaomi/mimo-v2.5-tts-voicedesign' },
    { modelRef: 'xiaomi/mimo-v2.5-asr' },
    { voice: 'unverified-style' },
    { extra: 'ignored' },
  ])
    expect(() => parseMagpieSpeechSettings({ ...settings, ...change })).toThrow();
});
it('only selects documented ordinary TTS actual rows and does not broaden ASR/chat metadata', () => {
  const rows = normalizeSpeechCatalog({
    data: [
      { id: 'xiaomi/mimo-v2.5-tts' },
      { id: 'xiaomi/mimo-v2.5-tts' },
      { id: 'xiaomi/mimo-v2.5-tts-voicedesign' },
      { id: 'group/mimo-v2.5-tts' },
      { id: 'xiaomi/mimo-v2.5-asr' },
      { id: 'vendor/audio-chat', kind: 'chat' },
      { id: 'vendor/tts-future', kind: 'chat' },
      { id: 'vendor/unknown', serves: 'speech' },
      { id: 'vendor/conflict-tts', kind: 'chat', serves: 'speech' },
    ],
  });
  expect(rows.filter((r) => r.selectable).map((r) => r.modelRef)).toEqual(['xiaomi/mimo-v2.5-tts']);
  expect(
    rows.some(
      (r) =>
        r.modelRef.includes('asr') ||
        r.modelRef.includes('chat') ||
        r.modelRef.includes('conflict'),
    ),
  ).toBe(false);
  expect(rows.filter((r) => !r.selectable).every((r) => r.reason === 'unsupported-protocol')).toBe(
    true,
  );
});
