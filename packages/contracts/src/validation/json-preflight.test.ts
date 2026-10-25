import { describe, expect, it } from 'vitest';
import { jsonPreflight, utf8ByteLength } from '../validation/json-preflight.js';
import { JSON_MAX_BYTES, JSON_MAX_DEPTH } from '../json.js';

function nested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let i = 0; i < depth; i += 1) value = { a: value };
  return value;
}

describe('JSON preflight', () => {
  it('accepts plain JSON and returns a detached copy', () => {
    const input = { a: 1, b: [true, null, 'x'], c: { d: -0.5 } };
    const result = jsonPreflight(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(input);
    expect(result.value).not.toBe(input);
  });

  it('accepts null-prototype objects', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['a'] = 1;
    expect(jsonPreflight(bare).ok).toBe(true);
  });

  it('rejects circular structures', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(jsonPreflight(a)).toEqual({ ok: false, code: 'circular' });
  });

  it('rejects accessors without invoking them', () => {
    let invoked = false;
    const hostile = {
      get secret() {
        invoked = true;
        return 'leak';
      },
    };
    expect(jsonPreflight(hostile)).toEqual({ ok: false, code: 'accessor' });
    expect(invoked).toBe(false);
  });

  it('never calls toJSON', () => {
    let invoked = false;
    const hostile = {
      toJSON() {
        invoked = true;
        return 'leak';
      },
    };
    // A method is a function value and is rejected before it could be called.
    expect(jsonPreflight(hostile)).toEqual({ ok: false, code: 'function' });
    expect(invoked).toBe(false);
  });

  it.each([
    ['function', { f: () => 1 }, 'function'],
    ['symbol', { s: Symbol('s') }, 'symbol'],
    ['bigint', { b: 1n }, 'bigint'],
    ['undefined', { u: undefined }, 'undefined'],
    ['NaN', { n: Number.NaN }, 'non-finite-number'],
    ['Infinity', { n: Number.POSITIVE_INFINITY }, 'non-finite-number'],
    ['Date', { d: new Date(0) }, 'unsupported-object'],
    ['Map', { m: new Map() }, 'unsupported-object'],
  ])('rejects %s values', (_label, value, code) => {
    expect(jsonPreflight(value)).toEqual({ ok: false, code });
  });

  it('refuses a revoked proxy without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(jsonPreflight(proxy)).toEqual({ ok: false, code: 'unsupported-object' });
  });

  it('refuses a proxy whose descriptor trap throws', () => {
    const hostile = new Proxy(
      { a: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
      },
    );
    expect(jsonPreflight(hostile)).toEqual({ ok: false, code: 'unsupported-object' });
  });

  it('rejects dangerous prototype keys', () => {
    for (const key of ['__proto__', 'prototype', 'constructor']) {
      const payload = JSON.parse(`{"${key}": {"polluted": true}}`) as unknown;
      expect(jsonPreflight(payload)).toEqual({ ok: false, code: 'dangerous-key' });
    }
  });

  it('enforces the depth budget', () => {
    expect(jsonPreflight(nested(JSON_MAX_DEPTH - 2)).ok).toBe(true);
    expect(jsonPreflight(nested(JSON_MAX_DEPTH + 8))).toEqual({
      ok: false,
      code: 'depth-exceeded',
    });
  });

  it('enforces the byte budget', () => {
    expect(jsonPreflight({ big: 'x'.repeat(JSON_MAX_BYTES) })).toEqual({
      ok: false,
      code: 'bytes-exceeded',
    });
  });

  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8ByteLength('中')).toBe(3);
    expect(utf8ByteLength('ab')).toBe(2);
  });
});
