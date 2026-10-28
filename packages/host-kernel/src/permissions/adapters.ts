import type { CredentialAuthorizer } from '../credentials/credential-broker.js';
import type { CapabilityAuthorizer } from '../tasks/task-supervisor.js';
import type { PermissionService, PermissionLease } from './kernel.js';
import type { PluginManager } from '../runtime/plugin-manager.js';
import { sameOwner } from '../runtime/identity.js';
import { normalizePermission } from './policy.js';
export function credentialPermissionAuthorizer(service: PermissionService): CredentialAuthorizer {
  return async (request) => {
    const result = await service.authorize(
      request.owner,
      request.taskId,
      { kind: 'credentials', keys: [request.keyId] },
      request.signal,
    );
    return result.ok ? result.value : null;
  };
}
export function capabilityPermissionAuthorizer(
  service: PermissionService,
  manager?: Pick<PluginManager, 'get'>,
): CapabilityAuthorizer {
  return async (request) => {
    const result = await service.authorize(
      request.binding.consumer,
      request.taskId,
      { kind: 'capability-use', capability: request.binding.capability },
      request.signal,
    );
    if (!result.ok) return null;
    if (!manager) return result.value;
    const leases: PermissionLease[] = [result.value];
    let retained = false;
    const close = () => {
      let failed = false;
      for (const lease of leases)
        try {
          lease.close();
        } catch {
          failed = true;
        }
      if (failed) throw new Error('Permission cleanup failed');
    };
    try {
      const provider = manager.get(request.binding.provider);
      if (!provider || !sameOwner(provider.owner, request.binding.provider)) return null;
      const policy = provider.manifest.provides?.find(
        (item) => item.id === request.binding.providerId,
      )?.features?.['methodPermissions'];
      if (policy === undefined) {
        retained = true;
        return result.value;
      }
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
      const required = policy[request.method];
      if (required === undefined) {
        retained = true;
        return result.value;
      }
      if (!Array.isArray(required) || required.length > 16) return null;
      for (const value of required) {
        const permission = normalizePermission(value);
        if (!permission) return null;
        const allowed = await service.authorize(
          request.binding.provider,
          request.taskId,
          permission,
          request.signal,
        );
        if (!allowed.ok) return null;
        leases.push(allowed.value);
      }
      retained = true;
      let closed = false;
      return {
        signal: AbortSignal.any(leases.map((lease) => lease.signal)),
        isValid: () => !closed && leases.every((lease) => lease.isValid()),
        close: () => {
          if (!closed) {
            closed = true;
            close();
          }
        },
      };
    } finally {
      if (!retained) close();
    }
  };
}
