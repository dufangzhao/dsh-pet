/**
 * Semantic checks that a JSON Schema cannot express.
 *
 * Every check reports a fixed code only. Input values are never echoed into an
 * error message, a log line or a `Result`.
 */

import type { JsonValue } from '../json.js';
import { utf8ByteLength } from './json-preflight.js';

export type SemanticCode =
  | 'shape'
  | 'unknown-field'
  | 'duplicate-id'
  | 'duplicate-capability'
  | 'duplicate-origin'
  | 'unknown-command'
  | 'unknown-worker'
  | 'invalid-version'
  | 'invalid-range'
  | 'unsupported-platform'
  | 'incompatible-host'
  | 'prerelease-host'
  | 'unsafe-config-schema'
  | 'unsafe-json'
  | 'duplicate-stream-credit'
  | 'sequence-out-of-order';

/** Fixed codes for semantic failures; deliberately coarse and non-echoing. */
export class SemanticFailure extends Error {
  readonly code: SemanticCode;

  constructor(code: SemanticCode) {
    super(code);
    this.name = 'SemanticFailure';
    this.code = code;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectArray(value: unknown, code: SemanticCode): unknown[] {
  if (!Array.isArray(value)) throw new SemanticFailure(code);
  return value;
}

/** Reject keys the contract does not declare (defence in depth next to `additionalProperties`). */
export function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: SemanticCode = 'unknown-field',
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new SemanticFailure(code);
  }
}

export function assertUnique(values: readonly unknown[], code: SemanticCode): void {
  const seen = new Set<unknown>();
  for (const value of values) {
    if (seen.has(value)) throw new SemanticFailure(code);
    seen.add(value);
  }
}

/** Walk a JSON tree rejecting keys a restricted config Schema must never use. */
export function assertSafeSchemaTree(
  value: JsonValue,
  forbiddenKeys: readonly string[],
  forbiddenStrings: readonly string[],
  budgetBytes = 16384,
): void {
  if (utf8ByteLength(JSON.stringify(value)) > budgetBytes) {
    throw new SemanticFailure('unsafe-config-schema');
  }
  const stack: JsonValue[] = [value];
  while (stack.length > 0) {
    const current = stack.pop() as JsonValue;
    if (current === null || typeof current !== 'object') {
      if (typeof current === 'string' && containsAny(current, forbiddenStrings)) {
        throw new SemanticFailure('unsafe-config-schema');
      }
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const [key, item] of Object.entries(current)) {
      if (forbiddenKeys.includes(key)) throw new SemanticFailure('unsafe-config-schema');
      if (containsAny(key, forbiddenStrings)) throw new SemanticFailure('unsafe-config-schema');
      stack.push(item);
    }
  }
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
