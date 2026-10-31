import { afterEach, expect, it, vi } from 'vitest';
import { respondCompatible, testModelConnection } from './responses.mjs';
import type { JsonObject } from '@pet/contracts';
afterEach(() => vi.unstubAllGlobals());
it('reuses the full Cortico Chat transport for tool calls and metering without exposing credentials', async () => {
  let body: Record<string, unknown> | undefined;
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer test-native-key');
    body = JSON.parse(options.body as string) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-fixture',
        object: 'chat.completion',
        model: 'deepseek-chat',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'configure_pet', arguments: '{"changes":{"petName":"Nova"}}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetch);
  const request: JsonObject = {
    model: 'deepseek-chat',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Change name.' }] },
    ],
    tools: [
      {
        type: 'function',
        name: 'configure_pet',
        description: 'Change preferences',
        parameters: { type: 'object' },
      },
    ],
  };
  const result = (await respondCompatible(
    'test-native-key',
    'deepseek-chat',
    request,
    new AbortController().signal,
  )) as JsonObject;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(body?.['model']).toBe('deepseek-chat');
  expect(JSON.stringify(body?.['tools'])).toContain('configure_pet');
  expect(JSON.stringify(result)).not.toContain('test-native-key');
  expect(JSON.stringify((result['response'] as JsonObject)['output'])).toContain('configure_pet');
  expect((result['attempts'] as JsonObject[])[0]?.['meters']).toMatchObject({
    input: 10,
    output: 5,
    total: 15,
  });
});

const probeEndpoint = {
  id: 'fixture',
  baseUrl: 'https://fixture.invalid/v1',
  protocol: 'responses',
} as const;
function probeResponse(status = 'completed', output = true): Response {
  return Response.json({
    id: 'probe-response',
    model: 'draft-model',
    status,
    output: output
      ? [
          {
            type: 'message',
            id: 'probe-message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'OK', annotations: [], logprobs: [] }],
          },
        ]
      : [],
  });
}

it.each(['low', 'medium', 'high'] as const)(
  'sends Chat effort %s through one bounded shared connection probe',
  async (effort) => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://fixture.invalid/v1/chat/completions');
      expect(init.redirect).toBe('error');
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'draft-model',
        max_tokens: 256,
        reasoning_effort: effort,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      });
      return Response.json({
        id: 'chat-probe',
        model: 'draft-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK' },
            finish_reason: 'stop',
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await testModelConnection(
      { ...probeEndpoint, protocol: 'chat' },
      'draft-model',
      'fixture-probe-key',
      new AbortController().signal,
      effort,
    );
    expect(result).toMatchObject({ ok: true, model: 'draft-model' });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result).not.toHaveProperty('reason');
    expect(JSON.stringify(result)).not.toContain('fixture-probe-key');
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.each([undefined, 'default', 'high'] as const)(
  'sends Responses effort %s without changing legacy default requests',
  async (effort) => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://fixture.invalid/v1/responses');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        model: 'draft-model',
        max_output_tokens: 256,
        stream: false,
        store: false,
      });
      expect(body.input).toHaveLength(1);
      expect(body.input[0]).toMatchObject({
        role: 'user',
        content: [{ type: 'input_text', text: 'Reply with OK.' }],
      });
      if (effort === 'high') expect(body.reasoning).toEqual({ effort: 'high' });
      else expect(body).not.toHaveProperty('reasoning');
      return probeResponse();
    });
    vi.stubGlobal('fetch', fetch);
    await expect(
      testModelConnection(
        probeEndpoint,
        'draft-model',
        'fixture-probe-key',
        new AbortController().signal,
        effort,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it('lets the probe argument override endpoint effort and normal replies use the endpoint setting', async () => {
  const efforts: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      efforts.push(body.reasoning.effort);
      return probeResponse();
    }),
  );
  const endpoint = { ...probeEndpoint, reasoningEffort: 'low' } as const;
  await respondCompatible(
    'fixture-probe-key',
    'draft-model',
    { input: [], reasoning: { effort: 'medium' } },
    new AbortController().signal,
    endpoint,
  );
  await testModelConnection(
    endpoint,
    'draft-model',
    'fixture-probe-key',
    new AbortController().signal,
    'high',
  );
  expect(efforts).toEqual(['low', 'high']);
});

it.each([
  [401, 'auth-failed'],
  [403, 'auth-failed'],
  [429, 'rate-limited'],
  [408, 'timeout'],
  [500, 'network'],
] as const)(
  'reports shared probe HTTP %s as %s without leaking error bodies or retrying',
  async (status, reason) => {
    const fetch = vi.fn(
      async () => new Response('PRIVATE_PROBE_BODY fixture-probe-key', { status }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await testModelConnection(
      probeEndpoint,
      'draft-model',
      'fixture-probe-key',
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROBE_BODY');
    expect(JSON.stringify(result)).not.toContain('fixture-probe-key');
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ['completed', false],
  ['incomplete', true],
] as const)(
  'does not claim a connection for a %s response with output=%s',
  async (status, output) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => probeResponse(status, output)),
    );
    await expect(
      testModelConnection(
        probeEndpoint,
        'draft-model',
        'fixture-probe-key',
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      model: 'draft-model',
      reason: '模型没有完成连接测试',
    });
  },
);

it('rejects unsupported effort mappings and invalid model inputs without sending a probe', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    testModelConnection(
      probeEndpoint,
      'x'.repeat(129),
      'fixture-probe-key',
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ ok: false, reason: 'invalid-input' });
  await expect(
    respondCompatible(
      'fixture-probe-key',
      'draft-model',
      { input: [] },
      new AbortController().signal,
      { ...probeEndpoint, protocol: 'unsupported' } as never,
      true,
    ),
  ).rejects.toMatchObject({ code: 'invalid-input' });
  await expect(
    testModelConnection(
      { ...probeEndpoint, reasoningEffort: 'unsupported' } as never,
      'draft-model',
      'fixture-probe-key',
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ ok: false, reason: 'invalid-input' });
  expect(fetch).not.toHaveBeenCalled();
});

it('honors caller cancellation before sending and during a probe without returning transport detail', async () => {
  const controller = new AbortController();
  let notify = () => {};
  const started = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const fetch = vi.fn(
    async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT_DETAIL')), {
          once: true,
        });
        notify();
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const pending = testModelConnection(
    probeEndpoint,
    'draft-model',
    'fixture-probe-key',
    controller.signal,
  );
  await started;
  controller.abort();
  await expect(pending).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
  await expect(
    testModelConnection(probeEndpoint, 'draft-model', 'fixture-probe-key', controller.signal),
  ).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
