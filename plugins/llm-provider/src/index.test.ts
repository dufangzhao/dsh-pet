import { afterEach, expect, it, vi } from 'vitest';
import type { JsonValue, Result } from '@pet/contracts';
import { makeError } from '@pet/contracts';
import type { PluginContext, PluginTask } from '@pet/plugin-sdk';
import plugin from './index.js';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
async function fixture() {
  let respond!: (task: PluginTask, input: JsonValue) => Promise<JsonValue>;
  const chunks: string[] = [];
  const owner = { pluginId: 'pet.llm-provider', instanceId: 'default', generation: 1 };
  const context: PluginContext = {
    owner,
    signal: new AbortController().signal,
    config: {},
    provide(_id, methods) {
      respond = methods['respond']!;
    },
    contribute() {},
    effect() {},
    host: {
      version: 1,
      config: {
        get: async () => ({
          ok: true,
          value: {
            pluginId: owner.pluginId,
            instanceId: 'default',
            schemaVersion: 1,
            revision: 1,
            data: { model: 'deepseek-chat' },
          },
        }),
      },
      capabilities: { invoke: async () => ({ ok: false, error: makeError('not-ready', false) }) },
      media: {
        openInput: async () => ({ ok: false, error: makeError('not-ready', false) }),
        openOutput: async () => ({
          ok: true,
          value: {
            reference: { streamId: 'text', taskId: 'task', owner },
            async write(bytes) {
              chunks.push(new TextDecoder().decode(bytes));
              return { ok: true, value: null };
            },
            async end() {
              return { ok: true, value: null };
            },
            cancel() {},
          },
        }),
      },
      credentials: {
        async withSecret(task, keyId, operation): Promise<Result<JsonValue>> {
          expect(keyId).toBe('api-key');
          return { ok: true, value: await operation('fixture-not-a-real-key', task.signal) };
        },
      },
    },
  };
  await plugin.activate(context);
  const task = { taskId: 'task', signal: new AbortController().signal };
  return { respond, chunks, task };
}
function events(values: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const value of values) controller.enqueue(new TextEncoder().encode(value));
        controller.close();
      },
    }),
    { status: 200 },
  );
}
it('streams actual SSE content using the credential callback and a fixed HTTPS target', async () => {
  const f = await fixture();
  const fetch = vi.fn(async (url, options) => {
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options?.headers).toMatchObject({ authorization: 'Bearer fixture-not-a-real-key' });
    return events([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n',
    ]);
  });
  globalThis.fetch = fetch;
  expect(await f.respond(f.task, { text: '测试', context: [] })).toEqual({
    text: '你好',
    mode: 'deepseek',
    errorCode: null,
  });
  expect(f.chunks.join('')).toBe('你好');
  expect(fetch).toHaveBeenCalledOnce();
});
it('does not manufacture a completed reply when the SSE stream is truncated', async () => {
  const f = await fixture();
  globalThis.fetch = vi.fn(async () =>
    events(['data: {"choices":[{"delta":{"content":"未完成"}}]}\n\n']),
  );
  expect(await f.respond(f.task, { text: '测试' })).toEqual({
    text: '',
    mode: 'deepseek',
    errorCode: 'network',
  });
  expect(f.chunks.join('')).toBe('未完成');
});
it('reports rejected credentials without leaking an HTTP body', async () => {
  const f = await fixture();
  globalThis.fetch = vi.fn(async () => new Response('PRIVATE_HTTP_BODY', { status: 401 }));
  const result = await f.respond(f.task, { text: '测试' });
  expect(result).toEqual({ text: '', mode: 'deepseek', errorCode: 'auth-failed' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_HTTP_BODY');
  expect(f.chunks).toEqual([]);
});
