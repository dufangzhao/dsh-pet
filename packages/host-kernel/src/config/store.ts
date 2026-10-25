import { types } from 'node:util';
import type { JsonObject } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import type { InstanceIdentity } from '../runtime/identity.js';
import { ownerFrom } from '../runtime/worker-protocol.js';
export interface StoredConfig extends InstanceIdentity {
  format: 1;
  schemaVersion: number;
  revision: number;
  data: JsonObject;
}
export interface ConfigStore {
  read(identity: InstanceIdentity): Promise<StoredConfig | null>;
  compareAndSet(
    identity: InstanceIdentity,
    expectedRevision: number | null,
    value: StoredConfig,
    signal?: AbortSignal,
  ): Promise<boolean>;
}
export class ConfigStoreError extends Error {
  constructor() {
    super('Configuration storage unavailable');
    this.name = 'ConfigStoreError';
  }
}
export function configIdentity(value: unknown): InstanceIdentity | null {
  const parsed = jsonPreflight(value);
  if (
    !parsed.ok ||
    !parsed.value ||
    typeof parsed.value !== 'object' ||
    Array.isArray(parsed.value) ||
    Object.keys(parsed.value).sort().join(',') !== 'instanceId,pluginId'
  )
    return null;
  const owner = ownerFrom({ ...parsed.value, generation: 1 });
  return owner ? { pluginId: owner.pluginId, instanceId: owner.instanceId } : null;
}
export function storedConfig(value: unknown, identity: InstanceIdentity): StoredConfig | null {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value))
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some((k) => typeof k !== 'string') ||
    Object.keys(descriptors).sort().join(',') !==
      'data,format,instanceId,pluginId,revision,schemaVersion' ||
    Object.values(descriptors).some((d) => !('value' in d))
  )
    return null;
  const row = value as Record<string, unknown>;
  if (
    row['format'] !== 1 ||
    row['pluginId'] !== identity.pluginId ||
    row['instanceId'] !== identity.instanceId ||
    !Number.isSafeInteger(row['schemaVersion']) ||
    (row['schemaVersion'] as number) < 1 ||
    !Number.isSafeInteger(row['revision']) ||
    (row['revision'] as number) < 1
  )
    return null;
  const data = jsonPreflight(row['data']);
  if (!data.ok || !data.value || typeof data.value !== 'object' || Array.isArray(data.value))
    return null;
  return {
    format: 1,
    ...identity,
    schemaVersion: row['schemaVersion'] as number,
    revision: row['revision'] as number,
    data: data.value as JsonObject,
  };
}
/** Test/in-memory adapter; no persistence or cross-process authority. */
export class MemoryConfigStore implements ConfigStore {
  readonly #rows = new Map<string, StoredConfig>();
  async read(identity: InstanceIdentity): Promise<StoredConfig | null> {
    const row = this.#rows.get(JSON.stringify([identity.pluginId, identity.instanceId]));
    return row ? structuredClone(row) : null;
  }
  async compareAndSet(
    identity: InstanceIdentity,
    expectedRevision: number | null,
    value: StoredConfig,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const id = configIdentity(identity),
      row = id && storedConfig(value, id);
    if (!id || !row || signal?.aborted || row.revision !== (expectedRevision ?? 0) + 1)
      throw new ConfigStoreError();
    const key = JSON.stringify([id.pluginId, id.instanceId]);
    if ((this.#rows.get(key)?.revision ?? null) !== expectedRevision) return false;
    this.#rows.set(key, structuredClone(row));
    return true;
  }
}
