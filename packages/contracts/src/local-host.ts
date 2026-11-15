import type { OwnerRef } from './ids.js';
import type { JsonSchema } from './json.js';
import { LOCAL_ID_SCHEMA, OWNER_REF_SCHEMA } from './shared-schemas.js';

export const LOCAL_HOST_PROTOCOL_VERSION = 1 as const;
export const LOCAL_HOST_BRIDGE_PLUGIN_ID = 'pet.local-host-bridge';
export const LOCAL_HOST_BRIDGE_PATH = '/api/local-host/bridge';
export const LOCAL_HOST_AUTHORITY_CHECK_MAX_MS = 5000;

/** Public identity only. A host ID is a routing assertion, never a credential. */
export interface LocalHostRuntimeIdentity {
  readonly protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
  readonly packageVersion: string;
  readonly hostId: string;
  readonly bootId: string;
}

export interface LocalHostBridgeHello extends LocalHostRuntimeIdentity {
  readonly type: 'hello';
  readonly agentId: string;
  readonly agentEpoch: string;
}

/** The server issues this transport namespace after authenticating the owner. */
export interface LocalHostBridgeWelcome {
  readonly type: 'welcome';
  readonly protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
  readonly agentId: string;
  readonly agentEpoch: string;
  readonly hostId: string;
  readonly bootId: string;
  readonly sessionId: string;
  readonly owner: OwnerRef;
}

/** Captured provenance only; server/local task authority is never derived from this JSON. */
export interface LocalHostSourceBinding {
  readonly hostId: string;
  readonly hostBootId: string;
  readonly bridgeSessionId: string;
  readonly sourceOwner: OwnerRef;
  readonly sourceConfigRevision: number;
  readonly sourcePermissionEpoch: number;
  readonly sourceCredentialVersion: string;
  readonly nativeConnectionId: string;
}

export interface LocalHostTaskReference {
  readonly owner: OwnerRef;
  readonly taskId: string;
}

export const LOCAL_HOST_SOURCE_BINDING_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'hostId',
    'hostBootId',
    'bridgeSessionId',
    'sourceOwner',
    'sourceConfigRevision',
    'sourcePermissionEpoch',
    'sourceCredentialVersion',
    'nativeConnectionId',
  ],
  properties: {
    hostId: LOCAL_ID_SCHEMA,
    hostBootId: LOCAL_ID_SCHEMA,
    bridgeSessionId: LOCAL_ID_SCHEMA,
    sourceOwner: OWNER_REF_SCHEMA,
    sourceConfigRevision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    sourcePermissionEpoch: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    sourceCredentialVersion: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[^\\u0000-\\u001f\\u007f]+$',
    },
    nativeConnectionId: LOCAL_ID_SCHEMA,
  },
};

export const LOCAL_HOST_TASK_REFERENCE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'taskId'],
  properties: { owner: OWNER_REF_SCHEMA, taskId: LOCAL_ID_SCHEMA },
};

export type LocalHostAuthorityRequest =
  | {
      readonly kind: 'delivery';
      readonly binding: LocalHostSourceBinding;
      readonly task: LocalHostTaskReference;
      readonly deliveryId: string;
      readonly partId: string;
      readonly attemptId: string;
      readonly contentHash: string;
    }
  | {
      readonly kind: 'input-material';
      readonly binding: LocalHostSourceBinding;
      readonly task: LocalHostTaskReference;
      readonly inputId: string;
      readonly materialId: string;
    };

export interface LocalHostAuthorityPermit {
  readonly validForMs: number;
}

/** Closed device purposes; never expose runtime.invoke or arbitrary HTTP. */
export const LOCAL_HOST_BRIDGE_METHODS = [
  'source.offer',
  'source.status',
  'source.withdraw',
  'input.offer',
  'material.read',
  'material.offer',
  'authority.check',
  'delivery.execute',
  'delivery.inspect',
  'delivery.report',
  'delivery.recover',
] as const;
export type LocalHostBridgeMethod = (typeof LOCAL_HOST_BRIDGE_METHODS)[number];
