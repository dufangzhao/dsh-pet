import { SPEECH_OUTPUT_PLUGIN_IDS, VOICE_CAPTURE_PLUGIN_ID } from '@pet/contracts';
import { demoReadiness } from './demo-readiness.js';
import type { HostAdapterAvailability } from './host-readiness.js';
/** Native adapter availability only; authorization still belongs to PermissionKernel. */
export function mvpReadiness(modelRoot: string, captureInstalled = false): HostAdapterAvailability {
  const base = demoReadiness(modelRoot);
  return {
    ...base,
    permission(permission, manifest, candidate) {
      if (manifest.id === VOICE_CAPTURE_PLUGIN_ID && permission.kind === 'microphone')
        return captureInstalled;
      if (manifest.id === SPEECH_OUTPUT_PLUGIN_IDS.system && permission.kind === 'process')
        return (
          process.platform === 'win32' && permission.workers.every((id) => id === 'synthesizer')
        );
      return base.permission?.(permission, manifest, candidate) ?? false;
    },
  };
}
