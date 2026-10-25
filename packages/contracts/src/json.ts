/**
 * JSON value model shared by plugin manifests, IPC payloads and Schema data.
 *
 * This module is part of the browser-safe root entry: it only declares types
 * and pure constants. The executable preflight lives in
 * `@pet/contracts/validation` so importing the root never pulls a validator
 * runtime into a renderer bundle.
 */

export type JsonPrimitive = null | boolean | number | string;

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

/** A JSON Schema document is itself plain JSON data. */
export type JsonSchema = JsonObject;

/** Maximum nesting depth accepted by the JSON preflight (root value is depth 0). */
export const JSON_MAX_DEPTH = 32;

/** Maximum total own-property count accepted by the JSON preflight. */
export const JSON_MAX_KEYS = 4096;

/** Maximum UTF-8 size of the serialized JSON accepted by the preflight. */
export const JSON_MAX_BYTES = 65536;

/** Keys that must never appear in data crossing a contract boundary. */
export const JSON_DANGEROUS_KEYS = ['__proto__', 'prototype', 'constructor'] as const;

export type JsonDangerousKey = (typeof JSON_DANGEROUS_KEYS)[number];
