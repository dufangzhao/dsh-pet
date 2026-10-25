import { createHash } from 'node:crypto';
import type { OwnerRef, PluginManifest } from '@pet/contracts';
import {
  createPermissionKernel,
  type PluginManager,
  type TaskSupervisor,
  type DiscoveredPlugin,
} from '@pet/host-kernel';
export function createHostPermissions(reference: {
  manager?: PluginManager;
  tasks?: TaskSupervisor;
}) {
  const catalog = new Map<string, { manifest: PluginManifest; digest: string }>();
  const describe = (owner: OwnerRef) => {
    const snapshot = reference.manager?.get(owner);
    const source = catalog.get(JSON.stringify([owner.pluginId, owner.instanceId]));
    return snapshot && snapshot.owner.generation === owner.generation && source ? source : null;
  };
  const kernel = createPermissionKernel({
    host: {
      fingerprint: (identity) =>
        catalog.get(JSON.stringify([identity.pluginId, identity.instanceId]))?.digest ?? null,
      describe,
      isLive: (owner) => reference.manager?.isLive(owner) === true,
      ownerSignal: (owner) => reference.manager?.signal(owner) ?? null,
      taskSignal: (taskId, owner) => reference.tasks?.taskSignal(taskId, owner) ?? null,
    },
  });
  return Object.freeze({
    service: kernel.service,
    control: kernel.control,
    register: (candidate: DiscoveredPlugin, instanceId = 'default') => {
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            origin: candidate.origin,
            directory: candidate.directory,
            files: candidate.files,
          }),
        )
        .digest('hex');
      catalog.set(JSON.stringify([candidate.manifest.id, instanceId]), {
        manifest: candidate.manifest,
        digest,
      });
    },
    isTrusted: (owner: OwnerRef) => {
      const source = describe(owner);
      return (
        !!source &&
        kernel.service.isTrusted(
          { pluginId: owner.pluginId, instanceId: owner.instanceId },
          source.digest,
        )
      );
    },
  });
}
