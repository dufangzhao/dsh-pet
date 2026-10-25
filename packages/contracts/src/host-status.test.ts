import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Result } from './errors.js';
import type { HostRuntimeState, HostStatus, HostStatusBridge } from './host-status.js';
import { HOST_IPC, HOST_RUNTIME_STATES, HOST_STATUS_SCHEMA } from './host-status.js';
import * as root from './index.js';

/**
 * The Ajv instance lives here, in the test file only: the root entry exports
 * Schema *data* and never compiles it on import.
 */
const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false });
const validate = ajv.compile(HOST_STATUS_SCHEMA);

const validStatus = (): HostStatus => ({
  version: 1,
  runtime: 'ready',
  installedPlugins: 4,
  activePlugins: 2,
  unreadyPlugins: 1,
  pendingRestartPlugins: 1,
  runningTasks: 3,
  pendingWork: 7,
});

const COUNT_FIELDS = [
  'installedPlugins',
  'activePlugins',
  'unreadyPlugins',
  'pendingRestartPlugins',
  'runningTasks',
  'pendingWork',
] as const;

const STATUS_FIELDS = ['version', 'runtime', ...COUNT_FIELDS] as const;

describe('host status vocabulary', () => {
  it('exposes exactly one fixed read-only channel', () => {
    expect(HOST_IPC).toEqual({ status: 'host:v1:status' });
    expect(Object.keys(HOST_IPC)).toEqual(['status']);
  });

  it('declares the four runtime states in order', () => {
    expect([...HOST_RUNTIME_STATES]).toEqual(['starting', 'ready', 'failed', 'stopped']);
  });

  it('is re-exported from the browser-safe root entry', () => {
    expect(root.HOST_IPC).toBe(HOST_IPC);
    expect(root.HOST_RUNTIME_STATES).toBe(HOST_RUNTIME_STATES);
    expect(root.HOST_STATUS_SCHEMA).toBe(HOST_STATUS_SCHEMA);
  });
});

describe('HOST_STATUS_SCHEMA is plain Schema data', () => {
  it('round-trips as JSON with no dynamic or cross-Schema keywords', () => {
    const clone = JSON.parse(JSON.stringify(HOST_STATUS_SCHEMA)) as unknown;
    expect(clone).toEqual(HOST_STATUS_SCHEMA);
    const text = JSON.stringify(HOST_STATUS_SCHEMA);
    for (const keyword of ['$ref', '$dynamicRef', '$dynamicAnchor', '$recursiveRef']) {
      expect(text).not.toContain(keyword);
    }
  });

  it('is a closed object requiring every status field', () => {
    expect(HOST_STATUS_SCHEMA['additionalProperties']).toBe(false);
    expect([...(HOST_STATUS_SCHEMA['required'] as string[])].sort()).toEqual(
      [...STATUS_FIELDS].sort(),
    );
    expect(Object.keys(HOST_STATUS_SCHEMA['properties'] as object).sort()).toEqual(
      [...STATUS_FIELDS].sort(),
    );
  });

  it('bounds every counter to a non-negative safe integer', () => {
    const properties = HOST_STATUS_SCHEMA['properties'] as Record<string, Record<string, unknown>>;
    for (const field of COUNT_FIELDS) {
      expect(properties[field]).toMatchObject({
        type: 'integer',
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
      });
    }
  });

  it('compiles no code on import: the root entry exposes data only', async () => {
    const module = await import('./host-status.js');
    expect(Object.keys(module).sort()).toEqual([
      'HOST_IPC',
      'HOST_RUNTIME_STATES',
      'HOST_STATUS_SCHEMA',
    ]);
    expect(Object.values(module).every((value) => typeof value !== 'function')).toBe(true);
  });
});

describe('HOST_STATUS_SCHEMA: accepted statuses', () => {
  it.each([...HOST_RUNTIME_STATES])('accepts runtime state %s', (runtime) => {
    const status = { ...validStatus(), runtime };
    expect(validate(status), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts zero counters', () => {
    const status = validStatus();
    for (const field of COUNT_FIELDS) status[field] = 0;
    expect(validate(status)).toBe(true);
  });

  it('accepts the maximum safe integer', () => {
    const status = validStatus();
    for (const field of COUNT_FIELDS) status[field] = Number.MAX_SAFE_INTEGER;
    expect(validate(status)).toBe(true);
  });
});

describe('HOST_STATUS_SCHEMA: rejected statuses', () => {
  it.each([...STATUS_FIELDS])('rejects a status missing %s', (field) => {
    const status = validStatus() as unknown as Record<string, unknown>;
    delete status[field];
    expect(validate(status)).toBe(false);
  });

  it.each([
    ['an unknown extra field', { ...validStatus(), sessionId: 's-1' }],
    ['an unknown nested field', { ...validStatus(), extra: { runtime: 'ready' } }],
  ])('rejects %s', (_label, status) => {
    expect(validate(status)).toBe(false);
  });

  it.each([
    ['version 2', { ...validStatus(), version: 2 }],
    ['version 0', { ...validStatus(), version: 0 }],
    ['string version', { ...validStatus(), version: '1' }],
    ['null version', { ...validStatus(), version: null }],
    ['missing version', { ...validStatus(), version: undefined }],
  ])('rejects %s', (_label, status) => {
    expect(validate(status)).toBe(false);
  });

  it.each([['idle'], ['recording'], [''], [1], [null], [true], [['ready']]])(
    'rejects undeclared runtime value %j',
    (runtime) => {
      expect(validate({ ...validStatus(), runtime })).toBe(false);
    },
  );

  it.each(COUNT_FIELDS)('rejects a negative %s', (field) => {
    expect(validate({ ...validStatus(), [field]: -1 })).toBe(false);
  });

  it.each(COUNT_FIELDS)('rejects a fractional %s', (field) => {
    expect(validate({ ...validStatus(), [field]: 1.5 })).toBe(false);
  });

  it.each(COUNT_FIELDS)('rejects an unsafe %s', (field) => {
    expect(validate({ ...validStatus(), [field]: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
  });

  it.each(COUNT_FIELDS)('rejects a non-number %s', (field) => {
    for (const value of ['3', null, true, [], {}]) {
      expect(validate({ ...validStatus(), [field]: value })).toBe(false);
    }
  });

  it.each([[null], [undefined], [[]], ['ready'], [1], [true]])(
    'rejects non-object input %j',
    (value) => {
      expect(validate(value)).toBe(false);
    },
  );
});

describe('HostStatusBridge is read-only and parameterless', () => {
  it('has exactly the version and getStatus members', () => {
    expectTypeOf<keyof HostStatusBridge>().toEqualTypeOf<'version' | 'getStatus'>();
  });

  it('pins the version literal to 1', () => {
    expectTypeOf<HostStatusBridge['version']>().toEqualTypeOf<1>();
    expectTypeOf<HostStatus['version']>().toEqualTypeOf<1>();
  });

  it('takes no arguments and returns Result<HostStatus>', () => {
    expectTypeOf<HostStatusBridge['getStatus']>().toEqualTypeOf<
      () => Promise<Result<HostStatus>>
    >();
    expectTypeOf<Parameters<HostStatusBridge['getStatus']>>().toEqualTypeOf<[]>();
  });

  it('returns a fixed snapshot whose fields are the Schema fields', () => {
    expectTypeOf<keyof HostStatus>().toEqualTypeOf<(typeof STATUS_FIELDS)[number]>();
    expectTypeOf<HostStatus['runtime']>().toEqualTypeOf<HostRuntimeState>();
    expectTypeOf<Pick<HostStatus, (typeof COUNT_FIELDS)[number]>>().toEqualTypeOf<
      Record<(typeof COUNT_FIELDS)[number], number>
    >();
  });

  it('is implementable without any extra member', async () => {
    const status = validStatus();
    const bridge: HostStatusBridge = {
      version: 1,
      getStatus: () => Promise.resolve({ ok: true, value: status }),
    };
    expect(Object.keys(bridge).sort()).toEqual(['getStatus', 'version']);
    await expect(bridge.getStatus()).resolves.toEqual({ ok: true, value: status });
  });
});
