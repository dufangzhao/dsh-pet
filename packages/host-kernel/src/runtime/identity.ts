import type { OwnerRef, JsonValue } from '@pet/contracts';
export interface InstanceIdentity {
  readonly pluginId: string;
  readonly instanceId: string;
}
export function instanceKey(value: InstanceIdentity): string {
  return JSON.stringify([value.pluginId, value.instanceId]);
}
export function sameOwner(a: OwnerRef, b: OwnerRef): boolean {
  return (
    a.pluginId === b.pluginId && a.instanceId === b.instanceId && a.generation === b.generation
  );
}
export function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
export function featureSubset(
  required: JsonValue | undefined,
  available: JsonValue | undefined,
): boolean {
  if (required === undefined) return true;
  if (required === null || typeof required !== 'object') return required === available;
  if (Array.isArray(required))
    return (
      Array.isArray(available) &&
      required.length === available.length &&
      required.every((v, i) => featureSubset(v, available[i]))
    );
  if (!available || typeof available !== 'object' || Array.isArray(available)) return false;
  return Object.entries(required).every(
    ([k, v]) => Object.hasOwn(available, k) && featureSubset(v, available[k]),
  );
}
