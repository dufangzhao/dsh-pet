import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '@pet/contracts/validation';
import { ConfigService, MemoryConfigStore } from '@pet/host-kernel';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
it.each(['asr-local', 'chat', 'voice-chat', 'llm-provider', 'avatar-default'])(
  'discovers and prepares the real %s plugin manifest',
  async (name) => {
    const parsed = validateManifest(
      JSON.parse(await readFile(path.join(root, 'plugins', name, 'plugin.json'), 'utf8')),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const configs = new ConfigService(new MemoryConfigStore());
    expect(
      configs.register({ pluginId: parsed.value.id, instanceId: 'default' }, parsed.value).ok,
    ).toBe(true);
    configs.close();
  },
);
