import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  JSON_MAX_BYTES,
  MEDIA_MAX_CHUNK_BYTES,
  makeError,
  type Result,
} from '@pet/contracts';

/** Native transfer budgets, separate from canonical JSON and ordinary OneBot control frames. */
export const SNOW_UPLOAD_CHUNK_BYTES = 32 * 1024;
export const SNOW_DOWNLOAD_REQUEST_CHUNK_BYTES = 16 * 1024;
export const SNOW_MEDIA_FRAME_MAX_BYTES = Math.ceil(MEDIA_MAX_CHUNK_BYTES / 3) * 4 + 8192;
/** Bounds variable HTTP-backed download chunks even when the gateway does not rechunk them. */
export const SNOW_MEDIA_MAX_CHUNKS = 32_768;
export const SNOW_MEDIA_ECHO_PREFIX = 'qq-media:';
export const SNOW_STAGING_RETENTION_MS = 5 * 60 * 1000;
export type SnowDownloadAction =
  'download_file_stream' | 'download_file_image_stream' | 'download_file_record_stream';
export type SnowMediaRequest =
  | {
      readonly action: 'upload_file_stream';
      readonly echo: string;
      readonly params: {
        readonly stream_id: string;
        readonly filename: string;
        readonly total_chunks: number;
        readonly file_size: number;
        readonly expected_sha256: string;
        readonly file_retention: number;
        readonly is_complete?: true;
      };
      /** Raw bytes stay private until the host serializes this single bounded native frame. */
      readonly chunk?: { readonly index: number; readonly bytes: Uint8Array };
    }
  | {
      readonly action: SnowDownloadAction;
      readonly echo: string;
      readonly params: {
        readonly file?: string;
        readonly file_id?: string;
        readonly chunk_size: number;
      };
    };
export type SnowUploadReply =
  | {
      readonly kind: 'upload-progress';
      readonly stream_id: string;
      readonly status: 'file_created' | 'chunk_received';
      readonly received_chunks: number;
      readonly total_chunks: number;
    }
  | {
      readonly kind: 'upload-complete';
      readonly stream_id: string;
      readonly file_path: string;
      readonly file_name: string;
      readonly file_size: number;
      readonly sha256: string;
      readonly received_chunks: number;
      readonly total_chunks: number;
    }
  | { readonly kind: 'rejected'; readonly retcode: number };
export type SnowDownloadReply =
  | {
      readonly kind: 'download-info';
      readonly file_name: string;
      readonly file_size: number;
      readonly chunk_size: number;
    }
  | { readonly kind: 'download-chunk'; readonly index: number; readonly bytes: Uint8Array }
  | {
      readonly kind: 'download-complete';
      readonly file_name: string;
      readonly total_chunks: number;
      readonly total_bytes: number;
    }
  | { readonly kind: 'rejected'; readonly retcode: number };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== 'string' ||
    (!empty && !value.length) ||
    value.length > max ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new Error();
  return value;
}
function int(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error();
  return value;
}
function streamId(value: unknown): string {
  const id = text(value, 128);
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error();
  return id;
}
function digest(value: unknown): string {
  const hash = text(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error();
  return hash;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error();
}
export function parseSnowMediaEcho(value: unknown): { nonce: string; sequence: number } | null {
  if (typeof value !== 'string' || value.length > 128) return null;
  const match =
    /^qq-media:([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([1-9]\d*)$/u.exec(
      value,
    );
  if (!match?.[1] || !match[2]) return null;
  const sequence = Number(match[2]);
  return Number.isSafeInteger(sequence) ? { nonce: match[1], sequence } : null;
}
/** Host-only serialization of the finite transfer action set, not a generic raw-action API. */
export function encodeSnowMediaRequest(input: SnowMediaRequest): Result<string> {
  try {
    const root = record(input);
    exact(root, ['action', 'echo', 'params', 'chunk']);
    const echo = text(input.echo, 128);
    if (!parseSnowMediaEcho(echo)) throw new Error();
    const raw = record(input.params);
    let params: Record<string, string | number | boolean>;
    if (input.action === 'upload_file_stream') {
      exact(raw, [
        'stream_id',
        'filename',
        'total_chunks',
        'file_size',
        'expected_sha256',
        'file_retention',
        'is_complete',
      ]);
      const size = int(raw['file_size'], 0, COMPANION_MATERIAL_FILE_MAX_BYTES);
      const count = int(raw['total_chunks'], 1, SNOW_MEDIA_MAX_CHUNKS);
      if (count !== Math.max(1, Math.ceil(size / SNOW_UPLOAD_CHUNK_BYTES))) throw new Error();
      params = {
        stream_id: streamId(raw['stream_id']),
        filename: text(raw['filename'], 240),
        total_chunks: count,
        file_size: size,
        expected_sha256: digest(raw['expected_sha256']),
        file_retention: int(raw['file_retention'], 1, SNOW_STAGING_RETENTION_MS),
      };
      if (raw['is_complete'] === true) {
        if (input.chunk !== undefined) throw new Error();
        params['is_complete'] = true;
      } else {
        if (raw['is_complete'] !== undefined || !input.chunk) throw new Error();
        exact(record(input.chunk), ['index', 'bytes']);
        const index = int(input.chunk.index, 0, count - 1);
        const bytes = input.chunk.bytes;
        const expected = Math.min(SNOW_UPLOAD_CHUNK_BYTES, size - index * SNOW_UPLOAD_CHUNK_BYTES);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected) throw new Error();
        params['chunk_index'] = index;
        params['chunk_data'] = Buffer.from(bytes).toString('base64');
      }
    } else if (
      [
        'download_file_stream',
        'download_file_image_stream',
        'download_file_record_stream',
      ].includes(input.action)
    ) {
      if (root['chunk'] !== undefined) throw new Error();
      exact(raw, ['file', 'file_id', 'chunk_size']);
      if ((raw['file'] === undefined) === (raw['file_id'] === undefined)) throw new Error();
      params = { chunk_size: int(raw['chunk_size'], 1, SNOW_DOWNLOAD_REQUEST_CHUNK_BYTES) };
      if (raw['file'] !== undefined) params['file'] = text(raw['file'], 8192);
      else params['file_id'] = text(raw['file_id'], 8192);
    } else throw new Error();
    const serialized = JSON.stringify({ action: input.action, params, echo });
    if (Buffer.byteLength(serialized) > JSON_MAX_BYTES)
      return { ok: false, error: makeError('quota-exceeded', false) };
    return { ok: true, value: serialized };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}
function envelope(
  input: string,
  expectedEcho: string,
): { data: Record<string, unknown> } | { retcode: number } {
  if (typeof input !== 'string' || Buffer.byteLength(input) > SNOW_MEDIA_FRAME_MAX_BYTES)
    throw new Error();
  const root = record(JSON.parse(input) as unknown);
  if (root['post_type'] !== undefined || root['echo'] !== expectedEcho) throw new Error();
  const code = int(root['retcode'], Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (root['status'] === 'failed' && code !== 0 && code !== 1) return { retcode: code };
  if (root['status'] !== 'ok' || code !== 0 || root['stream'] !== 'stream-action')
    throw new Error();
  return { data: record(root['data']) };
}
export function decodeSnowUploadReply(
  input: string,
  expectedEcho: string,
): Result<SnowUploadReply> {
  try {
    const value = envelope(input, expectedEcho);
    if ('retcode' in value)
      return { ok: true, value: { kind: 'rejected', retcode: value.retcode } };
    const d = value.data;
    const id = streamId(d['stream_id']);
    const count = int(d['total_chunks'], 1, SNOW_MEDIA_MAX_CHUNKS);
    const received = int(d['received_chunks'], 0, count);
    if (
      d['type'] === 'stream' &&
      (d['status'] === 'file_created' || d['status'] === 'chunk_received')
    )
      return {
        ok: true,
        value: {
          kind: 'upload-progress',
          stream_id: id,
          status: d['status'],
          received_chunks: received,
          total_chunks: count,
        },
      };
    if (d['type'] !== 'response' || d['status'] !== 'file_complete' || received !== count)
      throw new Error();
    return {
      ok: true,
      value: {
        kind: 'upload-complete',
        stream_id: id,
        received_chunks: received,
        total_chunks: count,
        file_path: text(d['file_path'], 8192),
        file_name: text(d['file_name'], 1024),
        file_size: int(d['file_size'], 0, COMPANION_MATERIAL_FILE_MAX_BYTES),
        sha256: digest(d['sha256']),
      },
    };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}
export function decodeSnowDownloadReply(
  input: string,
  expectedEcho: string,
): Result<SnowDownloadReply> {
  try {
    const value = envelope(input, expectedEcho);
    if ('retcode' in value)
      return { ok: true, value: { kind: 'rejected', retcode: value.retcode } };
    const d = value.data;
    if (d['type'] === 'stream' && d['data_type'] === 'file_info')
      return {
        ok: true,
        value: {
          kind: 'download-info',
          file_name: text(d['file_name'], 1024),
          file_size: int(d['file_size'], 0, COMPANION_MATERIAL_FILE_MAX_BYTES),
          chunk_size: int(d['chunk_size'], 1, 16 * 1024 * 1024),
        },
      };
    if (d['type'] === 'response' && d['data_type'] === 'file_complete')
      return {
        ok: true,
        value: {
          kind: 'download-complete',
          file_name: text(d['file_name'], 1024),
          total_chunks: int(d['total_chunks'], 0, SNOW_MEDIA_MAX_CHUNKS),
          total_bytes: int(d['total_bytes'], 0, COMPANION_MATERIAL_FILE_MAX_BYTES),
        },
      };
    if (d['type'] !== 'stream' || d['data_type'] !== 'file_chunk') throw new Error();
    const index = int(d['index'], 0, SNOW_MEDIA_MAX_CHUNKS - 1);
    const size = int(d['size'], 1, MEDIA_MAX_CHUNK_BYTES);
    const encoded = text(d['data'], Math.ceil(MEDIA_MAX_CHUNK_BYTES / 3) * 4);
    if (
      int(d['base64_size'], 1, Math.ceil(MEDIA_MAX_CHUNK_BYTES / 3) * 4) !== encoded.length ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
    )
      throw new Error();
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.byteLength !== size || bytes.toString('base64') !== encoded) throw new Error();
    return { ok: true, value: { kind: 'download-chunk', index, bytes } };
  } catch {
    return { ok: false, error: makeError('invalid-input', false) };
  }
}
