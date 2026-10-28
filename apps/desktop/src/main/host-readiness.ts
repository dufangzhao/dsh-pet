import {
  makeError,
  type JsonObject,
  type KernelError,
  type OwnerRef,
  type PluginManifest,
  type PermissionDeclaration,
} from '@pet/contracts';
import type { ConfigService } from '@pet/host-kernel';
export interface HostAdapterAvailability {
  resources?(manifest: PluginManifest, candidate: JsonObject): Promise<boolean>;
  permission?(
    permission: PermissionDeclaration,
    manifest: PluginManifest,
    candidate: JsonObject,
  ): boolean;
}
/** Service availability is not authorization. Each operation still passes its task/permission gate. */
export async function checkHostReadiness(
  owner: OwnerRef,
  manifest: PluginManifest,
  candidate: JsonObject,
  configs: ConfigService,
  credentialsAvailable: boolean,
  adapters: HostAdapterAvailability = {},
): Promise<KernelError | null> {
  if (manifest.resources?.length && !(await adapters.resources?.(manifest, candidate)))
    return makeError('not-ready', false);
  for (const permission of manifest.permissions ?? []) {
    if (permission.kind === 'capability-use') continue;
    if (permission.kind === 'credentials' && credentialsAvailable) continue;
    if (adapters.permission?.(permission, manifest, candidate)) continue;
    return makeError('not-ready', false);
  }
  const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId },
    definition = configs.definition(identity);
  if (!definition || !definition.validate(candidate).ok || !(await configs.get(identity)).ok)
    return makeError('not-ready', false);
  return null;
}
