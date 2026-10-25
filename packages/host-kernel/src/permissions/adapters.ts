import type { CredentialAuthorizer } from '../credentials/credential-broker.js';
import type { CapabilityAuthorizer } from '../tasks/task-supervisor.js';
import type { PermissionService } from './kernel.js';
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
export function capabilityPermissionAuthorizer(service: PermissionService): CapabilityAuthorizer {
  return async (request) => {
    const result = await service.authorize(
      request.binding.consumer,
      request.taskId,
      { kind: 'capability-use', capability: request.binding.capability },
      request.signal,
    );
    return result.ok ? result.value : null;
  };
}
