import { expect, it } from 'vitest';
import {
  classifyVoiceModel,
  normalizeAsrCatalog,
  parseMagpieAsrSettings,
  resolveMiMoAsr,
} from './config.js';
const settings = {
  baseUrl: 'http://127.0.0.1:3425/v1/',
  modelRef: '',
  authMode: 'local-client-id',
  protocol: 'mimo-native',
};
it('normalizes targets and permits an empty model only for discovery', () => {
  expect(parseMagpieAsrSettings(settings)).toEqual({
    ...settings,
    baseUrl: 'http://127.0.0.1:3425/v1',
  });
  expect(resolveMiMoAsr('xiaomi/mimo-v2.5-asr')).toEqual({
    vendor: 'xiaomi',
    wireModel: 'mimo-v2.5-asr',
  });
});
it.each([
  'group/mimo-v2.5-asr',
  'GROUP/mimo-v2.5-asr',
  'mimo-v2.5-asr',
  'xiaomi/mimo-v2.5-tts',
  'xiaomi/mimo-v2.5-asr/other',
  'xiaomi/mimo-v2.5-asr-voiceclone',
  'x/mimo-asr?other',
  'x /mimo-asr',
])('rejects unsupported routing model %s', (modelRef) => {
  expect(() => resolveMiMoAsr(modelRef)).toThrow();
  expect(() => parseMagpieAsrSettings({ ...settings, modelRef })).toThrow();
});
it.each([
  'http://remote.example/v1',
  'https://user:pass@remote.example/v1',
  'http://127.0.0.1/v1?key=x',
  'https://remote.example/v1#fragment',
  'http://127.0.0.2/v1',
])('rejects a forbidden gateway target %s', (baseUrl) =>
  expect(() => parseMagpieAsrSettings({ ...settings, baseUrl })).toThrow(),
);
it('uses explicit task metadata over bounded returned-name inference, excluding chat/audio understanding', () => {
  expect(classifyVoiceModel({ id: 'v/mimo-asr', kind: 'chat' })).toMatchObject({
    role: 'chat',
    classification: 'metadata',
  });
  expect(classifyVoiceModel({ id: 'v/mimo-asr', kind: 'audio_understanding' })).toMatchObject({
    role: 'chat',
  });
  expect(
    classifyVoiceModel({ id: 'v/mimo-asr', provider_type: 'asr', serves: 'tts' }),
  ).toMatchObject({ role: 'unknown' });
  expect(classifyVoiceModel({ id: 'asrvendor/chat', input_modalities: ['audio'] })).toMatchObject({
    role: 'unknown',
  });
  expect(classifyVoiceModel({ id: 'v/someasrthing' })).toMatchObject({ role: 'unknown' });
  expect(
    normalizeAsrCatalog({
      data: [
        { id: 'x/mimo-asr' },
        { id: 'x/mimo-tts' },
        { id: 'x/whisper' },
        { id: 'x/mimo-asr', kind: 'asr' },
      ],
    }),
  ).toEqual([
    expect.objectContaining({ modelRef: 'x/mimo-asr', selectable: true, protocol: 'mimo-native' }),
    expect.objectContaining({
      modelRef: 'x/whisper',
      selectable: false,
      reason: 'unsupported-protocol',
    }),
  ]);
});
it('bounds complete catalogs and never invents routing IDs from labels', () => {
  expect(() =>
    normalizeAsrCatalog({ data: [{ id: 'bad id', name: 'xiaomi/mimo-asr' }] }),
  ).toThrow();
  expect(() =>
    normalizeAsrCatalog({
      data: Array.from({ length: 65 }, (_, n) => ({ id: `v/mimo-${n}-asr` })),
    }),
  ).toThrow();
  expect(() =>
    normalizeAsrCatalog({ data: Array.from({ length: 513 }, (_, n) => ({ id: `v/chat-${n}` })) }),
  ).toThrow();
  expect(
    normalizeAsrCatalog({ data: [{ id: 'v/mimo-asr', display_name: '字'.repeat(100) }] })[0]?.label,
  ).toHaveLength(80);
});
