import { expect, it } from 'vitest';
import { mvpReadiness } from './mvp-readiness.js';
import {
  DEMO_PLUGIN_IDS,
  LOCAL_ASR_MODELS,
  VOICE_INPUT_LOCAL_MODELS,
  type PluginManifest,
} from '@pet/contracts';
it('admits configured legacy and current ASR models before installation', async () => {
  const adapter = mvpReadiness('/model-cache');
  const manifest = { id: DEMO_PLUGIN_IDS.asr } as PluginManifest;
  for (const model of [...LOCAL_ASR_MODELS, ...VOICE_INPUT_LOCAL_MODELS])
    expect(await adapter.resources?.(manifest, { model: model.id })).toBe(true);
  expect(await adapter.resources?.(manifest, { model: 'not-a-declared-model' })).toBe(false);
});
