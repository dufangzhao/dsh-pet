import {
  CAPABILITY_ID_PATTERN,
  LOCAL_ID_PATTERN,
  HTTPS_ORIGIN_PATTERN,
  type PermissionDeclaration,
  type PermissionPreset,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
const local = new RegExp(LOCAL_ID_PATTERN),
  capability = new RegExp(CAPABILITY_ID_PATTERN),
  origin = new RegExp(HTTPS_ORIGIN_PATTERN);
export { PERMISSION_PRESETS, type PermissionPreset } from '@pet/contracts';
export function normalizePermission(input: unknown): PermissionDeclaration | null {
  const safe = jsonPreflight(input);
  if (!safe.ok || !safe.value || typeof safe.value !== 'object' || Array.isArray(safe.value))
    return null;
  const row = safe.value;
  const kind = row['kind'];
  if (typeof kind !== 'string') return null;
  const keys = (names: string[]) =>
    Object.keys(row).sort().join(',') === ['kind', ...names].sort().join(',');
  const list = (value: unknown, test: (item: string) => boolean) =>
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 16 &&
    new Set(value).size === value.length &&
    value.every((v) => typeof v === 'string' && test(v));
  switch (kind) {
    case 'microphone':
    case 'screen-capture':
    case 'text-input':
      if (!keys([])) return null;
      break;
    case 'capability-use':
      if (
        !keys(['capability']) ||
        typeof row['capability'] !== 'string' ||
        !capability.test(row['capability'])
      )
        return null;
      break;
    case 'network':
      if (
        !keys(['origins']) ||
        !list(row['origins'], (value) => {
          try {
            const url = new URL(value);
            return value.length <= 255 && origin.test(value) && url.origin === value;
          } catch {
            return false;
          }
        })
      )
        return null;
      break;
    case 'credentials':
      if (!keys(['keys']) || !list(row['keys'], (v) => local.test(v))) return null;
      break;
    case 'process':
      if (!keys(['workers']) || !list(row['workers'], (v) => local.test(v))) return null;
      break;
    case 'files':
      if (
        !keys(['scope', 'access']) ||
        !['plugin-data', 'resources', 'user-selected'].includes(String(row['scope'])) ||
        typeof row['scope'] !== 'string' ||
        !['read', 'write', 'read-write'].includes(String(row['access'])) ||
        typeof row['access'] !== 'string'
      )
        return null;
      break;
    case 'clipboard':
      if (
        !keys(['access']) ||
        typeof row['access'] !== 'string' ||
        !['read', 'write', 'read-write'].includes(row['access'])
      )
        return null;
      break;
    default:
      return null;
  }
  return row as unknown as PermissionDeclaration;
}
const access = (requested: string, declared: string) =>
  declared === 'read-write' || requested === declared;
export function permissionSubset(
  requested: PermissionDeclaration,
  declared: PermissionDeclaration,
): boolean {
  if (requested.kind !== declared.kind) return false;
  switch (requested.kind) {
    case 'network':
      return (
        declared.kind === 'network' && requested.origins.every((v) => declared.origins.includes(v))
      );
    case 'credentials':
      return (
        declared.kind === 'credentials' && requested.keys.every((v) => declared.keys.includes(v))
      );
    case 'process':
      return (
        declared.kind === 'process' && requested.workers.every((v) => declared.workers.includes(v))
      );
    case 'capability-use':
      return declared.kind === 'capability-use' && requested.capability === declared.capability;
    case 'files':
      return (
        declared.kind === 'files' &&
        requested.scope === declared.scope &&
        access(requested.access, declared.access)
      );
    case 'clipboard':
      return declared.kind === 'clipboard' && access(requested.access, declared.access);
    default:
      return true;
  }
}
export function presetDecision(
  preset: PermissionPreset,
  permission: PermissionDeclaration,
): 'allow' | 'ask' | 'deny' {
  if (preset === 'deny') return 'deny';
  if (preset === 'ask') return 'ask';
  if (permission.kind === 'network') return 'deny';
  return ['capability-use', 'microphone', 'process'].includes(permission.kind) ||
    (permission.kind === 'files' &&
      (permission.scope === 'plugin-data' ||
        (permission.scope === 'resources' && permission.access === 'read')))
    ? 'allow'
    : 'ask';
}
