/**
 * Permission declarations — *requests* only. A declaration is never an
 * authorization; the host records grant/approval separately.
 */

import type { CapabilityId, LocalId } from './ids.js';
import type { JsonSchema } from './json.js';
import { CAPABILITY_ID_PATTERN, HTTPS_ORIGIN_PATTERN, LOCAL_ID_PATTERN } from './patterns.js';

export const PERMISSION_KINDS = [
  'capability-use',
  'microphone',
  'screen-capture',
  'text-input',
  'network',
  'credentials',
  'files',
  'process',
  'clipboard',
] as const;

export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export const FILE_SCOPES = ['plugin-data', 'resources', 'user-selected'] as const;

export type FileScope = (typeof FILE_SCOPES)[number];

export const ACCESS_MODES = ['read', 'write', 'read-write'] as const;

export type AccessMode = (typeof ACCESS_MODES)[number];

/** Canonical HTTPS origin, e.g. `https://api.example.com`. */
export type HttpsOrigin = string;

export interface CapabilityUsePermission {
  kind: 'capability-use';
  capability: CapabilityId;
}

export interface MicrophonePermission {
  kind: 'microphone';
}

export interface ScreenCapturePermission {
  kind: 'screen-capture';
}

export interface TextInputPermission {
  kind: 'text-input';
}

export interface NetworkPermission {
  kind: 'network';
  origins: HttpsOrigin[];
}

export interface CredentialsPermission {
  kind: 'credentials';
  keys: LocalId[];
}

export interface FilesPermission {
  kind: 'files';
  scope: FileScope;
  access: AccessMode;
}

export interface ProcessPermission {
  kind: 'process';
  workers: LocalId[];
}

export interface ClipboardPermission {
  kind: 'clipboard';
  access: AccessMode;
}

export type PermissionDeclaration =
  | CapabilityUsePermission
  | MicrophonePermission
  | ScreenCapturePermission
  | TextInputPermission
  | NetworkPermission
  | CredentialsPermission
  | FilesPermission
  | ProcessPermission
  | ClipboardPermission;

const noProperties = { type: 'object', additionalProperties: false };

/** Each variant requires its own discriminator plus every field of that shape. */
const variant = (kind: PermissionKind, properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: ['kind', ...Object.keys(properties)],
  properties: { kind: { const: kind }, ...properties },
});

export const NETWORK_PERMISSION_MAX_ORIGINS = 16;
export const CREDENTIALS_PERMISSION_MAX_KEYS = 16;
export const PROCESS_PERMISSION_MAX_WORKERS = 16;

export const PERMISSION_DECLARATION_SCHEMA: JsonSchema = {
  oneOf: [
    variant('capability-use', {
      capability: { type: 'string', pattern: CAPABILITY_ID_PATTERN },
    }),
    { ...noProperties, required: ['kind'], properties: { kind: { const: 'microphone' } } },
    { ...noProperties, required: ['kind'], properties: { kind: { const: 'screen-capture' } } },
    { ...noProperties, required: ['kind'], properties: { kind: { const: 'text-input' } } },
    variant('network', {
      origins: {
        type: 'array',
        minItems: 1,
        maxItems: NETWORK_PERMISSION_MAX_ORIGINS,
        uniqueItems: true,
        items: { type: 'string', maxLength: 255, pattern: HTTPS_ORIGIN_PATTERN },
      },
    }),
    variant('credentials', {
      keys: {
        type: 'array',
        minItems: 1,
        maxItems: CREDENTIALS_PERMISSION_MAX_KEYS,
        uniqueItems: true,
        items: { type: 'string', pattern: LOCAL_ID_PATTERN },
      },
    }),
    variant('files', {
      scope: { enum: [...FILE_SCOPES] },
      access: { enum: [...ACCESS_MODES] },
    }),
    variant('process', {
      workers: {
        type: 'array',
        minItems: 1,
        maxItems: PROCESS_PERMISSION_MAX_WORKERS,
        uniqueItems: true,
        items: { type: 'string', pattern: LOCAL_ID_PATTERN },
      },
    }),
    variant('clipboard', { access: { enum: [...ACCESS_MODES] } }),
  ],
};
