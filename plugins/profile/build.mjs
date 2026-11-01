import { format, resolveConfig } from 'prettier';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_PROFILE_SCHEMA } from '../../packages/contracts/src/application.ts';
const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = {
  schemaVersion: 1,
  id: 'pet.profile',
  version: '0.1.0',
  displayName: { 'zh-CN': '桌宠偏好', en: 'Pet preferences' },
  description: {
    'zh-CN': '人设与桌面外观的统一设置',
    en: 'Shared persona and appearance settings',
  },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'dist/index.mjs' },
  provides: [{ id: 'profile', capability: 'app.profile@1' }],
  consumes: [{ capability: 'speech.output@1', optional: true }],
  permissions: [
    { kind: 'files', scope: 'plugin-data', access: 'read-write' },
    { kind: 'capability-use', capability: 'speech.output@1' },
  ],
  config: { version: 2, schema: APPLICATION_PROFILE_SCHEMA, apply: { personaPrompt: 'reload' } },
};
await fs.writeFile(
  path.join(root, 'plugin.json'),
  await format(JSON.stringify(manifest), {
    ...(await resolveConfig(path.join(root, 'plugin.json'))),
    parser: 'json',
  }),
);
