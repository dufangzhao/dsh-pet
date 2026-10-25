import { describe, expect, it, vi } from 'vitest';
import { createPluginHostServices } from './host.js';
import type {
  PluginConfigSnapshot,
  PluginHostPort,
  PluginMediaReader,
  PluginMediaWriter,
  PluginTask,
} from './index.js';
import type { JsonValue, OwnerRef, Result } from '@pet/contracts';

const owner: OwnerRef = {
  pluginId: 'official.voice-chat',
  instanceId: 'instance-1',
  generation: 1,
};

/** 只用于测试的合成凭据；不含任何真实 Key。 */
const SECRET = 'sk-synthetic-credential-value';

function task(overrides: Partial<PluginTask> = {}): PluginTask {
  return { taskId: 'task-1', signal: new AbortController().signal, ...overrides };
}

function snapshot(): PluginConfigSnapshot {
  return {
    pluginId: owner.pluginId,
    instanceId: owner.instanceId,
    schemaVersion: 1,
    revision: 1,
    data: {},
  };
}

const reader: PluginMediaReader = {
  reference: { streamId: 'stream-1', taskId: 'task-1', owner: { ...owner } },
  async *[Symbol.asyncIterator]() {},
  cancel() {},
};

const writer: PluginMediaWriter = {
  reference: { streamId: 'stream-1', taskId: 'task-1', owner: { ...owner } },
  async write() {
    return { ok: true, value: null };
  },
  async end() {
    return { ok: true, value: null };
  },
  cancel() {},
};

const notReady = {
  ok: false,
  error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: false },
} as const;

/** 不含凭据端口的基础 port：用于确认旧表面完全不变。 */
function basePort(): PluginHostPort {
  return {
    async getConfig() {
      return { ok: true, value: snapshot() };
    },
    async invoke() {
      return { ok: true, value: null };
    },
    async openInput() {
      return { ok: true, value: reader };
    },
    async openOutput() {
      return { ok: true, value: writer };
    },
  };
}

/** 带凭据端口的 port：withSecret 行为由每个用例注入。 */
function secretPort(withSecret: NonNullable<PluginHostPort['withSecret']>): PluginHostPort {
  return { ...basePort(), withSecret };
}

function scope(signal: AbortSignal = new AbortController().signal) {
  return { owner, signal };
}

function expectFailure(result: Result<JsonValue>, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe(code);
}

describe('credentials surface is opt-in', () => {
  it('keeps the exact four fields when the port has no withSecret', () => {
    const services = createPluginHostServices(scope(), basePort());
    expect(Object.keys(services).sort()).toEqual(['capabilities', 'config', 'media', 'version']);
    expect('credentials' in services).toBe(false);
    expect(services.credentials).toBeUndefined();
  });

  it('adds a frozen credentials object exposing only withSecret', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, new AbortController().signal),
      })),
    );
    expect(Object.keys(services).sort()).toEqual([
      'capabilities',
      'config',
      'credentials',
      'media',
      'version',
    ]);
    expect(services.credentials).toBeDefined();
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expect(Object.keys(credentials)).toEqual(['withSecret']);
    expect(Object.isFrozen(credentials)).toBe(true);
    expect(Object.isFrozen(services)).toBe(true);
  });

  it('never exposes the management plane', () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async () => notReady),
    );
    const credentials = services.credentials as unknown as Record<string, unknown>;
    for (const forbidden of [
      'setSecret',
      'deleteSecret',
      'repairSecret',
      'authorize',
      'namespace',
    ]) {
      expect(forbidden in credentials).toBe(false);
      expect(credentials[forbidden]).toBeUndefined();
    }
  });

  it.each([
    ['a non-function value', 1],
    ['null', null],
    ['an accessor', undefined],
  ])('rejects a port whose withSecret is %s', (_label, value) => {
    const port = { ...basePort() } as unknown as Record<string, unknown>;
    if (value === undefined) {
      Object.defineProperty(port, 'withSecret', {
        enumerable: true,
        get() {
          throw new Error('getter must not run');
        },
      });
    } else {
      port['withSecret'] = value;
    }
    expect(() => createPluginHostServices(scope(), port as unknown as PluginHostPort)).toThrow(
      TypeError,
    );
  });

  it('rejects an inherited withSecret instead of silently degrading', () => {
    const port = Object.create({ withSecret: async () => notReady }) as PluginHostPort;
    Object.assign(port, basePort());
    expect(() => createPluginHostServices(scope(), port)).toThrow(TypeError);
  });

  it('rejects a port prototype that is a Proxy without running its traps', () => {
    const trap = vi.fn();
    const prototype = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          trap();
          throw new Error('private');
        },
      },
    );
    const port = Object.create(prototype) as PluginHostPort;
    Object.assign(port, basePort());
    expect(() => createPluginHostServices(scope(), port)).toThrow(TypeError);
    expect(trap).not.toHaveBeenCalled();
  });

  it('does not run a shadowed withSecret getter while probing', () => {
    const getter = vi.fn(() => async () => notReady);
    const port = basePort() as unknown as Record<string, unknown>;
    Object.defineProperty(port, 'withSecret', { enumerable: true, get: getter });
    expect(() => createPluginHostServices(scope(), port as unknown as PluginHostPort)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('credentials.withSecret binds identity and validates arguments', () => {
  it('passes the bound owner, checked task and keyId to the port', async () => {
    const seen: unknown[] = [];
    const services = createPluginHostServices(
      scope(),
      secretPort(async (...args) => {
        seen.push(args.slice(0, 3));
        const operation = args[3] as (secret: string, signal: AbortSignal) => Promise<JsonValue>;
        return { ok: true, value: await operation(SECRET, new AbortController().signal) };
      }),
    );
    const t = task();
    const result = await (
      services.credentials as NonNullable<typeof services.credentials>
    ).withSecret(t, 'api-key', async () => ({ ok: true }));
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(seen).toHaveLength(1);
    const [passedOwner, passedTask, keyId] = seen[0] as unknown[];
    expect(passedOwner).toEqual(owner);
    expect(passedOwner).not.toBe(owner);
    expect((passedTask as PluginTask).taskId).toBe('task-1');
    expect(keyId).toBe('api-key');
  });

  it('rejects a bad keyId, a non-function operation and a bad task before calling the port', async () => {
    const call = vi.fn(async () => notReady as Result<JsonValue>);
    const services = createPluginHostServices(scope(), secretPort(call));
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task(), 'bad id' as never, async () => null),
      'invalid-input',
    );
    expectFailure(await credentials.withSecret(task(), 'api-key', 1 as never), 'invalid-input');
    expectFailure(
      await credentials.withSecret(
        { taskId: 'task-1', signal: {} as AbortSignal },
        'api-key',
        async () => null,
      ),
      'invalid-input',
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('rejects a proxied operation without running its traps', async () => {
    const trap = vi.fn();
    const operation = new Proxy(async () => null, {
      get() {
        trap();
        return undefined;
      },
      apply() {
        trap();
        return Promise.resolve(null);
      },
    });
    const call = vi.fn(async () => notReady as Result<JsonValue>);
    const services = createPluginHostServices(scope(), secretPort(call));
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task(), 'api-key', operation as never),
      'invalid-input',
    );
    expect(trap).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
});

describe('credentials.withSecret propagates cancellation and deadlines', () => {
  it('refuses a cancelled scope without calling the port', async () => {
    const controller = new AbortController();
    controller.abort();
    const call = vi.fn(async () => notReady as Result<JsonValue>);
    const services = createPluginHostServices(scope(controller.signal), secretPort(call));
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', async () => null), 'cancelled');
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses a task whose own signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const call = vi.fn(async () => notReady as Result<JsonValue>);
    const services = createPluginHostServices(scope(), secretPort(call));
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(
        task({ signal: controller.signal }),
        'api-key',
        async () => null,
      ),
      'cancelled',
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('refuses an expired deadline before calling the port', async () => {
    const call = vi.fn(async () => notReady as Result<JsonValue>);
    const services = createPluginHostServices(scope(), secretPort(call));
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task({ deadline: 0 }), 'api-key', async () => null),
      'timeout',
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('drops a late result when the task is cancelled during the call', async () => {
    const controller = new AbortController();
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => {
        const value = await operation(SECRET, new AbortController().signal);
        controller.abort();
        return { ok: true, value };
      }),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task({ signal: controller.signal }), 'api-key', async () => 'x'),
      'cancelled',
    );
  });

  it('drops a late result when the scope is cancelled during the call', async () => {
    const controller = new AbortController();
    const services = createPluginHostServices(
      scope(controller.signal),
      secretPort(async (_owner, _task, _keyId, operation) => {
        const value = await operation(SECRET, new AbortController().signal);
        controller.abort();
        return { ok: true, value };
      }),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', async () => 'x'), 'cancelled');
  });
});

describe('the wrapper validates the raw value and the native signal', () => {
  it.each([
    ['empty', ''],
    ['control characters', 'line\nbreak'],
    ['a NUL byte', 'nul\u0000byte'],
    ['oversized', 'x'.repeat(16 * 1024 + 1)],
    ['a lone surrogate', '\ud800'],
  ])('refuses %s without executing the plugin callback', async (_label, secret) => {
    const callback = vi.fn(async () => 'reached');
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(secret, new AbortController().signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', callback), 'invalid-input');
    expect(callback).not.toHaveBeenCalled();
  });

  it('refuses a non-native or forged signal', async () => {
    const callback = vi.fn(async () => 'reached');
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, {} as AbortSignal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', callback), 'invalid-input');
    expect(callback).not.toHaveBeenCalled();
  });

  it('refuses a proxied native signal', async () => {
    const callback = vi.fn(async () => 'reached');
    const signal = new Proxy(new AbortController().signal, {});
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', callback), 'invalid-input');
    expect(callback).not.toHaveBeenCalled();
  });

  it('refuses when the signal handed to the wrapper is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const callback = vi.fn(async () => 'reached');
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, controller.signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', callback), 'cancelled');
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('the callback result is preflighted, frozen and scanned', () => {
  it('returns a frozen deep copy of the plugin callback value', async () => {
    const value = { nested: { list: [1, 2, 3] } };
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, new AbortController().signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    const result = await credentials.withSecret(task(), 'api-key', async () => value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(value);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('refuses a callback value that echoes the raw secret', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, new AbortController().signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task(), 'api-key', async (secret) => ({ echoed: secret })),
      'invalid-input',
    );
  });

  it('refuses URL-encoded and Base64 forms, and secret-shaped keys', async () => {
    const encoded = encodeURIComponent(SECRET);
    const base64 = Buffer.from(SECRET, 'utf8').toString('base64');
    for (const bypass of [encoded, base64]) {
      const services = createPluginHostServices(
        scope(),
        secretPort(async (_owner, _task, _keyId, operation) => ({
          ok: true,
          value: await operation(SECRET, new AbortController().signal),
        })),
      );
      const credentials = services.credentials as NonNullable<typeof services.credentials>;
      expectFailure(
        await credentials.withSecret(task(), 'api-key', async () => ({ data: bypass })),
        'invalid-input',
      );
    }
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, new AbortController().signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task(), 'api-key', async () => ({ [SECRET]: true })),
      'invalid-input',
    );
  });

  it('refuses an accessor, a Proxy or an oversized callback value without executing it', async () => {
    const getter = vi.fn(() => 'read');
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'value', { enumerable: true, get: getter });
    // 只统计真正的读取/枚举 trap：把回调返回值当 Promise 解析时，语言本身会读一次
    // `then`，那不是预检在反射数据。
    const trap = vi.fn();
    const proxied = new Proxy(
      { a: 1 },
      {
        get(_target, key) {
          if (key !== 'then') trap();
          return 1;
        },
        ownKeys() {
          trap();
          return [];
        },
        getOwnPropertyDescriptor() {
          trap();
          return undefined;
        },
      },
    );
    const cases = [accessor, proxied, 'x'.repeat(70_000)] as unknown[];
    for (const bad of cases) {
      const services = createPluginHostServices(
        scope(),
        secretPort(async (_owner, _task, _keyId, operation) => ({
          ok: true,
          value: await operation(SECRET, new AbortController().signal),
        })),
      );
      const credentials = services.credentials as NonNullable<typeof services.credentials>;
      expectFailure(
        await credentials.withSecret(task(), 'api-key', async () => bad as JsonValue),
        'invalid-input',
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
  });

  it('maps a throwing callback to a fixed internal error without echoing it', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, new AbortController().signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    const result = await credentials.withSecret(task(), 'api-key', async (secret) => {
      throw new Error('boom ' + secret);
    });
    expectFailure(result, 'internal');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('boom');
  });

  it('refuses a late callback value when the signal is aborted mid-operation', async () => {
    const controller = new AbortController();
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => ({
        ok: true,
        value: await operation(SECRET, controller.signal),
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task(), 'api-key', async () => {
        controller.abort();
        return { late: true };
      }),
      'cancelled',
    );
  });
});

describe('the port cannot bypass the wrapper', () => {
  it('refuses a port that skips the wrapper but reports success', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async () => ({ ok: true, value: { forged: true } })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', async () => 'x'), 'unavailable');
  });

  it('refuses a port that calls the wrapper twice', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => {
        const first = await operation(SECRET, new AbortController().signal);
        const second = await operation(SECRET, new AbortController().signal).catch(() => null);
        return { ok: true, value: second ?? first };
      }),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', async () => 'x'), 'unavailable');
  });

  it('refuses a port that reports success with a different value', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => {
        await operation(SECRET, new AbortController().signal);
        return { ok: true, value: { substituted: true } };
      }),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', async () => 'x'), 'unavailable');
  });

  it('refuses a port that swallows a wrapper refusal and reports success', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => {
        await operation(SECRET, new AbortController().signal).catch(() => null);
        return { ok: true, value: { forged: true } };
      }),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task(), 'api-key', async () => ({ echoed: SECRET })),
      'invalid-input',
    );
  });

  it('passes a fixed port error through without echoing its message', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async () => ({
        ok: false,
        error: {
          code: 'permission-denied',
          messageKey: 'errors.permission-denied',
          retryable: false,
        },
      })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(
      await credentials.withSecret(task(), 'api-key', async () => 'x'),
      'permission-denied',
    );
  });

  it('maps a throwing port to a fixed error and never leaks the exception', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async () => {
        throw new Error('transport failed with ' + SECRET);
      }),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    const result = await credentials.withSecret(task(), 'api-key', async () => 'x');
    expectFailure(result, 'unavailable');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('transport failed');
  });

  it('rejects a malformed port Result instead of inventing success', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async (_owner, _task, _keyId, operation) => {
        const value = await operation(SECRET, new AbortController().signal);
        return { ok: true, value, extra: 1 } as unknown as Result<JsonValue>;
      }),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', async () => 'x'), 'unavailable');
  });
});

describe('the real host shape stays accepted', () => {
  /**
   * 模拟 host-kernel 的接线：端口把包装回调原样交给 SensitivePeer.accept，
   * 用 `AbortSignal.any` 派生复合 signal，并把包装交付的同一个结果作为 value。
   */
  function sensitivePort(): { port: PluginHostPort; calls: string[] } {
    const calls: string[] = [];
    const port: PluginHostPort = {
      ...basePort(),
      async withSecret(_owner, _task, keyId, operation) {
        calls.push('withSecret:' + keyId);
        const composite = AbortSignal.any([
          new AbortController().signal,
          new AbortController().signal,
        ]);
        const value = await operation(SECRET, composite);
        return { ok: true, value };
      },
    };
    return { port, calls };
  }

  it('accepts a composite native signal and the identity value', async () => {
    const { port, calls } = sensitivePort();
    const services = createPluginHostServices(scope(), port);
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    const seen: string[] = [];
    const result = await credentials.withSecret(task(), 'api-key', async (secret, signal) => {
      seen.push(secret);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      return { ok: true, length: secret.length };
    });
    expect(result).toEqual({ ok: true, value: { ok: true, length: SECRET.length } });
    expect(seen).toEqual([SECRET]);
    expect(calls).toEqual(['withSecret:api-key']);
  });

  it('accepts a null callback value as a legitimate success', async () => {
    const { port } = sensitivePort();
    const services = createPluginHostServices(scope(), port);
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expect(await credentials.withSecret(task(), 'api-key', async () => null)).toEqual({
      ok: true,
      value: null,
    });
  });

  it('keeps the raw value out of every observable surface', async () => {
    const { port } = sensitivePort();
    const services = createPluginHostServices(scope(), port);
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    const result = await credentials.withSecret(task(), 'api-key', async () => ({ ok: true }));
    expect(JSON.stringify(services)).not.toContain(SECRET);
    expect(JSON.stringify(credentials)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('still refuses a port that resolves success without running the callback', async () => {
    const services = createPluginHostServices(
      scope(),
      secretPort(async () => ({ ok: true, value: null })),
    );
    const credentials = services.credentials as NonNullable<typeof services.credentials>;
    expectFailure(await credentials.withSecret(task(), 'api-key', async () => null), 'unavailable');
  });
});
