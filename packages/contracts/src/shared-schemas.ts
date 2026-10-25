/**
 * Schema fragments shared by more than one contract document.
 *
 * They live in their own module so that `manifest`, `control` and `media` can
 * reference the same definitions without importing each other.
 */

import type { JsonSchema } from './json.js';
import {
  CAPABILITY_ID_PATTERN,
  ERROR_MESSAGE_KEY_PATTERN,
  HTTPS_ORIGIN_PATTERN,
  HTTPS_URL_PATTERN,
  LOCAL_ID_PATTERN,
  PLUGIN_ID_PATTERN,
  RELATIVE_PATH_PATTERN,
  SEMVER_PATTERN,
  SEMVER_RANGE_PATTERN,
  SHA256_HEX_PATTERN,
} from './patterns.js';
import { KERNEL_ERROR_CODES } from './errors.js';

export const PLUGIN_ID_SCHEMA: JsonSchema = {
  type: 'string',
  maxLength: 128,
  pattern: PLUGIN_ID_PATTERN,
};

export const LOCAL_ID_SCHEMA: JsonSchema = {
  type: 'string',
  maxLength: 128,
  pattern: LOCAL_ID_PATTERN,
};

export const CAPABILITY_ID_SCHEMA: JsonSchema = {
  type: 'string',
  maxLength: 128,
  pattern: CAPABILITY_ID_PATTERN,
};

export const RELATIVE_PATH_SCHEMA: JsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 240,
  pattern: RELATIVE_PATH_PATTERN,
};

export const HTTPS_ORIGIN_SCHEMA: JsonSchema = {
  type: 'string',
  maxLength: 255,
  pattern: HTTPS_ORIGIN_PATTERN,
};

export const HTTPS_URL_SCHEMA: JsonSchema = {
  type: 'string',
  maxLength: 2048,
  pattern: HTTPS_URL_PATTERN,
};

export const SHA256_HEX_SCHEMA: JsonSchema = {
  type: 'string',
  pattern: SHA256_HEX_PATTERN,
};

export const SEMVER_STRING_SCHEMA: JsonSchema = {
  type: 'string',
  maxLength: 256,
  pattern: SEMVER_PATTERN,
};

export const SEMVER_RANGE_STRING_SCHEMA: JsonSchema = {
  type: 'string',
  maxLength: 256,
  pattern: SEMVER_RANGE_PATTERN,
};

/** Any JSON object; its internal shape and budget are checked separately. */
export const JSON_OBJECT_SCHEMA: JsonSchema = { type: 'object' };

export const KERNEL_ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'messageKey', 'retryable'],
  properties: {
    code: { enum: [...KERNEL_ERROR_CODES] },
    messageKey: { type: 'string', maxLength: 64, pattern: ERROR_MESSAGE_KEY_PATTERN },
    retryable: { type: 'boolean' },
  },
};

export const OWNER_REF_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pluginId', 'instanceId', 'generation'],
  properties: {
    pluginId: PLUGIN_ID_SCHEMA,
    instanceId: LOCAL_ID_SCHEMA,
    generation: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
};

/** `Result<JsonValue>`: the success arm requires a value, the failure arm an error. */
export const RESULT_SCHEMA: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'value'],
      properties: { ok: { const: true }, value: {} },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'error'],
      properties: { ok: { const: false }, error: KERNEL_ERROR_SCHEMA },
    },
  ],
};
