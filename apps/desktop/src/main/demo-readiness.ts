import { DEMO_PLUGIN_IDS } from '@pet/contracts';
import type { HostAdapterAvailability } from './host-readiness.js';
import { modelPresent } from '../../../../plugins/asr-local/src/model-store.js';
export function demoReadiness(modelRoot: string): HostAdapterAvailability {
  return {
    resources: async (manifest, candidate) => {
      if (manifest.id !== DEMO_PLUGIN_IDS.asr || typeof candidate['model'] !== 'string')
        return false;
      try {
        return await modelPresent(modelRoot, candidate['model']);
      } catch {
        return false;
      }
    },
    permission: (permission, manifest) => {
      if (manifest.id === DEMO_PLUGIN_IDS.asr)
        return (
          (permission.kind === 'files' &&
            permission.scope === 'resources' &&
            permission.access === 'read') ||
          (permission.kind === 'process' && permission.workers.every((id) => id === 'recognizer'))
        );
      if (manifest.id === DEMO_PLUGIN_IDS.voice)
        return (
          permission.kind === 'microphone' ||
          (permission.kind === 'files' && permission.scope === 'plugin-data')
        );
      return (
        manifest.id === DEMO_PLUGIN_IDS.cloud &&
        permission.kind === 'network' &&
        permission.origins.every((origin) => origin === 'https://api.deepseek.com')
      );
    },
  };
}
