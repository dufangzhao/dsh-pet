import { describe, expect, it } from 'vitest';
import type { LocalHostSourceBinding, LocalHostTaskReference } from './local-host.js';
import {
  validateLocalHostSourceBinding,
  validateLocalHostTaskReference,
} from './validation/index.js';

const sourceOwner = { pluginId: 'pet.qq-onebot', instanceId: 'default', generation: 2 };
const binding: LocalHostSourceBinding = {
  hostId: 'host-1',
  hostBootId: 'boot-1',
  bridgeSessionId: 'bridge-1',
  sourceOwner,
  sourceConfigRevision: 3,
  sourcePermissionEpoch: 0,
  sourceCredentialVersion: 'boot:version-4',
  nativeConnectionId: 'native-1',
};

describe('local-host provenance shape guards', () => {
  it('owns a closed source binding and task reference without granting authority', () => {
    const task: LocalHostTaskReference = { owner: sourceOwner, taskId: 'task-1' };
    const checked = validateLocalHostSourceBinding(binding);
    expect(checked).toEqual({ ok: true, value: binding });
    expect(checked.ok && checked.value === binding).toBe(false);
    expect(validateLocalHostTaskReference(task)).toEqual({ ok: true, value: task });
  });

  it('rejects unknown role/secret fields, invalid epochs and missing native provenance', () => {
    for (const input of [
      { ...binding, role: 'owner' },
      { ...binding, accessToken: 'synthetic-secret' },
      { ...binding, sourcePermissionEpoch: -1 },
      { ...binding, sourceConfigRevision: 0 },
      { ...binding, sourceOwner: { ...sourceOwner, generation: 1.5 } },
      { ...binding, nativeConnectionId: '' },
      { ...binding, sourceCredentialVersion: 'bad\nversion' },
    ])
      expect(validateLocalHostSourceBinding(input).ok).toBe(false);
    expect(
      validateLocalHostTaskReference({ owner: sourceOwner, taskId: 'task-1', signal: true }).ok,
    ).toBe(false);
  });

  it('preflights accessors and proxies without reading the supplied value', () => {
    let reads = 0;
    const accessor = Object.defineProperty({ ...binding }, 'hostId', {
      enumerable: true,
      get() {
        reads++;
        return 'host-1';
      },
    });
    expect(validateLocalHostSourceBinding(accessor).ok).toBe(false);
    expect(validateLocalHostSourceBinding(new Proxy(binding, {})).ok).toBe(false);
    expect(reads).toBe(0);
  });
});
