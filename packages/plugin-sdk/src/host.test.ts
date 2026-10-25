import { describe, expect, it } from 'vitest';
import { createPluginHostServices } from './host.js';
import type {
  MediaReference,
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

function task(overrides: Partial<PluginTask> = {}): PluginTask {
  return { taskId: 'task-1', signal: new AbortController().signal, ...overrides };
}

function snapshot(overrides: Partial<PluginConfigSnapshot> = {}): PluginConfigSnapshot {
  return {
    pluginId: owner.pluginId,
    instanceId: owner.instanceId,
    schemaVersion: 1,
    revision: 3,
    data: { language: 'zh-CN' },
    ...overrides,
  };
}

function reference(overrides: Partial<MediaReference> = {}): MediaReference {
  return { streamId: 'stream-1', taskId: 'task-1', owner: { ...owner }, ...overrides };
}

function reader(ref: MediaReference = reference()): PluginMediaReader {
  const chunks = [new Uint8Array([1, 2, 3])];
  return {
    reference: ref,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
    cancel() {},
  };
}

function writer(): PluginMediaWriter {
  return {
    reference: reference(),
    async write() {
      return { ok: true, value: null };
    },
    async end() {
      return { ok: true, value: null };
    },
    cancel() {},
  };
}

/** 纯内存 port：记录调用，按需返回结果，不触碰任何真实传输。 */
function makePort(overrides: Partial<PluginHostPort> = {}): PluginHostPort & {
  calls: string[];
} {
  const calls: string[] = [];
  const port: PluginHostPort = {
    async getConfig() {
      calls.push('getConfig');
      return { ok: true, value: snapshot() };
    },
    async invoke() {
      calls.push('invoke');
      return { ok: true, value: { echoed: true } };
    },
    async openInput() {
      calls.push('openInput');
      return { ok: true, value: reader() };
    },
    async openOutput() {
      calls.push('openOutput');
      return { ok: true, value: writer() };
    },
    ...overrides,
  };
  return Object.assign(port, { calls });
}

describe('the host subpath stays host-only', () => {
  it('imports only contracts, validation and the root entry', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('./host.ts', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    expect(specifiers).toContain('@pet/contracts');
    expect(specifiers).toContain('@pet/contracts/validation');
    for (const specifier of specifiers) {
      const allowed = ['@pet/contracts', '@pet/contracts/validation', 'node:util', './index.js'];
      expect(allowed).toContain(specifier);
    }
  });

  it('is not reachable from the root entry', async () => {
    const root = await import('./index.js');
    expect(Object.keys(root)).toEqual(['definePlugin']);
    expect('createPluginHostServices' in root).toBe(false);
  });
});

describe('createPluginHostServices exposes only frozen services', () => {
  it('freezes the service, its nested services and version', () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort(),
    );
    expect(services.version).toBe(1);
    expect(Object.isFrozen(services)).toBe(true);
    expect(Object.isFrozen(services.config)).toBe(true);
    expect(Object.isFrozen(services.capabilities)).toBe(true);
    expect(Object.isFrozen(services.media)).toBe(true);
  });

  it('never exposes the port or any raw transport surface', () => {
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const keys = Object.keys(services).sort();
    expect(keys).toEqual(['capabilities', 'config', 'media', 'version']);
    const flat = JSON.stringify(Object.keys(services));
    expect(flat).not.toContain('port');
    for (const value of Object.values(services)) {
      expect(value).not.toBe(port);
    }
    expect(services.capabilities).not.toHaveProperty('port');
    expect(services.media).not.toHaveProperty('openInputPort');
    expect((services as unknown as Record<string, unknown>)['port']).toBeUndefined();
  });

  it('rejects an invalid scope synchronously with fixed copy', () => {
    expect(() =>
      createPluginHostServices(
        { owner: { ...owner, generation: 0 }, signal: new AbortController().signal },
        makePort(),
      ),
    ).toThrow(TypeError);
    expect(() =>
      createPluginHostServices({ owner, signal: {} as AbortSignal }, makePort()),
    ).toThrow(TypeError);
    try {
      createPluginHostServices({ owner, signal: null as unknown as AbortSignal }, makePort());
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('invalid plugin host scope');
    }
  });
});

describe('host.config.get copies and freezes the snapshot', () => {
  it('returns a frozen deep copy', async () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort(),
    );
    const result = await services.config.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision).toBe(3);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.data)).toBe(true);
    expect(() => {
      (result.value.data as Record<string, JsonValue>)['language'] = 'en';
    }).toThrow();
  });

  it('does not alias the port value', async () => {
    const source = snapshot();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async getConfig() {
          return { ok: true, value: source };
        },
      }),
    );
    const result = await services.config.get();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(source);
    expect(result.value.data).not.toBe(source.data);
  });

  it('rejects a snapshot bound to another owner', async () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async getConfig() {
          return { ok: true, value: snapshot({ instanceId: 'other' }) };
        },
      }),
    );
    const result = await services.config.get();
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'unavailable' }) });
  });

  it('passes a permission-denied from the port through unchanged', async () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async getConfig() {
          return {
            ok: false,
            error: {
              code: 'permission-denied',
              messageKey: 'errors.permission-denied',
              retryable: false,
            },
          };
        },
      }),
    );
    const result = await services.config.get();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
  });

  it('does not invent a default when the port fails with a malformed Result', async () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async getConfig() {
          return { ok: false } as unknown as Result<PluginConfigSnapshot>;
        },
      }),
    );
    const result = await services.config.get();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unavailable');
  });
});

describe('capabilities.invoke binds identity and copies JSON', () => {
  it('passes the scope owner and the checked task to the port', async () => {
    const seen: unknown[] = [];
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async invoke(...args) {
          seen.push(args);
          return { ok: true, value: { ok: true } };
        },
      }),
    );
    const t = task();
    const result = await services.capabilities.invoke(t, 'speech.asr@1', 'recognize', {
      text: 'hi',
    });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const [passedOwner, passedTask, capability, method] = seen[0] as unknown[];
    expect(passedOwner).toEqual(owner);
    expect(passedOwner).not.toBe(owner);
    expect((passedTask as PluginTask).taskId).toBe('task-1');
    expect(capability).toBe('speech.asr@1');
    expect(method).toBe('recognize');
  });

  it('rejects an invalid capability or method without touching the port', async () => {
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    expect(await services.capabilities.invoke(task(), 'speech.asr', 'x', null)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-input' }),
    });
    expect(await services.capabilities.invoke(task(), 'speech.asr@1', 'bad id', null)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-input' }),
    });
    expect(port.calls).toEqual([]);
  });

  it('returns a frozen deep copy of the port value', async () => {
    const value = { nested: { list: [1, 2, 3] } };
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async invoke() {
          return { ok: true, value };
        },
      }),
    );
    const result = await services.capabilities.invoke(task(), 'llm.chat@1', 'complete', null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(value);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('rejects a non-JSON input before calling the port', async () => {
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const withFn = { bad: () => 1 } as unknown as JsonValue;
    expect(await services.capabilities.invoke(task(), 'llm.chat@1', 'complete', withFn)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-input' }),
    });
    expect(port.calls).toEqual([]);
  });

  it('rejects an input getter without executing it', async () => {
    let executed = false;
    const input = {} as Record<string, unknown>;
    Object.defineProperty(input, 'trap', {
      enumerable: true,
      get() {
        executed = true;
        return 1;
      },
    });
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const result = await services.capabilities.invoke(
      task(),
      'llm.chat@1',
      'complete',
      input as unknown as JsonValue,
    );
    expect(result.ok).toBe(false);
    expect(executed).toBe(false);
    expect(port.calls).toEqual([]);
  });

  it('rejects a Proxy input without running its traps', async () => {
    let trapped = false;
    const input = new Proxy(
      {},
      {
        get() {
          trapped = true;
          return 1;
        },
        ownKeys() {
          trapped = true;
          return [];
        },
        getOwnPropertyDescriptor() {
          trapped = true;
          return undefined;
        },
      },
    );
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const result = await services.capabilities.invoke(
      task(),
      'llm.chat@1',
      'complete',
      input as unknown as JsonValue,
    );
    expect(result.ok).toBe(false);
    expect(trapped).toBe(false);
    expect(port.calls).toEqual([]);
  });

  it('rejects a dangerous key and an oversized payload', async () => {
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const dangerous = JSON.parse('{"__proto__":{"polluted":true}}') as JsonValue;
    expect(await services.capabilities.invoke(task(), 'llm.chat@1', 'complete', dangerous)).toEqual(
      {
        ok: false,
        error: expect.objectContaining({ code: 'invalid-input' }),
      },
    );
    const huge = 'x'.repeat(70_000);
    expect(await services.capabilities.invoke(task(), 'llm.chat@1', 'complete', huge)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-input' }),
    });
    expect(port.calls).toEqual([]);
  });
});

describe('cancellation is checked before and after the port call', () => {
  it('refuses a cancelled scope without calling the port', async () => {
    const controller = new AbortController();
    controller.abort();
    const port = makePort();
    const services = createPluginHostServices({ owner, signal: controller.signal }, port);
    expect(await services.capabilities.invoke(task(), 'llm.chat@1', 'complete', null)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
    expect(await services.config.get()).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'cancelled' }),
    });
    expect(port.calls).toEqual([]);
  });

  it('refuses an identity task whose own signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const result = await services.media.openOutput(task({ signal: controller.signal }));
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
    expect(port.calls).toEqual([]);
  });

  it('drops a late result when the task is cancelled during the call', async () => {
    const controller = new AbortController();
    const port = makePort({
      async invoke() {
        controller.abort();
        return { ok: true, value: { late: true } };
      },
    });
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const result = await services.capabilities.invoke(
      task({ signal: controller.signal }),
      'llm.chat@1',
      'complete',
      null,
    );
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
  });

  it('drops a late result when the scope is cancelled during the call', async () => {
    const controller = new AbortController();
    const port = makePort({
      async openInput() {
        controller.abort();
        return { ok: true, value: reader() };
      },
    });
    const services = createPluginHostServices({ owner, signal: controller.signal }, port);
    const result = await services.media.openInput(task());
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'cancelled' }) });
  });

  it('refuses an expired deadline before calling the port', async () => {
    const port = makePort();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const result = await services.capabilities.invoke(
      task({ deadline: 0 }),
      'llm.chat@1',
      'complete',
      null,
    );
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'timeout' }) });
    expect(port.calls).toEqual([]);
  });
});

describe('port exceptions become fixed errors', () => {
  it('never echoes the original exception', async () => {
    const secret = 'token=abc123';
    const port = makePort({
      async invoke() {
        throw new Error(secret);
      },
    });
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      port,
    );
    const result = await services.capabilities.invoke(task(), 'llm.chat@1', 'complete', null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('maps a throwing config port to unavailable', async () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async getConfig() {
          throw new Error('boom');
        },
      }),
    );
    const result = await services.config.get();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'unavailable',
      messageKey: 'errors.unavailable',
      retryable: true,
    });
  });

  it('rejects a malformed port Result error instead of passing it through', async () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async invoke() {
          return {
            ok: false,
            error: { code: 'internal', messageKey: 'errors.cancelled', retryable: false },
          } as unknown as Result<JsonValue>;
        },
      }),
    );
    const result = await services.capabilities.invoke(task(), 'llm.chat@1', 'complete', null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unavailable');
  });
});

describe('media endpoints keep bytes out of the JSON channel', () => {
  it('wraps the reader without exposing the port object', async () => {
    const inner = reader();
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async openInput() {
          return { ok: true, value: inner };
        },
      }),
    );
    const result = await services.media.openInput(task());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(inner);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.reference.streamId).toBe('stream-1');
    expect(Object.isFrozen(result.value.reference)).toBe(true);
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.value) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0] as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('wraps the writer and keeps write/end results fixed', async () => {
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort(),
    );
    const result = await services.media.openOutput(task());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = new Uint8Array([9, 9, 9]);
    expect(await result.value.write(bytes)).toEqual({ ok: true, value: null });
    expect(await result.value.end()).toEqual({ ok: true, value: null });
    expect(result.value.write).toBeTypeOf('function');
  });

  it('rejects a reference bound to another owner or task', async () => {
    const foreign = reader(reference({ owner: { ...owner, generation: 2 } }));
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async openInput() {
          return { ok: true, value: foreign };
        },
      }),
    );
    const result = await services.media.openInput(task());
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'unavailable' }) });

    const wrongTask = reader(reference({ taskId: 'task-2' }));
    const other = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async openInput() {
          return { ok: true, value: wrongTask };
        },
      }),
    );
    expect(await other.media.openInput(task())).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unavailable' }),
    });
  });

  it('does not serialize bytes through JSON', async () => {
    let received: unknown = null;
    const inner: PluginMediaWriter = {
      reference: reference(),
      async write(payload) {
        received = payload;
        return { ok: true, value: null };
      },
      async end() {
        return { ok: true, value: null };
      },
      cancel() {},
    };
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async openOutput() {
          return { ok: true, value: inner };
        },
      }),
    );
    const opened = await services.media.openOutput(task());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await opened.value.write(bytes);
    expect(received).toBe(bytes);
    expect(JSON.stringify(opened.value.reference)).not.toContain('1,2,3');
  });

  it('maps a writer throwing on write to unavailable', async () => {
    const inner: PluginMediaWriter = {
      reference: reference(),
      async write() {
        throw new Error('socket closed');
      },
      async end() {
        return { ok: true, value: null };
      },
      cancel() {},
    };
    const services = createPluginHostServices(
      { owner, signal: new AbortController().signal },
      makePort({
        async openOutput() {
          return { ok: true, value: inner };
        },
      }),
    );
    const opened = await services.media.openOutput(task());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(await opened.value.write(new Uint8Array([1]))).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unavailable' }),
    });
  });
});
