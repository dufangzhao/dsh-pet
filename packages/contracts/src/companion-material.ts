import type { KernelError } from './errors.js';
import type { JsonSchema } from './json.js';
import type { CompanionConversationAudience, CompanionCleanup } from './companion-origin.js';
import { COMPANION_MAX_TEXT } from './companion.js';
import {
  COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
  COMPANION_RECORD_ID_SCHEMA,
  COMPANION_MAX_ORIGINS,
  COMPANION_INPUT_MATERIAL_MAX,
  isCompanionConversationAudience,
  isCompanionRecordId,
} from './companion-origin.js';
import { SHA256_HEX_SCHEMA } from './shared-schemas.js';

export const COMPANION_MATERIAL_MAX_PARTS = COMPANION_INPUT_MATERIAL_MAX;
export const COMPANION_MATERIAL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const COMPANION_MATERIAL_FILE_MAX_BYTES = 32 * 1024 * 1024;
export const COMPANION_MATERIAL_INPUT_MAX_BYTES = 32 * 1024 * 1024;
export const COMPANION_MATERIAL_PREPARATION_MAX_ACTIVE = 2;
export const COMPANION_MATERIAL_STAGING_MAX_BYTES = 128 * 1024 * 1024;
export const COMPANION_FULL_TEXT_MAX_BYTES = 64 * 1024;
export const COMPANION_VOICE_ATTACHMENT_MAX_MS = 120_000;
export const COMPANION_VOICE_ATTACHMENT_MAX_SPANS = 6;
export const COMPANION_VOICE_TRANSCRIPT_MAX_UNITS = COMPANION_MAX_TEXT;
export const COMPANION_MATERIAL_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export type CompanionMaterialKind = 'image' | 'voice' | 'file' | 'text';
/** Verified canonical metadata, not a byte reader or grant. Storage locators/signed URLs stay private. */
export interface CompanionMaterialRef {
  readonly id: string;
  readonly kind: CompanionMaterialKind;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly durationMs: number | null;
  readonly audience: CompanionConversationAudience;
  readonly originInputIds: readonly string[];
}
export interface CompanionMaterialView {
  readonly id: string;
  readonly phase: 'preparing' | 'ready' | 'failed' | 'released' | 'unknown';
  readonly reference: CompanionMaterialRef | null;
  readonly cleanup: CompanionCleanup;
  readonly error: KernelError | null;
}
/** In a text-document, message.text is a visible explanation, never the complete semantic body. */
export type CompanionMessageContent =
  | { readonly kind: 'inline-text' }
  | { readonly kind: 'text-document'; readonly material: CompanionMaterialRef };
export interface CompanionMaterialSelection {
  readonly materialId: string;
  /** Assigned worker-relative input name, not a platform/gateway/host path. */
  readonly inputName: string;
}
export const COMPANION_MATERIAL_REF_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'kind',
    'name',
    'mediaType',
    'sizeBytes',
    'sha256',
    'durationMs',
    'audience',
    'originInputIds',
  ],
  properties: {
    id: COMPANION_RECORD_ID_SCHEMA,
    kind: { enum: ['image', 'voice', 'file', 'text'] },
    name: { type: 'string', minLength: 1, maxLength: 240 },
    mediaType: { type: 'string', minLength: 3, maxLength: 128 },
    sizeBytes: { type: 'integer', minimum: 0, maximum: COMPANION_MATERIAL_FILE_MAX_BYTES },
    sha256: SHA256_HEX_SCHEMA,
    durationMs: {
      anyOf: [
        { type: 'null' },
        { type: 'integer', minimum: 1, maximum: COMPANION_VOICE_ATTACHMENT_MAX_MS },
      ],
    },
    audience: COMPANION_CONVERSATION_AUDIENCE_SCHEMA,
    originInputIds: {
      type: 'array',
      maxItems: COMPANION_MAX_ORIGINS,
      uniqueItems: true,
      items: COMPANION_RECORD_ID_SCHEMA,
    },
  },
};
export const COMPANION_MESSAGE_CONTENT_SCHEMA: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'inline-text' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'material'],
      properties: { kind: { const: 'text-document' }, material: COMPANION_MATERIAL_REF_SCHEMA },
    },
  ],
};
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
}
export function isCompanionMaterialRef(value: unknown): value is CompanionMaterialRef {
  const v = record(value);
  if (
    !v ||
    !exact(v, [
      'id',
      'kind',
      'name',
      'mediaType',
      'sizeBytes',
      'sha256',
      'durationMs',
      'audience',
      'originInputIds',
    ]) ||
    !isCompanionRecordId(v['id']) ||
    typeof v['name'] !== 'string' ||
    v['name'].length < 1 ||
    v['name'].length > 240 ||
    [...v['name']].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    typeof v['mediaType'] !== 'string' ||
    v['mediaType'].length > 128 ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(v['mediaType']) ||
    typeof v['sha256'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v['sha256']) ||
    typeof v['sizeBytes'] !== 'number' ||
    !Number.isSafeInteger(v['sizeBytes']) ||
    v['sizeBytes'] < 0 ||
    !isCompanionConversationAudience(v['audience']) ||
    !Array.isArray(v['originInputIds']) ||
    v['originInputIds'].length > COMPANION_MAX_ORIGINS ||
    new Set(v['originInputIds']).size !== v['originInputIds'].length ||
    !v['originInputIds'].every(isCompanionRecordId)
  )
    return false;
  if (v['kind'] === 'voice')
    return (
      v['mediaType'].startsWith('audio/') &&
      v['sizeBytes'] > 0 &&
      v['sizeBytes'] <= COMPANION_MATERIAL_FILE_MAX_BYTES &&
      typeof v['durationMs'] === 'number' &&
      Number.isSafeInteger(v['durationMs']) &&
      v['durationMs'] > 0 &&
      v['durationMs'] <= COMPANION_VOICE_ATTACHMENT_MAX_MS
    );
  if (v['durationMs'] !== null) return false;
  if (v['kind'] === 'image')
    return (
      COMPANION_MATERIAL_IMAGE_TYPES.some((type) => type === v['mediaType']) &&
      v['sizeBytes'] > 0 &&
      v['sizeBytes'] <= COMPANION_MATERIAL_IMAGE_MAX_BYTES
    );
  if (v['kind'] === 'text')
    return (
      v['mediaType'] === 'text/plain' &&
      v['sizeBytes'] > 0 &&
      v['sizeBytes'] <= COMPANION_FULL_TEXT_MAX_BYTES
    );
  return v['kind'] === 'file' && v['sizeBytes'] <= COMPANION_MATERIAL_FILE_MAX_BYTES;
}
export function isCompanionInputMaterials(
  value: unknown,
): value is readonly CompanionMaterialRef[] {
  return (
    Array.isArray(value) &&
    value.length <= COMPANION_MATERIAL_MAX_PARTS &&
    value.every(isCompanionMaterialRef) &&
    new Set(value.map((item) => item.id)).size === value.length &&
    value.reduce((total, item) => total + item.sizeBytes, 0) <= COMPANION_MATERIAL_INPUT_MAX_BYTES
  );
}
export function isCompanionMessageContent(value: unknown): value is CompanionMessageContent {
  const v = record(value);
  return (
    !!v &&
    ((v['kind'] === 'inline-text' && exact(v, ['kind'])) ||
      (v['kind'] === 'text-document' &&
        exact(v, ['kind', 'material']) &&
        isCompanionMaterialRef(v['material']) &&
        v['material'].kind === 'text'))
  );
}
