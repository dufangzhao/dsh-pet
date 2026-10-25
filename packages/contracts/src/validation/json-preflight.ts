/**
 * JSON preflight for anything entering a contract boundary.
 *
 * The check never invokes an input getter, `toJSON` or a proxy `get` trap on the
 * validated data: own property *descriptors* are read, accessors are rejected
 * instead of being called, so a hostile object cannot run code during
 * validation. Failures report a fixed code, never the offending value.
 */

import { types } from 'node:util';
import {
  JSON_DANGEROUS_KEYS,
  JSON_MAX_BYTES,
  JSON_MAX_DEPTH,
  JSON_MAX_KEYS,
  type JsonValue,
} from '../json.js';

export const JSON_PREFLIGHT_CODES = [
  'not-json',
  'circular',
  'accessor',
  'function',
  'symbol',
  'bigint',
  'undefined',
  'non-finite-number',
  'dangerous-key',
  'unsupported-object',
  'depth-exceeded',
  'keys-exceeded',
  'bytes-exceeded',
] as const;

export type JsonPreflightCode = (typeof JSON_PREFLIGHT_CODES)[number];

export type JsonPreflightResult =
  { ok: true; value: JsonValue } | { ok: false; code: JsonPreflightCode };

const DANGEROUS: ReadonlySet<string> = new Set(JSON_DANGEROUS_KEYS);
const OBJECT_PROTO = Object.prototype;

/** UTF-8 byte length without importing any Node built-in. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === OBJECT_PROTO || proto === null;
}

class PreflightFailure {
  readonly code: JsonPreflightCode;

  constructor(code: JsonPreflightCode) {
    this.code = code;
  }
}

interface Budget {
  keys: number;
  /** Cheap early-abort counter: UTF-16 units are never longer than UTF-8 bytes. */
  units: number;
}

/**
 * Recursively copy `input` into a fresh JSON tree while enforcing the depth,
 * key-count and byte budgets. Later stages validate the copy, so no accessor can
 * be re-invoked by a Schema walk.
 */
export function jsonPreflight(input: unknown): JsonPreflightResult {
  const seen = new Set<object>();
  const budget: Budget = { keys: 0, units: 0 };

  const visit = (value: unknown, depth: number): JsonValue | PreflightFailure => {
    if (value === null) return null;
    switch (typeof value) {
      case 'boolean':
        return value;
      case 'number':
        return Number.isFinite(value) ? value : new PreflightFailure('non-finite-number');
      case 'string':
        budget.units += value.length;
        return budget.units > JSON_MAX_BYTES ? new PreflightFailure('bytes-exceeded') : value;
      case 'undefined':
        return new PreflightFailure('undefined');
      case 'bigint':
        return new PreflightFailure('bigint');
      case 'symbol':
        return new PreflightFailure('symbol');
      case 'function':
        return new PreflightFailure('function');
      default:
        break;
    }

    const container = value as object;
    // Host-only validation: reject even non-throwing/revoked proxies before reflection.
    if (types.isProxy(container)) return new PreflightFailure('unsupported-object');
    if (seen.has(container)) return new PreflightFailure('circular');
    if (depth > JSON_MAX_DEPTH) return new PreflightFailure('depth-exceeded');
    if (Object.getOwnPropertySymbols(container).length > 0) {
      return new PreflightFailure('symbol');
    }

    if (Array.isArray(container)) {
      if (Object.getOwnPropertyNames(container).length !== container.length + 1)
        return new PreflightFailure('unsupported-object');
      seen.add(container);
      budget.keys += container.length;
      if (budget.keys > JSON_MAX_KEYS) return new PreflightFailure('keys-exceeded');
      const out: JsonValue[] = [];
      for (let index = 0; index < container.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(container, String(index));
        if (descriptor === undefined) return new PreflightFailure('undefined');
        if (!('value' in descriptor)) return new PreflightFailure('accessor');
        const item = visit(descriptor.value, depth + 1);
        if (item instanceof PreflightFailure) return item;
        out.push(item);
      }
      seen.delete(container);
      return out;
    }

    if (!isPlainObject(container)) return new PreflightFailure('unsupported-object');

    seen.add(container);
    const keys = Object.getOwnPropertyNames(container);
    budget.keys += keys.length;
    if (budget.keys > JSON_MAX_KEYS) return new PreflightFailure('keys-exceeded');

    const out: Record<string, JsonValue> = {};
    for (const key of keys) {
      if (DANGEROUS.has(key)) return new PreflightFailure('dangerous-key');
      budget.units += key.length;
      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      if (descriptor === undefined) continue;
      if (!('value' in descriptor)) return new PreflightFailure('accessor');
      if (!descriptor.enumerable) return new PreflightFailure('unsupported-object');
      const item = visit(descriptor.value, depth + 1);
      if (item instanceof PreflightFailure) return item;
      // defineProperty keeps a `__proto__`-style key inert; such keys are
      // already rejected above, this is belt and braces.
      Object.defineProperty(out, key, {
        value: item,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    seen.delete(container);
    return out;
  };

  let result: JsonValue | PreflightFailure;
  try {
    result = visit(input, 0);
  } catch {
    // A revoked proxy or a hostile `getOwnPropertyDescriptor` trap throws; that is
    // a refusal, never an escape hatch and never an echoed error.
    return { ok: false, code: 'unsupported-object' };
  }
  if (result instanceof PreflightFailure) return { ok: false, code: result.code };

  if (utf8ByteLength(JSON.stringify(result)) > JSON_MAX_BYTES) {
    return { ok: false, code: 'bytes-exceeded' };
  }
  return { ok: true, value: result };
}
