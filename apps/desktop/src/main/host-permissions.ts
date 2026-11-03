import { createHash } from 'node:crypto';
import type { OwnerRef, PluginManifest } from '@pet/contracts';
import {
  createPermissionKernel,
  type PluginManager,
  type TaskSupervisor,
  type DiscoveredPlugin,
  type InstanceIdentity,
  type ApprovalChannel,
  verifyDiscoveredPlugin,
} from '@pet/host-kernel';
export function createHostPermissions(
  reference: {
    manager?: PluginManager;
    tasks?: TaskSupervisor;
  },
  approval?: ApprovalChannel,
  approvalTimeoutMs?: number,
) {
  const catalog = new Map<
    string,
    { manifest: PluginManifest; digest: string; candidate: DiscoveredPlugin }
  >();
  const describe = (owner: OwnerRef) => {
    const snapshot = reference.manager?.get(owner);
    const source = catalog.get(JSON.stringify([owner.pluginId, owner.instanceId]));
    return snapshot && snapshot.owner.generation === owner.generation && source ? source : null;
  };
  const kernel = createPermissionKernel({
    ...(approval ? { approval } : {}),
    ...(approvalTimeoutMs !== undefined ? { approvalTimeoutMs } : {}),
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
    getPackage: (owner: OwnerRef): DiscoveredPlugin | null => describe(owner)?.candidate ?? null,
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
      const identity = { pluginId: candidate.manifest.id, instanceId };
      const key = JSON.stringify([identity.pluginId, identity.instanceId]);
      if (!catalog.has(key) && !kernel.control.setPreset(identity, 'allow'))
        throw new Error('Invalid default permission preset');
      catalog.set(key, {
        manifest: candidate.manifest,
        digest,
        candidate,
      });
    },
    forget: (identity: InstanceIdentity) => {
      const key = JSON.stringify([identity.pluginId, identity.instanceId]);
      const source = catalog.get(key);
      if (source) kernel.control.confirmTrust(identity, source.digest, false);
      kernel.control.revoke(identity);
      catalog.delete(key);
    },
    describeTrust: (owner: OwnerRef) => {
      const source = describe(owner);
      return source
        ? {
            digest: source.digest,
            trusted: kernel.service.isTrusted(
              { pluginId: owner.pluginId, instanceId: owner.instanceId },
              source.digest,
            ),
          }
        : null;
    },
    verifyTrust: async (owner: OwnerRef, expectedDigest: string) => {
      const source = describe(owner);
      return (
        !!source &&
        source.digest === expectedDigest &&
        (await verifyDiscoveredPlugin(source.candidate))
      );
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
