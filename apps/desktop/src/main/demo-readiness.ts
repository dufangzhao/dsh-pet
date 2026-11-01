import {
  DEMO_PLUGIN_IDS,
  LOCAL_ASR_MODELS,
  MODEL_SERVICE_ENDPOINTS,
  VOICE_INPUT_CLOUD_ORIGINS,
  VOICE_INPUT_LOCAL_MODELS,
  VOICE_INPUT_PLUGIN_IDS,
} from '@pet/contracts';
const modelOrigins = new Set([
  'https://auth.openai.com',
  ...MODEL_SERVICE_ENDPOINTS.filter((item) => item.available).map(
    (item) => new URL(item.baseUrl).origin,
  ),
]);
import type { HostAdapterAvailability } from './host-readiness.js';

export function demoReadiness(_modelRoot: string): HostAdapterAvailability {
  return {
    resources: async (manifest, candidate) => {
      if (manifest.id !== DEMO_PLUGIN_IDS.asr || typeof candidate['model'] !== 'string')
        return false;
      // The runtime can be activated before installation. Prepare and the public snapshot
      // report actual cached bytes; gating activation here would make install impossible.
      return (
        candidate['model'] === 'windows-sapi' ||
        [...LOCAL_ASR_MODELS, ...VOICE_INPUT_LOCAL_MODELS].some(
          (model) => model.id === candidate['model'],
        )
      );
    },
    permission: (permission, manifest) => {
      if (permission.kind === 'files' && permission.scope === 'plugin-data') return true;
      if (manifest.id === DEMO_PLUGIN_IDS.asr)
        return (
          (permission.kind === 'files' &&
            permission.scope === 'resources' &&
            ['read', 'write'].includes(permission.access)) ||
          (permission.kind === 'network' &&
            permission.origins.every((origin) =>
              ['https://modelscope.cn', 'https://huggingface.co'].includes(origin),
            )) ||
          (permission.kind === 'process' && permission.workers.every((id) => id === 'recognizer'))
        );
      if (manifest.id === DEMO_PLUGIN_IDS.voice)
        return (
          permission.kind === 'microphone' ||
          (permission.kind === 'files' && permission.scope === 'plugin-data')
        );
      if (manifest.id === VOICE_INPUT_PLUGIN_IDS.cloud)
        return (
          permission.kind === 'network' &&
          permission.origins.every((origin) =>
            VOICE_INPUT_CLOUD_ORIGINS.some((allowed) => allowed === origin),
          )
        );
      return (
        manifest.id === DEMO_PLUGIN_IDS.cloud &&
        permission.kind === 'network' &&
        permission.origins.every((origin) => modelOrigins.has(origin))
      );
    },
  };
}
