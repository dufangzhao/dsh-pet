/**
 * Media transport contracts: a small JSON header per chunk plus an owned byte
 * buffer. Media never rides the JSON control channel.
 *
 * Budgets are fixed here as data so that the host and the plugin can enforce the
 * same numbers: 256 KiB per chunk, 8 chunks per stream and 2 MiB per stream.
 * There is no silent frame dropping — exceeding a budget is an error.
 */

import type { JsonSchema } from './json.js';
import type { LocalId, OwnerRef } from './ids.js';
import { LOCAL_ID_SCHEMA, OWNER_REF_SCHEMA } from './shared-schemas.js';

/** 256 KiB — the largest payload a single media chunk may carry. */
export const MEDIA_MAX_CHUNK_BYTES = 262144;

/** 8 — the maximum number of unacknowledged chunks per stream. */
export const MEDIA_MAX_CHUNKS_PER_STREAM = 8;

/** 2 MiB — the maximum total bytes buffered for one stream. */
export const MEDIA_MAX_STREAM_BYTES = 2097152;

export interface StreamHeader {
  streamId: LocalId;
  taskId: LocalId;
  owner: OwnerRef;
  sequence: number;
  byteLength: number;
}

export interface MediaFrame {
  header: StreamHeader;
  /** Owned buffer. Never an external `ArrayBuffer` borrowed from a decoder. */
  payload: Uint8Array;
}

export const STREAM_HEADER_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['streamId', 'taskId', 'owner', 'sequence', 'byteLength'],
  properties: {
    streamId: LOCAL_ID_SCHEMA,
    taskId: LOCAL_ID_SCHEMA,
    owner: OWNER_REF_SCHEMA,
    sequence: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    byteLength: { type: 'integer', minimum: 0, maximum: MEDIA_MAX_CHUNK_BYTES },
  },
};

/**
 * Byte accounting for one stream. A chunk that would exceed the byte budget is
 * refused instead of being dropped, so a producer can never report success
 * while frames silently disappear.
 */
export interface StreamBudgetState {
  chunks: number;
  bytes: number;
}

export function emptyStreamBudget(): StreamBudgetState {
  return { chunks: 0, bytes: 0 };
}

export function canAcceptChunk(state: StreamBudgetState, byteLength: number): boolean {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) return false;
  if (byteLength > MEDIA_MAX_CHUNK_BYTES) return false;
  if (state.chunks + 1 > MEDIA_MAX_CHUNKS_PER_STREAM) return false;
  return state.bytes + byteLength <= MEDIA_MAX_STREAM_BYTES;
}

/** Immutable accounting update; returns `null` when the chunk would exceed a budget. */
export function acceptChunk(
  state: StreamBudgetState,
  byteLength: number,
): StreamBudgetState | null {
  return canAcceptChunk(state, byteLength)
    ? { chunks: state.chunks + 1, bytes: state.bytes + byteLength }
    : null;
}
