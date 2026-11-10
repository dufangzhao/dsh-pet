import { expect, it } from 'vitest';
import { mvpReadiness } from './mvp-readiness.js';
import {
  DEMO_PLUGIN_IDS,
  LOCAL_ASR_MODELS,
  VOICE_INPUT_LOCAL_MODELS,
  VOICE_CAPTURE_PLUGIN_ID,
  type PluginManifest,
} from '@pet/contracts';
it('admits configured legacy and current ASR models before installation', async () => {
  const adapter = mvpReadiness('/model-cache');
  const manifest = { id: DEMO_PLUGIN_IDS.asr } as PluginManifest;
  for (const model of [...LOCAL_ASR_MODELS, ...VOICE_INPUT_LOCAL_MODELS])
    expect(await adapter.resources?.(manifest, { model: model.id })).toBe(true);
  expect(await adapter.resources?.(manifest, { model: 'not-a-declared-model' })).toBe(false);
});
it('admits only the exact capture source when its native adapter is installed, without generic mic readiness', () => {
  const capture = { id: VOICE_CAPTURE_PLUGIN_ID } as PluginManifest;
  expect(mvpReadiness('/unused').permission?.({ kind: 'microphone' }, capture, {})).toBe(false);
  const installed = mvpReadiness('/unused', true);
  expect(installed.permission?.({ kind: 'microphone' }, capture, {})).toBe(true);
  expect(
    installed.permission?.({ kind: 'microphone' }, { id: 'pet.other' } as PluginManifest, {}),
  ).toBe(false);
  expect(
    installed.permission?.({ kind: 'network', origins: ['https://example.com'] }, capture, {}),
  ).toBe(false);
});
