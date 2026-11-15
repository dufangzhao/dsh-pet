import { expect, it } from 'vitest';
import {
  isLocalHostSourceTrustCommand,
  isLocalHostSourcePresetCommand,
  isLocalHostSourceEnabledCommand,
  isLocalHostSecretTarget,
} from './local-host-console.js';
const target = { hostId: 'host-1', bootId: 'boot-1' };
it('requires exact review and permission capture for all three managed sources', () => {
  for (const protocol of ['official', 'onebot-v11', 'agent-link']) {
    const trust = {
      ...target,
      protocol,
      expectedDigest: 'a'.repeat(64),
      expectedPermissionEpoch: 3,
      trusted: true,
    };
    expect(isLocalHostSourceTrustCommand(trust)).toBe(true);
    expect(isLocalHostSourceTrustCommand({ ...trust, expectedPermissionEpoch: -1 })).toBe(false);
    expect(isLocalHostSourceTrustCommand({ ...trust, value: 'not-a-control-secret' })).toBe(false);
    const preset = {
      ...target,
      protocol,
      expectedDigest: trust.expectedDigest,
      expectedPermissionEpoch: trust.expectedPermissionEpoch,
    };
    expect(isLocalHostSourcePresetCommand({ ...preset, preset: 'allow' })).toBe(true);
  }
});
it('QQ enabling captures control config and key domains and never treats AgentLink as a QQ source', () => {
  const input = {
    ...target,
    protocol: 'official',
    enabled: true,
    expectedControlRevision: 2,
    expectedConfigRevision: 3,
    expectedCredentialVersion: 'captured-key-version',
  };
  expect(isLocalHostSourceEnabledCommand(input)).toBe(true);
  expect(isLocalHostSourceEnabledCommand({ ...input, protocol: 'agent-link' })).toBe(false);
  const missing = {
    ...target,
    protocol: input.protocol,
    enabled: input.enabled,
    expectedControlRevision: input.expectedControlRevision,
    expectedCredentialVersion: input.expectedCredentialVersion,
  };
  expect(isLocalHostSourceEnabledCommand(missing)).toBe(false);
});
it('secret preparation accepts metadata only and cannot choose an owner task or plaintext value', () => {
  for (const purpose of ['qq-source', 'agent-link']) {
    const input = {
      ...target,
      purpose,
      ...(purpose === 'qq-source' ? { protocol: 'onebot-v11' } : {}),
      expectedRevision: 1,
      expectedCredentialVersion: 'v1',
    };
    expect(isLocalHostSecretTarget(input)).toBe(true);
    for (const fields of [
      { value: 'forbidden' },
      { owner: { pluginId: 'pet.qq-official' } },
      { taskId: 'foreign' },
      { url: 'https://arbitrary.invalid' },
    ])
      expect(isLocalHostSecretTarget({ ...input, ...fields })).toBe(false);
  }
});
