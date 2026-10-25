/**
 * Plugin manifest (Schema version 1) — types plus the frozen JSON Schema data.
 *
 * The root entry exports only the Schema *data*; compiling and running it is
 * the job of `@pet/contracts/validation`. Source, trust and the protected flag
 * are assigned by the host and therefore cannot be declared here.
 */

import type { JsonObject, JsonSchema } from './json.js';
import type { CapabilityId, LocalId, PluginId } from './ids.js';
import type { PermissionDeclaration } from './permission.js';
import type { ContributionDeclaration } from './contribution.js';
import type { ResourceDeclaration } from './resource.js';
import { BCP47_LANGUAGE_PATTERN, LOCAL_ID_PATTERN } from './patterns.js';
import {
  CAPABILITY_ID_SCHEMA,
  JSON_OBJECT_SCHEMA,
  LOCAL_ID_SCHEMA,
  PLUGIN_ID_SCHEMA,
  RELATIVE_PATH_SCHEMA,
  SEMVER_RANGE_STRING_SCHEMA,
  SEMVER_STRING_SCHEMA,
} from './shared-schemas.js';

export const MANIFEST_SCHEMA_VERSION = 1 as const;

export const MANIFEST_MAX_DISPLAY_LOCALES = 8;
export const MANIFEST_MAX_PLATFORMS = 8;
export const MANIFEST_MAX_PROVIDES = 32;
export const MANIFEST_MAX_CONSUMES = 32;
export const MANIFEST_MAX_CONTRIBUTES = 64;
export const MANIFEST_MAX_PERMISSIONS = 64;
export const MANIFEST_MAX_RESOURCES = 64;
export const MANIFEST_MAX_LICENSE_LENGTH = 128;
export const MANIFEST_MAX_DISPLAY_NAME_LENGTH = 128;
export const MANIFEST_MAX_DESCRIPTION_LENGTH = 1024;

export const PLATFORM_TARGETS = [
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
] as const;

export type PlatformTarget = (typeof PLATFORM_TARGETS)[number];

export const CONFIG_APPLY_MODES = ['immediate', 'reload', 'restart'] as const;

export type ConfigApplyMode = (typeof CONFIG_APPLY_MODES)[number];

/** Localized text dictionary; the UI renders the value as plain text only. */
export type LocalizedText = Record<string, string>;

/** Package-relative POSIX path. Lexical check only — the host still resolves real paths. */
export type RelativePath = string;

export interface PluginEntries {
  runtime: RelativePath;
  ui?: RelativePath;
  workers?: Record<LocalId, RelativePath>;
}

export interface ProviderDeclaration {
  id: LocalId;
  capability: CapabilityId;
  features?: JsonObject;
}

export interface ConsumptionDeclaration {
  capability: CapabilityId;
  optional: boolean;
  features?: JsonObject;
}

export interface PluginConfigDeclaration {
  version: number;
  schema: JsonObject;
  apply?: Record<string, ConfigApplyMode>;
}

export interface PluginManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  id: PluginId;
  version: string;
  displayName: LocalizedText;
  description: LocalizedText;
  license: string;
  host: string;
  platforms: PlatformTarget[];
  entries: PluginEntries;
  provides?: ProviderDeclaration[];
  consumes?: ConsumptionDeclaration[];
  contributes?: ContributionDeclaration[];
  config?: PluginConfigDeclaration;
  permissions?: PermissionDeclaration[];
  resources?: ResourceDeclaration[];
}

const localizedTextSchema = (maxLength: number): JsonSchema => ({
  type: 'object',
  minProperties: 1,
  maxProperties: MANIFEST_MAX_DISPLAY_LOCALES,
  additionalProperties: false,
  propertyNames: { type: 'string', pattern: BCP47_LANGUAGE_PATTERN },
  patternProperties: {
    [BCP47_LANGUAGE_PATTERN]: { type: 'string', minLength: 1, maxLength },
  },
});

export const PLUGIN_MANIFEST_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'version',
    'displayName',
    'description',
    'license',
    'host',
    'platforms',
    'entries',
  ],
  properties: {
    schemaVersion: { const: MANIFEST_SCHEMA_VERSION },
    id: PLUGIN_ID_SCHEMA,
    version: SEMVER_STRING_SCHEMA,
    displayName: localizedTextSchema(MANIFEST_MAX_DISPLAY_NAME_LENGTH),
    description: localizedTextSchema(MANIFEST_MAX_DESCRIPTION_LENGTH),
    license: { type: 'string', minLength: 1, maxLength: MANIFEST_MAX_LICENSE_LENGTH },
    host: SEMVER_RANGE_STRING_SCHEMA,
    platforms: {
      type: 'array',
      minItems: 1,
      maxItems: MANIFEST_MAX_PLATFORMS,
      uniqueItems: true,
      items: { enum: [...PLATFORM_TARGETS] },
    },
    entries: {
      type: 'object',
      additionalProperties: false,
      required: ['runtime'],
      properties: {
        runtime: RELATIVE_PATH_SCHEMA,
        ui: RELATIVE_PATH_SCHEMA,
        workers: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          propertyNames: LOCAL_ID_SCHEMA,
          patternProperties: { [LOCAL_ID_PATTERN]: RELATIVE_PATH_SCHEMA },
        },
      },
    },
    provides: {
      type: 'array',
      maxItems: MANIFEST_MAX_PROVIDES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'capability'],
        properties: {
          id: LOCAL_ID_SCHEMA,
          capability: CAPABILITY_ID_SCHEMA,
          features: JSON_OBJECT_SCHEMA,
        },
      },
    },
    consumes: {
      type: 'array',
      maxItems: MANIFEST_MAX_CONSUMES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['capability', 'optional'],
        properties: {
          capability: CAPABILITY_ID_SCHEMA,
          optional: { type: 'boolean' },
          features: JSON_OBJECT_SCHEMA,
        },
      },
    },
    config: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'schema'],
      properties: {
        version: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        schema: JSON_OBJECT_SCHEMA,
        apply: {
          type: 'object',
          maxProperties: 256,
          additionalProperties: false,
          propertyNames: LOCAL_ID_SCHEMA,
          patternProperties: {
            [LOCAL_ID_PATTERN]: { enum: [...CONFIG_APPLY_MODES] },
          },
        },
      },
    },
    permissions: {
      type: 'array',
      maxItems: MANIFEST_MAX_PERMISSIONS,
      items: { $ref: 'urn:pet:contracts:v1#/$defs/permission' },
    },
    resources: {
      type: 'array',
      maxItems: MANIFEST_MAX_RESOURCES,
      items: { $ref: 'urn:pet:contracts:v1#/$defs/resource' },
    },
    contributes: {
      type: 'array',
      maxItems: MANIFEST_MAX_CONTRIBUTES,
      items: { $ref: 'urn:pet:contracts:v1#/$defs/contribution' },
    },
  },
};

/** Absolute JSON Schema dialect identifier used for every compiled contract Schema. */
export const CONTRACT_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Shared `$defs` object id that lets Schemas cross-reference each other. */
export const CONTRACT_SCHEMA_DEFS_ID = 'urn:pet:contracts:v1';
