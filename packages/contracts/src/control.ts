/**
 * Control-channel IPC messages.
 *
 * These Schemas prove *shape and budget only*. Identity, request de-duplication,
 * generation, sequence ordering, cancellation and destination binding are
 * re-checked by the host. Raw credentials never travel on this channel.
 */

import type { JsonSchema, JsonValue } from './json.js';
import type { LocalId, OwnerRef } from './ids.js';
import type { CancelReason } from './task.js';
import type { KernelError, Result } from './errors.js';
import { CANCEL_REASONS } from './task.js';
import { LOCAL_ID_SCHEMA, OWNER_REF_SCHEMA, RESULT_SCHEMA } from './shared-schemas.js';

export const CONTROL_PROTOCOL_VERSION = 1 as const;

export const CONTROL_MESSAGE_TYPES = [
  'request',
  'response',
  'event',
  'cancel',
  'stream-credit',
  'stream-end',
] as const;

export type ControlMessageType = (typeof CONTROL_MESSAGE_TYPES)[number];

/** 64 KiB — the control-channel message budget (matches the JSON byte budget). */
export const CONTROL_MAX_MESSAGE_BYTES = 65536;

export const CONTROL_MAX_BUDGET_MS = 86400000;

export const CONTROL_MAX_STREAM_CREDITS = 8;

export interface ControlMessageBase {
  protocol: typeof CONTROL_PROTOCOL_VERSION;
  sessionId: LocalId;
  id: LocalId;
  owner: OwnerRef;
  type: ControlMessageType;
}

export interface RequestMessage extends ControlMessageBase {
  type: 'request';
  method: LocalId;
  payload: JsonValue;
  taskId?: LocalId;
  /** null is an owner-scoped runtime.invoke; finite/default RPCs retain a deadline. */
  budgetMs?: number | null;
}

export interface ResponseMessage extends ControlMessageBase {
  type: 'response';
  replyTo: LocalId;
  result: Result<JsonValue>;
}

export interface EventMessage extends ControlMessageBase {
  type: 'event';
  topic: LocalId;
  sequence: number;
  payload: JsonValue;
  taskId?: LocalId;
}

export interface CancelMessage extends ControlMessageBase {
  type: 'cancel';
  taskId: LocalId;
  reason: CancelReason;
}

export interface StreamCreditMessage extends ControlMessageBase {
  type: 'stream-credit';
  streamId: LocalId;
  taskId: LocalId;
  credits: number;
}

export interface StreamEndMessage extends ControlMessageBase {
  type: 'stream-end';
  streamId: LocalId;
  taskId: LocalId;
  sequence: number;
  error?: KernelError;
}

export type ControlMessage =
  | RequestMessage
  | ResponseMessage
  | EventMessage
  | CancelMessage
  | StreamCreditMessage
  | StreamEndMessage;

const baseProperties: Record<string, JsonSchema> = {
  protocol: { const: CONTROL_PROTOCOL_VERSION },
  sessionId: LOCAL_ID_SCHEMA,
  id: LOCAL_ID_SCHEMA,
  owner: OWNER_REF_SCHEMA,
};

const message = (type: ControlMessageType, properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: ['protocol', 'sessionId', 'id', 'owner', 'type'],
  properties: { ...baseProperties, type: { const: type }, ...properties },
});

export const CONTROL_MESSAGE_SCHEMA: JsonSchema = {
  oneOf: [
    {
      ...message('request', {
        method: LOCAL_ID_SCHEMA,
        // Any JSON value; the 64 KiB control budget is enforced after the shape check.
        payload: {},
        taskId: LOCAL_ID_SCHEMA,
        budgetMs: { type: ['integer', 'null'], minimum: 1, maximum: CONTROL_MAX_BUDGET_MS },
      }),
      if: { required: ['budgetMs'], properties: { budgetMs: { type: 'null' } } },
      then: {
        required: ['method', 'taskId'],
        properties: { method: { const: 'runtime.invoke' }, taskId: LOCAL_ID_SCHEMA },
      },
    },
    message('response', {
      replyTo: LOCAL_ID_SCHEMA,
      result: RESULT_SCHEMA,
    }),
    message('event', {
      topic: LOCAL_ID_SCHEMA,
      sequence: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      payload: {},
      taskId: LOCAL_ID_SCHEMA,
    }),
    message('cancel', {
      taskId: LOCAL_ID_SCHEMA,
      reason: { enum: [...CANCEL_REASONS] },
    }),
    message('stream-credit', {
      streamId: LOCAL_ID_SCHEMA,
      taskId: LOCAL_ID_SCHEMA,
      credits: { type: 'integer', minimum: 1, maximum: CONTROL_MAX_STREAM_CREDITS },
    }),
    message('stream-end', {
      streamId: LOCAL_ID_SCHEMA,
      taskId: LOCAL_ID_SCHEMA,
      sequence: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      error: { $ref: 'urn:pet:contracts:v1#/$defs/kernelError' },
    }),
  ],
};
