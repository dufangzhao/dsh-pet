import { definePlugin, type PluginDefinition } from '../index.js';
import type { PluginManifest } from '@pet/contracts';
/** Public-SDK-only reference: no kernel, filesystem, networking or management objects. */
export const recordingManifest: PluginManifest = {
  schemaVersion: 1,
  id: 'test.sdk-recording',
  version: '1.0.0',
  displayName: { 'zh-CN': 'SDK记录型示例' },
  description: { 'zh-CN': '仅供契约验收的合成记录型提供方' },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['win32-x64'],
  entries: { runtime: 'entry.mjs' },
  provides: [{ id: 'main', capability: 'test.recording@1' }],
};
export interface RecordingObservation {
  calls: number;
  disposed: number;
}
export function createRecordingExample(): {
  definition: PluginDefinition;
  observation: RecordingObservation;
} {
  const observation = { calls: 0, disposed: 0 };
  return {
    observation,
    definition: definePlugin({
      activate(context) {
        context.provide('main', {
          echo: async (task, input) => {
            if (context.signal.aborted || task.signal.aborted)
              throw new Error('Operation cancelled');
            observation.calls++;
            return input;
          },
        });
        context.effect(() => () => {
          observation.disposed++;
        });
      },
    }),
  };
}
