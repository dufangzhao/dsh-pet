import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  JSON_MAX_BYTES,
  makeError,
  type JsonObject,
  type Result,
} from '@pet/contracts';
import type { OfficialHttpResponse } from './ports.js';

/** Native upload metadata, never an actor grant or a public artifact locator. */
export interface OfficialMediaRoute {
  readonly scene: 'c2c' | 'group';
  readonly targetId: string;
}
export interface OfficialMediaMetadata extends OfficialMediaRoute {
  readonly file_type: 1 | 3 | 4;
  readonly file_name: string;
  readonly sizeBytes: number;
}
export interface OfficialMediaHashes {
  readonly md5: string;
  readonly sha1: string;
  readonly md5_10m: string;
  readonly sha256: string;
}
export interface OfficialPreparedPart {
  readonly index: number;
  readonly offset: number;
  readonly byteLength: number;
}
export interface OfficialPreparedUpload {
  readonly upload_id: string;
  readonly block_size: number;
  readonly parts: readonly OfficialPreparedPart[];
}
/** Host decoder only: these URLs must be registered and projected away before returning to a driver. */
export interface OfficialPreparedWithUrls extends Omit<OfficialPreparedUpload, 'parts'> {
  readonly parts: readonly (OfficialPreparedPart & { readonly presigned_url: string })[];
}
export const OFFICIAL_INLINE_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const OFFICIAL_PREFIX_HASH_BYTES = 10_002_432;
export const OFFICIAL_MEDIA_MAX_PARTS = 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error();
  return value;
}
function unsigned(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'string' && /^(0|[1-9]\d*)$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error();
  return parsed;
}
export function validOfficialMediaMetadata(value: unknown): value is OfficialMediaMetadata {
  try {
    const raw = object(value);
    if (
      Object.keys(raw).some(
        (key) => !['scene', 'targetId', 'file_type', 'file_name', 'sizeBytes'].includes(key),
      )
    )
      return false;
    if (raw['scene'] !== 'c2c' && raw['scene'] !== 'group') return false;
    if (![1, 3, 4].includes(Number(raw['file_type'])) || typeof raw['file_type'] !== 'number')
      return false;
    const target = text(raw['targetId'], 256);
    if (!/^[!-~]+$/u.test(target)) return false;
    text(raw['file_name'], 240);
    if (typeof raw['sizeBytes'] !== 'number') return false;
    unsigned(raw['sizeBytes'], 0, COMPANION_MATERIAL_FILE_MAX_BYTES);
    return true;
  } catch {
    return false;
  }
}
export function officialMediaPath(
  route: OfficialMediaRoute,
  operation: 'files' | 'upload_prepare' | 'upload_part_finish',
): string {
  if (
    (route.scene !== 'c2c' && route.scene !== 'group') ||
    !/^[!-~]{1,256}$/u.test(route.targetId) ||
    !['files', 'upload_prepare', 'upload_part_finish'].includes(operation)
  )
    throw new Error('invalid official media route');
  return `/v2/${route.scene === 'c2c' ? 'users' : 'groups'}/${encodeURIComponent(route.targetId)}/${operation}`;
}
export function officialPrepareBody(
  metadata: OfficialMediaMetadata,
  hashes: OfficialMediaHashes,
): Result<JsonObject> {
  if (
    !validOfficialMediaMetadata(metadata) ||
    !/^[a-f0-9]{32}$/u.test(hashes.md5) ||
    !/^[a-f0-9]{40}$/u.test(hashes.sha1) ||
    !/^[a-f0-9]{32}$/u.test(hashes.md5_10m) ||
    !/^[a-f0-9]{64}$/u.test(hashes.sha256)
  )
    return { ok: false, error: makeError('invalid-input', false) };
  return {
    ok: true,
    value: {
      file_type: metadata.file_type,
      file_name: metadata.file_name,
      file_size: String(metadata.sizeBytes),
      md5: hashes.md5,
      sha1: hashes.sha1,
      md5_10m: hashes.md5_10m,
    },
  };
}
/** No assumed one-based indices, missing-part repair, or synthetic upload identifiers. */
export function decodeOfficialPrepared(
  response: OfficialHttpResponse,
  sizeBytes: number,
): Result<OfficialPreparedWithUrls> {
  try {
    unsigned(sizeBytes, 1, COMPANION_MATERIAL_FILE_MAX_BYTES);
    if (response.status !== 200 || Buffer.byteLength(response.body) > JSON_MAX_BYTES)
      throw new Error();
    const raw = object(JSON.parse(response.body) as unknown);
    if (
      (raw['code'] !== undefined && raw['code'] !== 0) ||
      (raw['biz_code'] !== undefined && raw['biz_code'] !== 0)
    )
      throw new Error();
    const uploadId = text(raw['upload_id'], 512);
    const block = unsigned(raw['block_size'], 1, COMPANION_MATERIAL_FILE_MAX_BYTES);
    const count = Math.ceil(sizeBytes / block);
    if (
      !Array.isArray(raw['parts']) ||
      raw['parts'].length !== count ||
      count > OFFICIAL_MEDIA_MAX_PARTS
    )
      throw new Error();
    const parts = raw['parts']
      .map((value): OfficialPreparedPart & { readonly presigned_url: string } => {
        const part = object(value);
        const index = unsigned(part['index'], 0, count - 1);
        const offset = index * block;
        const length = Math.min(block, sizeBytes - offset);
        if (unsigned(part['block_size'], 1, block) !== length) throw new Error();
        const reference = text(part['presigned_url'], 8192);
        const parsed = new URL(reference);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash)
          throw new Error();
        return { index, offset, byteLength: length, presigned_url: reference };
      })
      .sort((a, b) => a.index - b.index);
    if (parts.some((part, index) => part.index !== index)) throw new Error();
    return { ok: true, value: { upload_id: uploadId, block_size: block, parts } };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}
/** Safe plan validation at the driver seam; URLs and arbitrary extra fields are rejected. */
export function isOfficialPreparedPlan(
  value: unknown,
  sizeBytes: number,
): value is OfficialPreparedUpload {
  try {
    const raw = object(value);
    if (
      Object.keys(raw).length !== 3 ||
      !['upload_id', 'block_size', 'parts'].every((key) => Object.hasOwn(raw, key))
    )
      return false;
    text(raw['upload_id'], 512);
    unsigned(sizeBytes, 1, COMPANION_MATERIAL_FILE_MAX_BYTES);
    if (typeof raw['block_size'] !== 'number') return false;
    const block = unsigned(raw['block_size'], 1, COMPANION_MATERIAL_FILE_MAX_BYTES);
    const count = Math.ceil(sizeBytes / block);
    if (
      !Array.isArray(raw['parts']) ||
      count > OFFICIAL_MEDIA_MAX_PARTS ||
      raw['parts'].length !== count
    )
      return false;
    return raw['parts'].every((item, index) => {
      const part = object(item);
      const offset = index * block;
      return (
        Object.keys(part).length === 3 &&
        ['index', 'offset', 'byteLength'].every((key) => Object.hasOwn(part, key)) &&
        part['index'] === index &&
        part['offset'] === offset &&
        part['byteLength'] === Math.min(block, sizeBytes - offset)
      );
    });
  } catch {
    return false;
  }
}
/** upload_part_finish's documented success is an empty object, not a media/send receipt. */
export function isOfficialPartFinished(response: OfficialHttpResponse): boolean {
  if (response.status !== 200 || Buffer.byteLength(response.body) > JSON_MAX_BYTES) return false;
  try {
    const raw = object(JSON.parse(response.body) as unknown);
    return (
      Object.keys(raw).length === 0 ||
      Object.keys(raw).every((key) => ['code', 'biz_code'].includes(key) && raw[key] === 0)
    );
  } catch {
    return false;
  }
}
