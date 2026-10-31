import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  MODEL_SERVICE_ENDPOINTS,
  modelProviderId,
} from '../../packages/contracts/src/model-services.ts';
import { MODEL_REASONING_EFFORTS } from '../../packages/contracts/src/model-connection.ts';
const root = path.dirname(fileURLToPath(import.meta.url));
const available = MODEL_SERVICE_ENDPOINTS.filter((item) => item.available);
const endpointOrigins = (item) =>
  item.protocol === 'browser'
    ? [new URL(item.baseUrl).origin, 'https://auth.openai.com']
    : [new URL(item.baseUrl).origin];
const origins = [...new Set(available.flatMap(endpointOrigins))];
const chunks = (values) =>
  Array.from({ length: Math.ceil(values.length / 16) }, (_, index) =>
    values.slice(index * 16, index * 16 + 16),
  );
const provides = available.map((item) => ({
  id: modelProviderId(item.id),
  capability: 'llm.responses@1',
  features: {
    methodPermissions: Object.fromEntries(
      ['respond', 'test'].map((method) => [
        method,
        [{ kind: 'network', origins: endpointOrigins(item) }],
      ]),
    ),
  },
}));
provides.push({
  id: 'deepseek',
  capability: 'llm.chat@1',
  features: {
    methodPermissions: { respond: [{ kind: 'network', origins: ['https://api.deepseek.com'] }] },
  },
});
const manifest = {
  schemaVersion: 1,
  id: 'pet.llm-provider',
  version: '0.2.0',
  displayName: { 'zh-CN': '模型服务' },
  description: { 'zh-CN': '按端点独立保管Key，使用标准模型协议' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'dist/index.mjs' },
  provides,
  consumes: [{ capability: 'llm.responses@1', optional: true }],
  permissions: [
    { kind: 'capability-use', capability: 'llm.responses@1' },
    ...chunks(available.map((item) => item.secretKey)).map((keys) => ({
      kind: 'credentials',
      keys,
    })),
    ...chunks(origins).map((origins) => ({ kind: 'network', origins })),
  ],
  config: {
    version: 1,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          title: '原有DeepSeek模型',
          default: 'deepseek-chat',
          minLength: 1,
          maxLength: 128,
        },
        active: { type: 'string', enum: ['', ...available.map((item) => item.id)], default: '' },
        models: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            available.map((item) => [
              item.id,
              { type: 'string', default: item.defaultModel, minLength: 1, maxLength: 128 },
            ]),
          ),
        },
        reasoningEfforts: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            available.map((item) => [
              item.id,
              { type: 'string', enum: [...MODEL_REASONING_EFFORTS], default: 'default' },
            ]),
          ),
        },
      },
    },
    apply: {
      active: 'immediate',
      models: 'immediate',
      model: 'immediate',
      reasoningEfforts: 'immediate',
    },
  },
};
await fs.writeFile(
  path.join(root, 'plugin.json'),
  await format(JSON.stringify(manifest), {
    ...(await resolveConfig(path.join(root, 'plugin.json'))),
    parser: 'json',
  }),
);
