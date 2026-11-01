/**
 * M1-05 受限配置 Schema 契约测试（docs/26-m1-configuration-v1.md）。
 *
 * 本文件只钉住 prepareConfigDefinition 在文档中冻结的契约：受限关键字子集、
 * 闭合对象、各类预算、凭据引用、敏感字段名、冻结快照、validate 的自有副本，
 * 以及 apply/changeMode 的生效方式。全部通过只说明本文件覆盖的断言成立，
 * 不代表 M1-05（存储、迁移、服务注册、设置界面）整体完成。
 *
 * 用例不触碰真实 I/O、进程、GUI 或网络；没有定时器，也不等待微任务。
 */

import { describe, expect, it } from 'vitest';
import type { JsonObject, JsonValue, Result } from '@pet/contracts';
import {
  prepareConfigDefinition,
  type ConfigField,
  type PreparedConfigDefinition,
} from '@pet/host-kernel';

type Prepared = PreparedConfigDefinition;

/** 失败必须是固定形状的 invalid-input，且不回显任何输入内容。 */
const INVALID_INPUT = {
  code: 'invalid-input',
  messageKey: 'errors.invalid-input',
  retryable: false,
} as const;

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error('expected ok, got ' + result.error.code);
  return result.value;
}

function expectRejected(result: Result<unknown>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual(INVALID_INPUT);
}

function prepare(
  schema: unknown,
  options: { version?: unknown; apply?: unknown } = {},
  credentialKeys: readonly string[] = [],
): Result<Prepared> {
  const declaration: Record<string, unknown> = {};
  declaration['version'] = 'version' in options ? options.version : 1;
  declaration['schema'] = schema;
  if ('apply' in options) declaration['apply'] = options.apply;
  return prepareConfigDefinition(declaration, credentialKeys);
}

function preparedOf(
  schema: unknown,
  options: { version?: unknown; apply?: unknown } = {},
  credentialKeys: readonly string[] = [],
): Prepared {
  return unwrap(prepare(schema, options, credentialKeys));
}

function asObject(value: JsonValue | undefined): JsonObject {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object');
  }
  return value;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) throw new Error('expected a JSON array');
  return value;
}

function closedObject(properties: JsonObject = {}): JsonObject {
  return { type: 'object', additionalProperties: false, properties };
}

function propertyOf(prepared: Prepared, key: string): JsonObject {
  return asObject(asObject(prepared.schema['properties'])[key]);
}

function fieldOf(prepared: Prepared, pointer: string): ConfigField {
  const found = prepared.fields.find((field) => field.pointer === pointer);
  if (!found) throw new Error('missing field ' + pointer);
  return found;
}

function pointerList(prepared: Prepared): string[] {
  return prepared.fields.map((field) => field.pointer);
}

function expectDeepFrozen(value: JsonValue): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  const children: JsonValue[] = Array.isArray(value)
    ? [...value]
    : Object.keys(value).map((key) => value[key] as JsonValue);
  for (const child of children) expectDeepFrozen(child);
}

describe('declaration envelope', () => {
  it('accepts a minimal closed root and normalizes the schema snapshot', () => {
    const prepared = preparedOf({ type: 'object', additionalProperties: false });
    expect(prepared.version).toBe(1);
    expect(prepared.schema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {},
    });
    expect(prepared.defaults).toEqual({});
    expect(prepared.fields).toEqual([]);
    expectDeepFrozen(prepared.schema);
    expectDeepFrozen(prepared.defaults);
    expect(Object.isFrozen(prepared.fields)).toBe(true);
  });

  it('rejects declarations that are not closed envelopes', () => {
    for (const input of [null, [], 'config', 1, true, undefined]) {
      expectRejected(prepareConfigDefinition(input));
    }
    expectRejected(prepareConfigDefinition({ version: 1 }));
    expectRejected(prepareConfigDefinition({ schema: closedObject() }));
    expectRejected(prepareConfigDefinition({ version: 1, schema: closedObject(), name: 'x' }));
    expectRejected(
      prepareConfigDefinition({ version: 1, schema: closedObject(), schemaVersion: 1 }),
    );
    unwrap(prepareConfigDefinition({ version: 1, schema: closedObject() }));
  });

  it('rejects versions that are not positive safe integers', () => {
    const schema = closedObject();
    for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', true, null, undefined]) {
      expectRejected(prepare(schema, { version }));
    }
    expect(preparedOf(schema, { version: 7 }).version).toBe(7);
    expect(preparedOf(schema, { version: Number.MAX_SAFE_INTEGER }).version).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('rejects an apply map that is not an object of known modes', () => {
    const schema = closedObject({ theme: { type: 'string' } });
    for (const apply of [[], 'immediate', 1, null, true]) {
      expectRejected(prepare(schema, { apply }));
    }
    expectRejected(prepare(schema, { apply: { theme: 'hot' } }));
    expectRejected(prepare(schema, { apply: { theme: 1 } }));
    expectRejected(prepare(schema, { apply: { theme: null } }));
    expectRejected(prepare(schema, { apply: { missing: 'reload' } }));
    expectRejected(prepare(schema, { apply: { '': 'reload' } }));
    expectRejected(prepare(schema, { apply: { '/': 'reload' } }));
    expectRejected(prepare(schema, { apply: { theme: 'immediate', '/theme': 'reload' } }));
    expectRejected(prepare(schema, { apply: { theme: { mode: 'immediate' } } }));
    unwrap(prepare(schema, { apply: { theme: 'restart' } }));
  });

  it('never lets a non-string apply value resolve to a mode', () => {
    // docs/26 只允许 immediate/reload/restart 三个字符串字面量。数组不是其中之一，
    // 不能被 String() 强转成 'immediate' 混进 fields[].apply（那会破坏 ConfigApplyMode 类型）。
    const schema = closedObject({ theme: { type: 'string' } });
    expectRejected(prepare(schema, { apply: { theme: ['immediate'] } }));
    expectRejected(prepare(schema, { apply: { theme: ['restart', 'immediate'] } }));
  });

  it('rejects schema data that is not an object', () => {
    for (const schema of [[], 'object', 1, true, null, undefined]) {
      expectRejected(prepare(schema));
    }
  });
});

describe('type and keyword subset', () => {
  it('requires an object root', () => {
    for (const schema of [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
      { type: 'number' },
      { type: 'null' },
      { type: 'boolean' },
    ]) {
      expectRejected(prepare(schema));
    }
  });

  it('accepts exactly the documented single types', () => {
    const schemas: Record<string, JsonObject> = {
      string: { type: 'string' },
      number: { type: 'number' },
      integer: { type: 'integer' },
      boolean: { type: 'boolean' },
      null: { type: 'null' },
      array: { type: 'array', items: { type: 'string' } },
      object: closedObject(),
    };
    for (const [name, schema] of Object.entries(schemas)) {
      expect(fieldOf(preparedOf(closedObject({ field: schema })), '/field').type).toBe(name);
    }
  });

  it('rejects unsupported or composite types', () => {
    const types: unknown[] = [
      'any',
      'Object',
      'array ',
      ['string', 'number'],
      ['string', 'number', 'null'],
      1,
      null,
      undefined,
    ];
    for (const type of types) {
      expectRejected(prepare(closedObject({ field: { type } as unknown as JsonObject })));
    }
  });

  it('accepts only the explicit nullable type union', () => {
    const p = preparedOf(
      closedObject({ voice: { type: ['string', 'null'], maxLength: 32, default: null } }),
    );
    expect(p.validate({ voice: null }).ok).toBe(true);
    expect(p.validate({ voice: 'system' }).ok).toBe(true);
    expect(p.validate({ voice: 42 }).ok).toBe(false);
  });

  it('rejects unknown keywords on objects and fields', () => {
    const rootKeywords: JsonObject[] = [
      { $ref: '#/$defs/x' },
      { $id: 'urn:x' },
      { oneOf: [] },
      { allOf: [] },
      { anyOf: [] },
      { if: {} },
      { definitions: {} },
      { $defs: {} },
      { minProperties: 1 },
      { patternProperties: {} },
      { propertyNames: { type: 'string' } },
      { dependentRequired: {} },
      { unevaluatedProperties: false },
    ];
    for (const extra of rootKeywords) {
      expectRejected(prepare({ ...closedObject(), ...extra }));
    }
    const fieldKeywords: JsonObject[] = [
      { pattern: '^a' },
      { contentMediaType: 'text/plain' },
      { examples: [] },
      { deprecated: true },
      { readOnly: true },
      { writeOnly: true },
    ];
    for (const extra of fieldKeywords) {
      expectRejected(prepare(closedObject({ field: { type: 'string', ...extra } })));
    }
  });

  it('rejects keywords that do not apply to the node type', () => {
    const cases: JsonObject[] = [
      { type: 'string', items: { type: 'string' } },
      { type: 'string', minimum: 0 },
      { type: 'string', properties: {} },
      { type: 'number', minLength: 1 },
      { type: 'number', items: { type: 'number' } },
      { type: 'boolean', minimum: 0 },
      { type: 'boolean', maxLength: 1 },
      { type: 'null', minItems: 0 },
      { type: 'array', items: { type: 'string' }, properties: {} },
      { type: 'array', items: { type: 'string' }, minLength: 1 },
      { type: 'object', additionalProperties: false, properties: {}, minItems: 0 },
      { type: 'object', additionalProperties: false, properties: {}, minLength: 0 },
      { type: 'integer', format: 'credential-ref', enum: ['a'] },
    ];
    for (const schema of cases) {
      expectRejected(prepare(closedObject({ field: schema })));
    }
  });

  it('requires every object to be closed', () => {
    expectRejected(prepare({ type: 'object', properties: {} }));
    expectRejected(prepare({ type: 'object', additionalProperties: true, properties: {} }));
    expectRejected(prepare({ type: 'object', additionalProperties: {}, properties: {} }));
    expectRejected(
      prepare({
        type: 'object',
        additionalProperties: false,
        properties: { nested: { type: 'object', properties: {} } },
      }),
    );
    unwrap(prepare({ type: 'object', additionalProperties: false }));
  });

  it('rejects non-string annotations', () => {
    expectRejected(prepare({ type: 'object', additionalProperties: false, title: 1 }));
    expectRejected(prepare({ type: 'object', additionalProperties: false, description: {} }));
    expectRejected(prepare({ type: 'object', additionalProperties: false, title: null }));
    unwrap(
      prepare({
        type: 'object',
        additionalProperties: false,
        title: '标题',
        description: '说明',
      }),
    );
  });
});

describe('object fields and required', () => {
  it('rejects field names that cannot be JSON Pointer segments', () => {
    for (const name of ['', '_x', '-x', '.x', 'a/b', 'a~b', 'a b', 'a'.repeat(65)]) {
      expectRejected(prepare(closedObject({ [name]: { type: 'string' } })));
    }
    const prepared = preparedOf(
      closedObject({ 'A.b_c-1': { type: 'string' }, ['a'.repeat(64)]: { type: 'boolean' } }),
    );
    expect(pointerList(prepared).sort()).toEqual(['/A.b_c-1', '/' + 'a'.repeat(64)]);
  });

  it('rejects malformed properties maps and property schemas', () => {
    expectRejected(prepare({ type: 'object', additionalProperties: false, properties: [] }));
    expectRejected(prepare({ type: 'object', additionalProperties: false, properties: null }));
    expectRejected(
      prepare({ type: 'object', additionalProperties: false, properties: { a: 'string' } }),
    );
    expectRejected(prepare({ type: 'object', additionalProperties: false, properties: { a: {} } }));
  });

  it('limits every object to 64 declared fields', () => {
    const fieldsOf = (count: number): JsonObject => {
      const properties: JsonObject = {};
      for (let index = 0; index < count; index += 1) {
        properties['f' + index] = { type: 'boolean' };
      }
      return properties;
    };
    unwrap(prepare({ type: 'object', additionalProperties: false, properties: fieldsOf(64) }));
    expectRejected(
      prepare({ type: 'object', additionalProperties: false, properties: fieldsOf(65) }),
    );
  });

  it('requires required to be a unique subset of declared fields', () => {
    const schema = closedObject({ a: { type: 'string' }, b: { type: 'boolean' } });
    expectRejected(prepare({ ...schema, required: 'a' }));
    expectRejected(prepare({ ...schema, required: ['a', 'a'] }));
    expectRejected(prepare({ ...schema, required: ['missing'] }));
    expectRejected(prepare({ ...schema, required: [1] }));
    const prepared = preparedOf({ ...schema, required: ['a'] });
    expect(asArray(prepared.schema['required'])).toEqual(['a']);
    expectRejected(prepared.validate({ b: true }));
    unwrap(prepared.validate({ a: 'x', b: true }));
  });

  it('treats a missing required root field without default as not ready', () => {
    // docs/26：缺必需字段且无默认值时未就绪。required 因此必须对根对象同样生效，
    // 不能只被复制进 schema 快照而让 validate 放过缺字段的候选值。
    const requiredRoot = preparedOf({
      type: 'object',
      additionalProperties: false,
      required: ['displayName'],
      properties: { displayName: { type: 'string' } },
    });
    expect(asArray(requiredRoot.schema['required'])).toEqual(['displayName']);
    expectRejected(requiredRoot.validate({}));
    unwrap(requiredRoot.validate({ displayName: 'pet' }));
  });
});

describe('defaults, enum and const', () => {
  it('builds candidate defaults but never injects them into saved values', () => {
    const prepared = preparedOf(
      closedObject({
        theme: { type: 'string', default: 'light' },
        nested: closedObject({ level: { type: 'integer', default: 2 } }),
      }),
    );
    expect(prepared.defaults['theme']).toBe('light');
    expect(Object.keys(prepared.defaults).every((key) => key === 'theme' || key === 'nested')).toBe(
      true,
    );
    expectDeepFrozen(prepared.defaults);
    expect(unwrap(prepared.validate({}))).toEqual({});
    expect(unwrap(prepared.validate({ nested: {} }))).toEqual({ nested: {} });
    expect(unwrap(prepared.validate({ nested: { level: 3 } }))).toEqual({ nested: { level: 3 } });
  });

  it('rejects defaults that do not satisfy their own node', () => {
    expectRejected(prepare(closedObject({ n: { type: 'integer', default: '1' } })));
    expectRejected(prepare(closedObject({ n: { type: 'integer', default: 1.5 } })));
    expectRejected(prepare(closedObject({ s: { type: 'string', enum: ['a'], default: 'b' } })));
    expectRejected(prepare(closedObject({ s: { type: 'string', minLength: 2, default: 'a' } })));
    expectRejected(
      prepare(
        closedObject({
          a: { type: 'array', maxItems: 1, items: { type: 'number' }, default: [1, 2] },
        }),
      ),
    );
    expectRejected(
      prepare(
        closedObject({
          o: {
            type: 'object',
            additionalProperties: false,
            required: ['x'],
            properties: { x: { type: 'string' } },
            default: {},
          },
        }),
      ),
    );
    unwrap(prepare(closedObject({ n: { type: 'integer', minimum: 0, maximum: 10, default: 0 } })));
  });

  it('supports enum and const on basic values only', () => {
    const prepared = preparedOf(
      closedObject({
        mode: { type: 'string', enum: ['fast', 'safe'] },
        fixed: { type: 'integer', const: 7 },
      }),
    );
    unwrap(prepared.validate({ mode: 'fast', fixed: 7 }));
    expectRejected(prepared.validate({ mode: 'slow', fixed: 7 }));
    expectRejected(prepared.validate({ mode: 'fast', fixed: 8 }));

    const invalid: JsonObject[] = [
      { type: 'object', additionalProperties: false, properties: {}, const: {} },
      { type: 'array', items: { type: 'string' }, enum: [['a']] },
      { type: 'string', enum: [] },
      { type: 'string', enum: ['a', 'a'] },
      { type: 'string', enum: Array.from({ length: 65 }, (_, index) => 'v' + index) },
      { type: 'string', const: { a: 1 } },
    ];
    for (const schema of invalid) {
      expectRejected(prepare(closedObject({ field: schema })));
    }
    unwrap(prepare(closedObject({ s: { type: 'string', const: 'a', enum: ['a', 'b'] } })));
  });
});

describe('string bounds and Unicode length', () => {
  it('counts code points rather than UTF-16 units', () => {
    const bounded = preparedOf(
      closedObject({ name: { type: 'string', minLength: 1, maxLength: 2 } }),
    );
    unwrap(bounded.validate({ name: '😀😀' }));
    expectRejected(bounded.validate({ name: '😀😀😀' }));
    expectRejected(bounded.validate({ name: '' }));

    const pair = preparedOf(closedObject({ name: { type: 'string', minLength: 2, maxLength: 2 } }));
    expectRejected(pair.validate({ name: '😀' }));
    unwrap(pair.validate({ name: '😀😀' }));
  });

  it('defaults the upper bound to 4096 code points', () => {
    const prepared = preparedOf(closedObject({ text: { type: 'string' } }));
    expect(propertyOf(prepared, 'text')['maxLength']).toBe(4096);
    unwrap(prepared.validate({ text: 'a'.repeat(4096) }));
    expectRejected(prepared.validate({ text: 'a'.repeat(4097) }));
    unwrap(prepared.validate({ text: '😀'.repeat(4096) }));
    expectRejected(prepared.validate({ text: '😀'.repeat(4097) }));
  });

  it('supports an explicitly bounded full prompt while retaining the value byte limit', () => {
    const prompt = preparedOf(closedObject({ text: { type: 'string', maxLength: 16384 } }));
    unwrap(prompt.validate({ text: 'a'.repeat(16384) }));
    expectRejected(prompt.validate({ text: 'a'.repeat(16385) }));
    expectRejected(prompt.validate({ text: '😀'.repeat(16384) }));
  });

  it('rejects out-of-range or inconsistent length bounds', () => {
    expectRejected(prepare(closedObject({ s: { type: 'string', maxLength: 16385 } })));
    expectRejected(prepare(closedObject({ s: { type: 'string', minLength: -1 } })));
    expectRejected(prepare(closedObject({ s: { type: 'string', minLength: 1.5 } })));
    expectRejected(prepare(closedObject({ s: { type: 'string', minLength: 5, maxLength: 2 } })));
    expectRejected(prepare(closedObject({ s: { type: 'string', minLength: '1' } })));
    const zero = preparedOf(closedObject({ s: { type: 'string', minLength: 0, maxLength: 0 } }));
    unwrap(zero.validate({ s: '' }));
    expectRejected(zero.validate({ s: 'a' }));
  });
});

describe('numeric bounds and safe integers', () => {
  it('restricts integers to safe integers and clamps their bounds', () => {
    const prepared = preparedOf(closedObject({ count: { type: 'integer' } }));
    expect(propertyOf(prepared, 'count')['minimum']).toBe(-Number.MAX_SAFE_INTEGER);
    expect(propertyOf(prepared, 'count')['maximum']).toBe(Number.MAX_SAFE_INTEGER);
    unwrap(prepared.validate({ count: Number.MAX_SAFE_INTEGER }));
    unwrap(prepared.validate({ count: -Number.MAX_SAFE_INTEGER }));
    expectRejected(prepared.validate({ count: 2 ** 53 }));
    expectRejected(prepared.validate({ count: -(2 ** 53) }));
    expectRejected(prepared.validate({ count: 1.5 }));
    expectRejected(prepared.validate({ count: Number.NaN }));
    expectRejected(prepared.validate({ count: Number.POSITIVE_INFINITY }));
    expectRejected(prepared.validate({ count: '1' }));
  });

  it('treats minimum and maximum as inclusive for both numeric types', () => {
    const prepared = preparedOf(
      closedObject({
        whole: { type: 'integer', minimum: 0, maximum: 10 },
        real: { type: 'number', minimum: 0.5, maximum: 1.5 },
      }),
    );
    unwrap(prepared.validate({ whole: 0, real: 0.5 }));
    unwrap(prepared.validate({ whole: 10, real: 1.5 }));
    expectRejected(prepared.validate({ whole: -1, real: 1 }));
    expectRejected(prepared.validate({ whole: 11, real: 1 }));
    expectRejected(prepared.validate({ whole: 1, real: 0.25 }));
    unwrap(prepared.validate({ whole: 1, real: 1.25 }));
  });

  it('rejects non-numeric or inverted numeric bounds', () => {
    expectRejected(prepare(closedObject({ n: { type: 'number', minimum: '0' } })));
    expectRejected(prepare(closedObject({ n: { type: 'number', maximum: null } })));
    expectRejected(prepare(closedObject({ n: { type: 'number', minimum: 2, maximum: 1 } })));
    expectRejected(prepare(closedObject({ n: { type: 'integer', minimum: 1e30 } })));
    expectRejected(prepare(closedObject({ n: { type: 'integer', maximum: -1e30 } })));
    const big = preparedOf(closedObject({ n: { type: 'number', maximum: Number.MAX_VALUE } }));
    unwrap(big.validate({ n: Number.MAX_VALUE }));
    expectRejected(big.validate({ n: Number.MAX_VALUE * 2 }));
  });
});

describe('bounded arrays', () => {
  it('requires items and bounds element counts to 256', () => {
    expectRejected(prepare(closedObject({ list: { type: 'array' } })));
    expectRejected(prepare(closedObject({ list: { type: 'array', items: 'string' } })));
    const prepared = preparedOf(
      closedObject({ list: { type: 'array', items: { type: 'number' } } }),
    );
    expect(propertyOf(prepared, 'list')['maxItems']).toBe(256);
    unwrap(prepared.validate({ list: Array.from({ length: 256 }, (_, index) => index) }));
    expectRejected(prepared.validate({ list: Array.from({ length: 257 }, (_, index) => index) }));
    expectRejected(prepared.validate({ list: ['a'] }));
    expectRejected(
      prepare(closedObject({ list: { type: 'array', items: { type: 'number' }, maxItems: 257 } })),
    );
    expectRejected(
      prepare(closedObject({ list: { type: 'array', items: { type: 'number' }, minItems: 257 } })),
    );
    expectRejected(
      prepare(
        closedObject({
          list: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 1 },
        }),
      ),
    );
  });

  it('enforces uniqueItems with JSON equality', () => {
    const prepared = preparedOf(
      closedObject({ list: { type: 'array', items: { type: 'string' }, uniqueItems: true } }),
    );
    unwrap(prepared.validate({ list: ['a', 'b'] }));
    expectRejected(prepared.validate({ list: ['a', 'a'] }));
    expectRejected(
      prepare(
        closedObject({ list: { type: 'array', items: { type: 'string' }, uniqueItems: 'yes' } }),
      ),
    );
    const structured = preparedOf(
      closedObject({
        list: {
          type: 'array',
          uniqueItems: true,
          items: closedObject({ id: { type: 'integer' } }),
        },
      }),
    );
    unwrap(structured.validate({ list: [{ id: 1 }, { id: 2 }] }));
    expectRejected(structured.validate({ list: [{ id: 1 }, { id: 1 }] }));
  });

  it('validates nested arrays and closed element objects', () => {
    const prepared = preparedOf(
      closedObject({
        matrix: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
        servers: { type: 'array', items: closedObject({ host: { type: 'string' } }) },
      }),
    );
    unwrap(prepared.validate({ matrix: [[1, 2], [3]], servers: [{ host: 'a' }] }));
    expectRejected(prepared.validate({ matrix: [[1, '2']], servers: [] }));
    expectRejected(prepared.validate({ matrix: [], servers: [{ host: 'a', port: 1 }] }));
  });
});

describe('credential references and sensitive names', () => {
  const credentialKeys = ['llm.apiKey', 'tts.token'] as const;

  it('requires credential-ref to be a string with a declared enum subset', () => {
    const schema = (field: JsonObject): JsonObject => closedObject({ key: field });
    expectRejected(
      prepare(schema({ type: 'string', format: 'credential-ref' }), {}, credentialKeys),
    );
    expectRejected(
      prepare(schema({ type: 'string', format: 'credential-ref', enum: [] }), {}, credentialKeys),
    );
    expectRejected(
      prepare(schema({ type: 'string', format: 'credential-ref', enum: [1] }), {}, credentialKeys),
    );
    expectRejected(
      prepare(
        schema({ type: 'string', format: 'credential-ref', enum: ['other.key'] }),
        {},
        credentialKeys,
      ),
    );
    expectRejected(
      prepare(
        schema({ type: 'string', format: 'credential-ref', enum: ['llm.apiKey', 'other.key'] }),
        {},
        credentialKeys,
      ),
    );
    expectRejected(prepare(schema({ type: 'string', format: 'uri' })));
    expectRejected(
      prepare(schema({ type: 'integer', format: 'credential-ref', enum: ['llm.apiKey'] })),
    );
    const prepared = unwrap(
      prepare(
        schema({ type: 'string', format: 'credential-ref', enum: ['llm.apiKey'] }),
        {},
        credentialKeys,
      ),
    );
    unwrap(prepared.validate({ key: 'llm.apiKey' }));
    expectRejected(prepared.validate({ key: 'tts.token' }));
    expectRejected(prepared.validate({ key: 'plaintext' }));
  });

  it('refuses plaintext configuration under explicit secret names', () => {
    const names = [
      'apiKey',
      'password',
      'accessToken',
      'clientSecret',
      'secret',
      'authorization',
      'api_key',
      'API-KEY',
      'access-token',
      'client_secret',
    ];
    for (const name of names) {
      const result = prepare(closedObject({ [name]: { type: 'string' } }));
      expectRejected(result);
      expect(JSON.stringify(result)).not.toContain(name);
    }
    expectRejected(
      prepare(closedObject({ nested: closedObject({ password: { type: 'string' } }) })),
    );
    expectRejected(
      prepare(
        closedObject({
          list: { type: 'array', items: closedObject({ apiKey: { type: 'string' } }) },
        }),
      ),
    );
    unwrap(
      prepare(
        closedObject({
          apiKey: { type: 'string', format: 'credential-ref', enum: ['llm.apiKey'] },
        }),
        {},
        credentialKeys,
      ),
    );
    // 名单之外的相似名不在本检查目标内：docs/26 明确它不是 DLP。
    unwrap(prepare(closedObject({ apiKeyHint: { type: 'string' } })));
  });
});

describe('schema budgets', () => {
  const sizeOf = (schema: JsonObject): number => Buffer.byteLength(JSON.stringify(schema), 'utf8');

  it('rejects schemas above 16 KiB and accepts those at or below it', () => {
    const withDescriptions = (count: number): JsonObject => {
      const properties: JsonObject = {};
      for (let index = 0; index < count; index += 1) {
        properties['f' + index] = { type: 'string', description: 'x'.repeat(1024) };
      }
      return { type: 'object', additionalProperties: false, properties };
    };
    let accepted: JsonObject | undefined;
    let rejected: JsonObject | undefined;
    for (let count = 1; count <= 60 && rejected === undefined; count += 1) {
      const candidate = withDescriptions(count);
      if (sizeOf(candidate) > 16384) rejected = candidate;
      else accepted = candidate;
    }
    if (accepted === undefined || rejected === undefined) throw new Error('budget fixture');
    expect(sizeOf(accepted)).toBeLessThanOrEqual(16384);
    unwrap(prepare(accepted));
    expect(sizeOf(rejected)).toBeGreaterThan(16384);
    expectRejected(prepare(rejected));
  });

  it('bounds nesting depth to 8 and node count to 256', () => {
    const chain = (levels: number): JsonObject => {
      let schema: JsonObject = { type: 'object', additionalProperties: false, properties: {} };
      for (let index = 0; index < levels; index += 1) {
        schema = { type: 'object', additionalProperties: false, properties: { child: schema } };
      }
      return schema;
    };
    unwrap(prepare(chain(8)));
    expectRejected(prepare(chain(9)));

    const wide = (fields: number, children: number): JsonObject => {
      const properties: JsonObject = {};
      for (let index = 0; index < fields; index += 1) {
        const nested: JsonObject = {};
        for (let child = 0; child < children; child += 1) {
          nested['c' + child] = { type: 'boolean' };
        }
        properties['f' + index] = {
          type: 'object',
          additionalProperties: false,
          properties: nested,
        };
      }
      return { type: 'object', additionalProperties: false, properties };
    };
    // 1 + 63 × 4 = 253 个节点
    unwrap(prepare(wide(63, 3)));
    // 1 + 64 × 4 = 257 个节点，超出 256 的节点预算
    expectRejected(prepare(wide(64, 3)));
  });
});

describe('hostile input is never executed', () => {
  it('rejects accessors in the declaration without invoking them', () => {
    let calls = 0;
    const schema: Record<string, unknown> = { type: 'object', additionalProperties: false };
    Object.defineProperty(schema, 'properties', {
      enumerable: true,
      configurable: true,
      get() {
        calls += 1;
        return {};
      },
    });
    expectRejected(prepare(schema));
    expect(calls).toBe(0);
  });

  it('rejects proxies in the declaration without running traps', () => {
    let traps = 0;
    const proxy = new Proxy(
      { type: 'object', additionalProperties: false },
      {
        get(target, key, receiver) {
          traps += 1;
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          traps += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          traps += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    expectRejected(prepare(proxy));
    expect(traps).toBe(0);

    const revocable = Proxy.revocable({ type: 'object', additionalProperties: false }, {});
    revocable.revoke();
    expectRejected(prepare(revocable.proxy));
  });

  it('rejects non-JSON declaration data', () => {
    class Hostile {
      readonly type = 'object';
    }
    expectRejected(prepare(new Hostile()));
    expectRejected(prepare(new Date()));
    const withSymbol: Record<string, unknown> = { type: 'object', additionalProperties: false };
    Object.defineProperty(withSymbol, Symbol('x'), { enumerable: true, value: 1 });
    expectRejected(prepare(withSymbol));
    expectRejected(
      prepare(closedObject({ a: { type: 'string', default: 1n } as unknown as JsonObject })),
    );
    expectRejected(
      prepare(closedObject({ a: { type: 'string', default: undefined } as unknown as JsonObject })),
    );
    const cyclic: Record<string, unknown> = { type: 'object', additionalProperties: false };
    cyclic['self'] = cyclic;
    expectRejected(prepare(cyclic));
  });

  it('rejects accessors, proxies, toJSON and cycles in validated values', () => {
    const prepared = preparedOf(closedObject({ token: { type: 'string' } }));
    let calls = 0;

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'token', {
      enumerable: true,
      configurable: true,
      get() {
        calls += 1;
        return 'x';
      },
    });
    expectRejected(prepared.validate(accessor));
    expect(calls).toBe(0);

    let traps = 0;
    const proxy = new Proxy(
      { token: 'x' },
      {
        get(target, key, receiver) {
          traps += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    expectRejected(prepared.validate(proxy));
    expect(traps).toBe(0);

    const withToJson = {
      token: 'x',
      toJSON() {
        calls += 1;
        return { token: 'x' };
      },
    };
    expectRejected(prepared.validate(withToJson));
    expect(calls).toBe(0);

    const cyclic: Record<string, unknown> = { token: 'x' };
    cyclic['self'] = cyclic;
    expectRejected(prepared.validate(cyclic));

    for (const value of [undefined, null, [], 'x', 1, true]) {
      expectRejected(prepared.validate(value));
    }
    unwrap(prepared.validate({ token: 'x' }));
  });
});

describe('validate results', () => {
  it('returns an own deep-frozen copy and leaves the input untouched', () => {
    const prepared = preparedOf(
      closedObject({
        name: { type: 'string' },
        nested: closedObject({ level: { type: 'integer' } }),
      }),
    );
    const input: JsonObject = { name: 'pet', nested: { level: 2 } };
    const value = unwrap(prepared.validate(input));
    expect(value).toEqual(input);
    expect(value).not.toBe(input);
    expect(value['nested']).not.toBe(input['nested']);
    expectDeepFrozen(value);
    expect(() => {
      value['name'] = 'other';
    }).toThrow(TypeError);
    expect(input).toEqual({ name: 'pet', nested: { level: 2 } });
  });

  it('reports a fixed error that never echoes the failing value', () => {
    const prepared = preparedOf(closedObject({ name: { type: 'string' } }));
    const result = prepared.validate({ name: 'do-not-echo-this', extra: true });
    expectRejected(result);
    expect(JSON.stringify(result)).not.toContain('do-not-echo-this');
    expect(JSON.stringify(result)).not.toContain('extra');
  });
});

describe('frozen snapshots', () => {
  it('does not alias the declaration it was built from', () => {
    const propertySchema: JsonObject = { type: 'string', maxLength: 8, default: 'seed' };
    const declaration: JsonObject = {
      version: 1,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { name: propertySchema },
      },
    };
    const prepared = unwrap(prepareConfigDefinition(declaration));
    propertySchema['maxLength'] = 1;
    asObject(declaration['schema'])['properties'] = {};
    expect(prepared.schema).not.toBe(declaration['schema']);
    expect(propertyOf(prepared, 'name')['maxLength']).toBe(8);
    expect(prepared.defaults).toEqual({ name: 'seed' });
    expect(unwrap(prepared.validate({ name: 'abcdefgh' }))).toEqual({ name: 'abcdefgh' });
    expectRejected(prepared.validate({ name: 'abcdefghi' }));
  });

  it('freezes the schema, defaults and field snapshots deeply', () => {
    const prepared = preparedOf(
      closedObject({
        theme: { type: 'string', default: 'light' },
        nested: closedObject({ level: { type: 'integer', default: 1 } }),
      }),
    );
    expectDeepFrozen(prepared.schema);
    expectDeepFrozen(prepared.defaults);
    expect(Object.isFrozen(prepared.fields)).toBe(true);
    for (const field of prepared.fields) expect(Object.isFrozen(field)).toBe(true);
    expect(() => {
      asObject(prepared.schema)['type'] = 'array';
    }).toThrow(TypeError);
    expect(() => {
      prepared.defaults['theme'] = 'dark';
    }).toThrow(TypeError);
  });
});

describe('fields pointer table', () => {
  it('lists tracked object paths with resolved apply modes', () => {
    const prepared = preparedOf(
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          theme: { type: 'string' },
          ui: closedObject({
            density: { type: 'string' },
            font: closedObject({ size: { type: 'integer' } }),
          }),
        },
      },
      { apply: { theme: 'immediate', ui: 'restart', '/ui/font/size': 'immediate' } },
    );
    expect(pointerList(prepared).sort()).toEqual([
      '/theme',
      '/ui',
      '/ui/density',
      '/ui/font',
      '/ui/font/size',
    ]);
    expect(fieldOf(prepared, '/theme').apply).toBe('immediate');
    expect(fieldOf(prepared, '/ui').apply).toBe('restart');
    expect(fieldOf(prepared, '/ui/density').apply).toBe('restart');
    expect(fieldOf(prepared, '/ui/font').apply).toBe('restart');
    expect(fieldOf(prepared, '/ui/font/size').apply).toBe('immediate');
    expect(fieldOf(prepared, '/ui/font/size').type).toBe('integer');
    for (const field of prepared.fields) {
      expect(Object.keys(field).sort()).toEqual(['apply', 'pointer', 'type']);
    }
  });

  it('keeps array internals out of the root pointer table', () => {
    const schema: JsonObject = {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        servers: {
          type: 'array',
          items: closedObject({ host: { type: 'string' }, port: { type: 'integer' } }),
        },
      },
    };
    const prepared = preparedOf(schema);
    expect(pointerList(prepared).sort()).toEqual(['/name', '/servers']);
    expect(fieldOf(prepared, '/servers').type).toBe('array');
    expect(pointerList(prepared).filter((pointer) => pointer.startsWith('/servers/'))).toEqual([]);

    expectRejected(prepare(schema, { apply: { host: 'immediate' } }));
    expectRejected(prepare(schema, { apply: { '/servers/0': 'immediate' } }));
    expectRejected(prepare(schema, { apply: { '/servers/host': 'immediate' } }));

    const collision = preparedOf(schema, { apply: { name: 'restart' } });
    expect(fieldOf(collision, '/name').apply).toBe('restart');
    expect(collision.fields.filter((field) => field.pointer === '/name')).toHaveLength(1);
    expect(fieldOf(collision, '/servers').apply).toBe('reload');
  });
});

describe('changeMode', () => {
  const definition = (): Prepared =>
    preparedOf(
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          theme: { type: 'string', default: 'light' },
          volume: { type: 'integer', minimum: 0, maximum: 100, default: 50 },
          servers: { type: 'array', maxItems: 4, items: { type: 'string' } },
          ui: closedObject({
            density: { type: 'string' },
            font: closedObject({ size: { type: 'integer' } }),
          }),
        },
      },
      { apply: { theme: 'immediate', ui: 'restart', '/ui/font/size': 'immediate' } },
    );

  it('returns null when nothing changed', () => {
    const prepared = definition();
    expect(prepared.changeMode({}, {})).toBeNull();
    expect(prepared.changeMode({ theme: 'light' }, { theme: 'light' })).toBeNull();
    expect(prepared.changeMode({ theme: 'a', volume: 1 }, { volume: 1, theme: 'a' })).toBeNull();
    expect(
      prepared.changeMode({ ui: { font: { size: 1 } } }, { ui: { font: { size: 1 } } }),
    ).toBeNull();
  });

  it('selects the annotated mode and inherits it from ancestors', () => {
    const prepared = definition();
    expect(prepared.changeMode({ theme: 'a' }, { theme: 'b' })).toBe('immediate');
    expect(prepared.changeMode({ volume: 1 }, { volume: 2 })).toBe('reload');
    expect(prepared.changeMode({ ui: { density: 'a' } }, { ui: { density: 'b' } })).toBe('restart');
    expect(prepared.changeMode({ ui: { font: {} } }, { ui: { font: { size: 1 } } })).toBe(
      'immediate',
    );
    expect(prepared.changeMode({}, { theme: 'dark' })).toBe('immediate');
    expect(prepared.changeMode({ theme: 'dark' }, {})).toBe('immediate');
    expect(prepared.changeMode({ servers: ['a'] }, { servers: ['a', 'b'] })).toBe('reload');
  });

  it('takes the strongest mode across all changes', () => {
    const prepared = definition();
    expect(prepared.changeMode({ theme: 'a', volume: 1 }, { theme: 'b', volume: 2 })).toBe(
      'reload',
    );
    expect(
      prepared.changeMode({ volume: 1, ui: { density: 'a' } }, { volume: 2, ui: { density: 'b' } }),
    ).toBe('restart');
    expect(
      prepared.changeMode(
        { theme: 'a', volume: 1, ui: { density: 'a' } },
        { theme: 'b', volume: 2, ui: { density: 'b' } },
      ),
    ).toBe('restart');
    expect(
      prepared.changeMode(
        { ui: { font: { size: 1 }, density: 'a' } },
        { ui: { font: { size: 2 }, density: 'b' } },
      ),
    ).toBe('restart');
  });

  it('treats a replaced subtree as a change at that pointer', () => {
    const prepared = definition();
    expect(prepared.changeMode({ ui: { density: 'a' } }, { ui: 'broken' })).toBe('restart');
    expect(prepared.changeMode({}, { ui: {} })).toBe('restart');
  });

  it('does not mutate the compared snapshots', () => {
    const prepared = definition();
    const before: JsonObject = { theme: 'a', ui: { density: 'a' } };
    const after: JsonObject = { theme: 'b', ui: { density: 'b' } };
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);
    expect(prepared.changeMode(before, after)).toBe('restart');
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });

  it('applies a mode declared on an array pointer to the whole array', () => {
    const prepared = preparedOf(
      closedObject({ servers: { type: 'array', items: { type: 'string' } } }),
      { apply: { servers: 'restart' } },
    );
    expect(fieldOf(prepared, '/servers').apply).toBe('restart');
    expect(prepared.changeMode({ servers: [] }, { servers: ['a'] })).toBe('restart');
  });
});
