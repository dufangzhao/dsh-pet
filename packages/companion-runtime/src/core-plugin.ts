import { definePlugin } from '@pet/plugin-sdk';
import type { PluginManifest } from '@pet/contracts';
import { COMPANION_HOST_ID } from './plugin-host.js';

export const STATE_CAPABILITY = 'companion.state@1';
export const EXECUTION_CAPABILITY = 'execution.javascript@1';
export const HARNESS_CAPABILITY = 'companion.harness@1';
import { MODEL_CONNECTION_CAPABILITY } from './model-connection-types.js';
import { VOICE_INPUT_CAPABILITY } from '@pet/contracts';

/** Protected bootstrap only; persona content remains revisioned configuration. */
export const companionHostManifest: PluginManifest = {
  schemaVersion: 1,
  id: COMPANION_HOST_ID,
  version: '0.1.0',
  displayName: { 'zh-CN': '持续 Agent 服务', en: 'Companion service' },
  description: {
    'zh-CN': '独立服务的配置、准入和生命周期',
    en: 'Service configuration, admission and lifecycle',
  },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'],
  entries: { runtime: 'src/core-plugin.ts' },
  consumes: [
    STATE_CAPABILITY,
    EXECUTION_CAPABILITY,
    HARNESS_CAPABILITY,
    MODEL_CONNECTION_CAPABILITY,
    VOICE_INPUT_CAPABILITY,
  ].map((capability) => ({
    capability,
    optional: true,
  })),
  permissions: [
    ...[
      STATE_CAPABILITY,
      EXECUTION_CAPABILITY,
      HARNESS_CAPABILITY,
      MODEL_CONNECTION_CAPABILITY,
      VOICE_INPUT_CAPABILITY,
    ].map((capability) => ({
      kind: 'capability-use' as const,
      capability,
    })),
    { kind: 'files', scope: 'plugin-data', access: 'read-write' },
  ],
  config: {
    version: 1,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'persona', 'harness', 'disabledPlugins'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80, default: '同伴' },
        persona: {
          type: 'string',
          minLength: 1,
          maxLength: 16384,
          default:
            'You are a consistent, helpful personal assistant. Distinguish accepted work from completed work and use recorded facts accurately.',
        },
        harness: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          default: 'pet.harness-cortico/cortico',
        },
        modelConnection: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          default: 'pet.model-connection-magpie/magpie',
        },
        modelMode: { type: 'string', enum: ['scripted', 'model'], default: 'scripted' },
        disabledPlugins: {
          type: 'array',
          maxItems: 32,
          uniqueItems: true,
          items: { type: 'string', maxLength: 128 },
          default: [],
        },
      },
    },
  },
};

export const companionHostDefinition = definePlugin({ activate() {} });
