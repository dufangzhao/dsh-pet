/** Browser-safe local-host operator projections. Secret text is accepted only by fixed Native setters, never control JSON. */
import { LOCAL_HOST_PROTOCOL_VERSION, type LocalHostRuntimeIdentity } from './local-host.js';
import type { LocalAgentLinkView, LocalAgentLinkTargetCommand } from './local-host-qq.js';
import type { QQProtocol } from './companion-origin.js';
import {
  isQQSourceView,
  isQQSourceSettingsCommand,
  type QQSourceView,
  type QQSourceSettingsCommand,
} from './companion-qq.js';
import { PERMISSION_PRESETS, type PermissionPreset } from './security.js';
import { isKernelErrorCode, type KernelError } from './errors.js';

export interface LocalHostConsoleTarget {
  readonly hostId: string;
  readonly bootId: string;
}
export interface LocalHostConsoleView {
  readonly identity: LocalHostRuntimeIdentity;
  readonly sourcesRevision: number;
  readonly sources: readonly QQSourceView[];
  readonly agentLink: LocalAgentLinkView;
}
export interface LocalHostConsoleMutation {
  readonly view: LocalHostConsoleView;
  readonly error: KernelError | null;
}
export type ManagedSourceSelector = QQProtocol | 'agent-link';
export interface LocalHostSourceReview {
  readonly protocol: ManagedSourceSelector;
  readonly digest: string;
  readonly trusted: boolean;
  readonly preset: PermissionPreset;
  readonly blocked: boolean;
  readonly permissionEpoch: number;
  readonly cleanup: 'settled' | 'pending' | 'failed';
}
export interface LocalHostSourceReviewCommand extends LocalHostConsoleTarget {
  readonly protocol: ManagedSourceSelector;
}
export interface LocalHostSourceTrustCommand extends LocalHostConsoleTarget {
  readonly protocol: ManagedSourceSelector;
  readonly expectedDigest: string;
  readonly expectedPermissionEpoch: number;
  readonly trusted: boolean;
}
export interface LocalHostSourcePresetCommand extends LocalHostConsoleTarget {
  readonly protocol: ManagedSourceSelector;
  readonly expectedDigest: string;
  readonly expectedPermissionEpoch: number;
  readonly preset: PermissionPreset;
}
export interface LocalHostSourceEnabledCommand extends LocalHostConsoleTarget {
  readonly protocol: QQProtocol;
  readonly enabled: boolean;
  readonly expectedControlRevision: number;
  readonly expectedConfigRevision: number;
  readonly expectedCredentialVersion: string;
}
/** No key value or caller-chosen owner/task. Native uses this to register the actual daemon task. */
export type LocalHostSecretTarget = LocalHostConsoleTarget &
  (
    | {
        readonly purpose: 'qq-source';
        readonly protocol: QQProtocol;
        readonly expectedRevision: number;
        readonly expectedCredentialVersion: string;
      }
    | {
        readonly purpose: 'agent-link';
        readonly expectedRevision: number;
        readonly expectedCredentialVersion: string;
      }
  );
export type LocalHostAgentSettingsCommand = LocalHostConsoleTarget & LocalAgentLinkTargetCommand;
export type LocalHostSourceSettingsCommand = LocalHostConsoleTarget & QQSourceSettingsCommand;
export interface LocalHostAgentEnabledCommand extends LocalHostConsoleTarget {
  readonly expectedRevision: number;
  readonly expectedCredentialVersion: string;
  readonly enabled: boolean;
}

const row = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 200 &&
  ![...v].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127);
const revision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const protocol = (v: unknown): v is QQProtocol => v === 'official' || v === 'onebot-v11';
export const isManagedSourceSelector = (v: unknown): v is ManagedSourceSelector =>
  protocol(v) || v === 'agent-link';
const target = (v: Record<string, unknown>): boolean => id(v['hostId']) && id(v['bootId']);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const error = (v: unknown): boolean =>
  v === null ||
  (() => {
    const e = row(v);
    return (
      !!e &&
      exact(e, ['code', 'messageKey', 'retryable']) &&
      isKernelErrorCode(e['code']) &&
      e['messageKey'] === 'errors.' + e['code'] &&
      typeof e['retryable'] === 'boolean'
    );
  })();
export function isLocalHostConsoleTarget(value: unknown): value is LocalHostConsoleTarget {
  const v = row(value);
  return !!v && exact(v, ['hostId', 'bootId']) && target(v);
}
export function isLocalHostSourceReviewCommand(
  value: unknown,
): value is LocalHostSourceReviewCommand {
  const v = row(value);
  return (
    !!v &&
    exact(v, ['hostId', 'bootId', 'protocol']) &&
    target(v) &&
    isManagedSourceSelector(v['protocol'])
  );
}
export function isLocalHostSourceTrustCommand(
  value: unknown,
): value is LocalHostSourceTrustCommand {
  const v = row(value);
  return (
    !!v &&
    exact(v, [
      'hostId',
      'bootId',
      'protocol',
      'expectedDigest',
      'expectedPermissionEpoch',
      'trusted',
    ]) &&
    target(v) &&
    isManagedSourceSelector(v['protocol']) &&
    digest(v['expectedDigest']) &&
    revision(v['expectedPermissionEpoch']) &&
    typeof v['trusted'] === 'boolean'
  );
}
export function isLocalHostSourcePresetCommand(
  value: unknown,
): value is LocalHostSourcePresetCommand {
  const v = row(value);
  return (
    !!v &&
    exact(v, [
      'hostId',
      'bootId',
      'protocol',
      'expectedDigest',
      'expectedPermissionEpoch',
      'preset',
    ]) &&
    target(v) &&
    isManagedSourceSelector(v['protocol']) &&
    digest(v['expectedDigest']) &&
    revision(v['expectedPermissionEpoch']) &&
    (PERMISSION_PRESETS as readonly unknown[]).includes(v['preset'])
  );
}
export function isLocalHostSourceEnabledCommand(
  value: unknown,
): value is LocalHostSourceEnabledCommand {
  const v = row(value);
  return (
    !!v &&
    exact(v, [
      'hostId',
      'bootId',
      'protocol',
      'enabled',
      'expectedControlRevision',
      'expectedConfigRevision',
      'expectedCredentialVersion',
    ]) &&
    target(v) &&
    protocol(v['protocol']) &&
    typeof v['enabled'] === 'boolean' &&
    revision(v['expectedControlRevision']) &&
    revision(v['expectedConfigRevision']) &&
    id(v['expectedCredentialVersion'])
  );
}
export function isLocalHostSecretTarget(value: unknown): value is LocalHostSecretTarget {
  const v = row(value);
  return (
    !!v &&
    exact(
      v,
      v['purpose'] === 'qq-source'
        ? [
            'hostId',
            'bootId',
            'purpose',
            'protocol',
            'expectedRevision',
            'expectedCredentialVersion',
          ]
        : ['hostId', 'bootId', 'purpose', 'expectedRevision', 'expectedCredentialVersion'],
    ) &&
    target(v) &&
    revision(v['expectedRevision']) &&
    id(v['expectedCredentialVersion']) &&
    (v['purpose'] === 'qq-source' ? protocol(v['protocol']) : v['purpose'] === 'agent-link')
  );
}
export function isLocalHostSourceReview(value: unknown): value is LocalHostSourceReview {
  const v = row(value);
  return (
    !!v &&
    exact(v, [
      'protocol',
      'digest',
      'trusted',
      'preset',
      'blocked',
      'permissionEpoch',
      'cleanup',
    ]) &&
    isManagedSourceSelector(v['protocol']) &&
    digest(v['digest']) &&
    typeof v['trusted'] === 'boolean' &&
    typeof v['blocked'] === 'boolean' &&
    revision(v['permissionEpoch']) &&
    (PERMISSION_PRESETS as readonly unknown[]).includes(v['preset']) &&
    ['settled', 'pending', 'failed'].includes(String(v['cleanup']))
  );
}
export function isLocalHostConsoleView(value: unknown): value is LocalHostConsoleView {
  const v = row(value),
    identity = v && row(v['identity']),
    agent = v && row(v['agentLink']),
    endpoint = agent && row(agent['target']);
  return (
    !!v &&
    exact(v, ['identity', 'sourcesRevision', 'sources', 'agentLink']) &&
    !!identity &&
    exact(identity, ['protocolVersion', 'packageVersion', 'hostId', 'bootId']) &&
    identity['protocolVersion'] === LOCAL_HOST_PROTOCOL_VERSION &&
    id(identity['packageVersion']) &&
    target(identity) &&
    revision(v['sourcesRevision']) &&
    Array.isArray(v['sources']) &&
    v['sources'].length === 2 &&
    v['sources'].every(isQQSourceView) &&
    new Set(v['sources'].map((s) => s.protocol)).size === 2 &&
    !!agent &&
    exact(agent, [
      'revision',
      'target',
      'credentialVersion',
      'hasCredential',
      'phase',
      'sessionId',
      'error',
    ]) &&
    revision(agent['revision']) &&
    id(agent['credentialVersion']) &&
    typeof agent['hasCredential'] === 'boolean' &&
    ['disabled', 'offline', 'connecting', 'connected', 'retiring', 'failed'].includes(
      String(agent['phase']),
    ) &&
    (agent['sessionId'] === null || id(agent['sessionId'])) &&
    error(agent['error']) &&
    !!endpoint &&
    exact(endpoint, ['baseUrl', 'agentId', 'agentEpoch']) &&
    typeof endpoint['baseUrl'] === 'string' &&
    endpoint['baseUrl'].length <= 2048 &&
    typeof endpoint['agentId'] === 'string' &&
    endpoint['agentId'].length <= 200 &&
    typeof endpoint['agentEpoch'] === 'string' &&
    endpoint['agentEpoch'].length <= 200
  );
}
export function isLocalHostSourceSettingsCommand(
  value: unknown,
): value is LocalHostSourceSettingsCommand {
  const v = row(value);
  return (
    !!v &&
    exact(v, ['hostId', 'bootId', 'protocol', 'expectedRevision', 'settings']) &&
    target(v) &&
    isQQSourceSettingsCommand({
      protocol: v['protocol'],
      expectedRevision: v['expectedRevision'],
      settings: v['settings'],
    })
  );
}
export function isLocalHostAgentSettingsCommand(
  value: unknown,
): value is LocalHostAgentSettingsCommand {
  const v = row(value);
  return (
    !!v &&
    exact(v, ['hostId', 'bootId', 'expectedRevision', 'baseUrl', 'agentId', 'agentEpoch']) &&
    target(v) &&
    revision(v['expectedRevision']) &&
    typeof v['baseUrl'] === 'string' &&
    v['baseUrl'].length <= 2048 &&
    typeof v['agentId'] === 'string' &&
    v['agentId'].length <= 200 &&
    typeof v['agentEpoch'] === 'string' &&
    v['agentEpoch'].length <= 200
  );
}
export function isLocalHostAgentEnabledCommand(
  value: unknown,
): value is LocalHostAgentEnabledCommand {
  const v = row(value);
  return (
    !!v &&
    exact(v, ['hostId', 'bootId', 'expectedRevision', 'expectedCredentialVersion', 'enabled']) &&
    target(v) &&
    revision(v['expectedRevision']) &&
    id(v['expectedCredentialVersion']) &&
    typeof v['enabled'] === 'boolean'
  );
}
export function isLocalHostConsoleMutation(value: unknown): value is LocalHostConsoleMutation {
  const v = row(value);
  return (
    !!v && exact(v, ['view', 'error']) && isLocalHostConsoleView(v['view']) && error(v['error'])
  );
}
