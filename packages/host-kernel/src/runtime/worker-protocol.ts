import { createHash } from 'node:crypto';
import path from 'node:path';
import type { JsonValue, OwnerRef, PluginManifest } from '@pet/contracts';
import { jsonPreflight, validateStreamHeader } from '@pet/contracts/validation';
import type { DiscoveryRoot } from './discovery.js';
export interface WorkerBootstrap {
  version: 1;
  sessionId: string;
  owner: OwnerRef;
  roots: readonly DiscoveryRoot[];
}
export function record(value: JsonValue): Record<string, JsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
export function ownerFrom(value: unknown): OwnerRef | null {
  const parsed = validateStreamHeader({
    streamId: 'owner',
    taskId: 'owner',
    owner: value,
    sequence: 0,
    byteLength: 0,
  });
  return parsed.ok ? parsed.value.owner : null;
}
export function exactKeys(value: Record<string, JsonValue>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
export function manifestDigest(manifest: PluginManifest): string {
  const safe = jsonPreflight(manifest);
  if (!safe.ok) throw new Error('Invalid manifest');
  const canonical = (value: JsonValue): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]!))
        .join(',') +
      '}'
    );
  };
  return createHash('sha256').update(canonical(safe.value)).digest('hex');
}
export function parseBootstrap(value: unknown): WorkerBootstrap | null {
  const parsed = jsonPreflight(value);
  if (!parsed.ok) return null;
  const body = record(parsed.value);
  if (
    !body ||
    !exactKeys(body, ['version', 'sessionId', 'owner', 'roots']) ||
    body['version'] !== 1 ||
    typeof body['sessionId'] !== 'string' ||
    !Array.isArray(body['roots']) ||
    body['roots'].length > 8
  )
    return null;
  const owner = ownerFrom(body['owner']);
  if (!owner || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body['sessionId'])) return null;
  const roots: DiscoveryRoot[] = [];
  for (const entry of body['roots']) {
    const root = record(entry);
    if (
      !root ||
      !exactKeys(root, ['directory', 'origin']) ||
      typeof root['directory'] !== 'string' ||
      root['directory'].length > 1024 ||
      !path.isAbsolute(root['directory']) ||
      (root['origin'] !== 'builtin' && root['origin'] !== 'user')
    )
      return null;
    roots.push({ directory: path.resolve(root['directory']), origin: root['origin'] });
  }
  return { version: 1, sessionId: body['sessionId'], owner, roots };
}
