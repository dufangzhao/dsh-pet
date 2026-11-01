import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VOICE_INPUT_SETTINGS, voiceInputModel, type OwnerRef } from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import { ConfigService, MemoryConfigStore } from '@pet/host-kernel';
import { demoReadiness } from './demo-readiness.js';
import { checkHostReadiness } from './host-readiness.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
it('initializes the real local ASR on a fresh profile before activation readiness is checked', async () => {
  const parsed = validateManifest(
    JSON.parse(await readFile(path.join(root, 'plugins/asr-local/plugin.json'), 'utf8')),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error.code);
  const owner: OwnerRef = { pluginId: parsed.value.id, instanceId: 'default', generation: 1 };
  const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId };
  const configs = new ConfigService(new MemoryConfigStore());
  try {
    expect(configs.register(identity, parsed.value).ok).toBe(true);
    expect(await configs.get(identity)).toMatchObject({ ok: false, error: { code: 'not-ready' } });
    const initialized = await configs.initialize(identity);
    expect(initialized).toMatchObject({
      ok: true,
      value: { revision: 1, data: { model: voiceInputModel(DEFAULT_VOICE_INPUT_SETTINGS.engine) } },
    });
    if (!initialized.ok) throw new Error(initialized.error.code);
    expect(
      await checkHostReadiness(
        owner,
        parsed.value,
        initialized.value.data,
        configs,
        false,
        demoReadiness(path.join(root, '.cache/unused-asr-test-cache')),
      ),
    ).toBeNull();
    expect(
      await checkHostReadiness(
        owner,
        parsed.value,
        { model: 'unrecognized-model' },
        configs,
        false,
        demoReadiness(root),
      ),
    ).toMatchObject({ code: 'not-ready' });
    expect(
      (await configs.save(identity, { model: 'windows-sapi' }, initialized.value.revision)).ok,
    ).toBe(true);
    expect(await configs.initialize(identity)).toMatchObject({
      ok: true,
      value: { revision: 2, data: { model: 'windows-sapi' } },
    });
  } finally {
    configs.close();
  }
});
