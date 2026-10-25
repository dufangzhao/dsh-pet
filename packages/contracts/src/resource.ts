/**
 * Declared downloadable resources (models, runtimes). Declaring a resource does
 * not mean the host has verified the file; the host performs size/hash checks.
 */

import type { LocalId } from './ids.js';
import type { JsonSchema } from './json.js';
import { HTTPS_URL_PATTERN, LOCAL_ID_PATTERN, SHA256_HEX_PATTERN } from './patterns.js';

export const RESOURCE_MAX_LICENSE_LENGTH = 128;

export interface ResourceDeclaration {
  id: LocalId;
  url: string;
  bytes: number;
  sha256: string;
  license: string;
  shared: boolean;
}

export const RESOURCE_DECLARATION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'url', 'bytes', 'sha256', 'license', 'shared'],
  properties: {
    id: { type: 'string', pattern: LOCAL_ID_PATTERN },
    url: { type: 'string', maxLength: 2048, pattern: HTTPS_URL_PATTERN },
    bytes: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    sha256: { type: 'string', pattern: SHA256_HEX_PATTERN },
    license: { type: 'string', minLength: 1, maxLength: RESOURCE_MAX_LICENSE_LENGTH },
    shared: { type: 'boolean' },
  },
};
