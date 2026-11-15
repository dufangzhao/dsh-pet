import { definePlugin } from '@pet/plugin-sdk';
import type { PluginManifest } from '@pet/contracts';

/** Native infrastructure owner for local source intent and supervised management tasks. */
export const LOCAL_QQ_CONTROL_ID = 'pet.local-qq-control';
export const localQQControlManifest: PluginManifest = {
  schemaVersion: 1,
  id: LOCAL_QQ_CONTROL_ID,
  version: '0.1.0',
  displayName: { en: 'Local QQ control', 'zh-CN': '本地 QQ 控制' },
  description: { en: 'Local QQ source intent and private management task owner' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['linux-x64', 'win32-x64'],
  entries: { runtime: 'src/qq-control.ts' },
  provides: [
    {
      id: 'control',
      capability: 'companion.localqq.control@1',
      features: {
        methodPermissions: { describe: [{ kind: 'files', scope: 'plugin-data', access: 'read' }] },
      },
    },
  ],
  permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
  config: {
    version: 1,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['officialEnabled', 'onebotEnabled'],
      properties: {
        officialEnabled: { type: 'boolean', default: false },
        onebotEnabled: { type: 'boolean', default: false },
      },
    },
    apply: { officialEnabled: 'immediate', onebotEnabled: 'immediate' },
  },
};
export const localQQControlDefinition = definePlugin({
  activate(context) {
    context.provide('control', { describe: async () => ({ version: 1 }) });
  },
});
