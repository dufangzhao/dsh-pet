import {
  makeError,
  type JsonObject,
  type KernelError,
  type OwnerRef,
  type PluginManifest,
} from '@pet/contracts';
import type { ConfigService } from '@pet/host-kernel';
/** Service availability is not authorization. Each operation still passes its task/permission gate. */
export async function checkHostReadiness(
  owner: OwnerRef,
  manifest: PluginManifest,
  candidate: JsonObject,
  configs: ConfigService,
  credentialsAvailable: boolean,
): Promise<KernelError | null> {
  if (manifest.resources?.length) return makeError('not-ready', false);
  for (const permission of manifest.permissions ?? []) {
    if (permission.kind === 'capability-use') continue;
    if (permission.kind === 'credentials' && credentialsAvailable) continue;
    return makeError('not-ready', false);
  }
  const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId },
    definition = configs.definition(identity);
  if (!definition || !definition.validate(candidate).ok || !(await configs.get(identity)).ok)
    return makeError('not-ready', false);
  return null;
}
