import { SPEECH_OUTPUT_PLUGIN_IDS } from '@pet/contracts';
import { demoReadiness } from './demo-readiness.js';
import type { HostAdapterAvailability } from './host-readiness.js';
/** Native adapter availability only; authorization still belongs to PermissionKernel. */
export function mvpReadiness(modelRoot: string): HostAdapterAvailability {
  const base = demoReadiness(modelRoot);
  return {
    ...base,
    permission(permission, manifest, candidate) {
      if (manifest.id === SPEECH_OUTPUT_PLUGIN_IDS.system && permission.kind === 'process')
        return (
          process.platform === 'win32' && permission.workers.every((id) => id === 'synthesizer')
        );
      return base.permission?.(permission, manifest, candidate) ?? false;
    },
  };
}
