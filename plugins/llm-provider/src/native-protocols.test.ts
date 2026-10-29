import type { JsonObject } from '@pet/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { respondCompatible } from './responses.mjs';
afterEach(() => vi.unstubAllGlobals());
it('uses native Anthropic messages and preserves full tool calls and measured usage', async () => {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://fixture.invalid/v1/messages');
    expect(new Headers(init.headers).get('x-api-key')).toBe('fixture-secret');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(256);
    expect(body.tools[0].input_schema).toEqual({ type: 'object' });
    return new Response(
      JSON.stringify({
        id: 'm1',
        model: 'fixture-model',
        content: [{ type: 'tool_use', id: 't1', name: 'pet_say', input: { text: 'Hello' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetch);
  const result = (await respondCompatible(
    'fixture-secret',
    'fixture-model',
    {
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
      tools: [{ type: 'function', name: 'pet_say', parameters: { type: 'object' } }],
    },
    new AbortController().signal,
    { id: 'fixture-a', baseUrl: 'https://fixture.invalid', protocol: 'anthropic' },
    true,
  )) as { response: { output: JsonObject[] }; attempts: { meters: JsonObject }[] };
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.response.output[0]).toMatchObject({
    type: 'function_call',
    call_id: 't1',
    name: 'pet_say',
  });
  expect(result.attempts[0]?.meters).toMatchObject({ input: 12, output: 7 });
  expect(JSON.stringify(result)).not.toContain('fixture-secret');
});
it('uses native Gemini content and preserves full reply and measured usage', async () => {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://fixture.invalid/models/fixture-model:generateContent');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('fixture-secret');
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].text).toBe('Hello');
    return new Response(
      JSON.stringify({
        responseId: 'r1',
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Hello there' }] }, finishReason: 'STOP' },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetch);
  const result = (await respondCompatible(
    'fixture-secret',
    'fixture-model',
    {
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
    },
    new AbortController().signal,
    { id: 'fixture-g', baseUrl: 'https://fixture.invalid', protocol: 'gemini' },
    true,
  )) as { response: { output: JsonObject[] }; attempts: { meters: JsonObject }[] };
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result.response.output)).toContain('Hello there');
  expect(result.attempts[0]?.meters).toMatchObject({ input: 10, output: 3, total: 13 });
  expect(JSON.stringify(result)).not.toContain('fixture-secret');
});
it('replays a Gemini tool signature from canonical reasoning without a second history', async () => {
  let call = 0;
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (call++ === 0)
      return Response.json({
        responseId: 'r1',
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  thoughtSignature: 'fixture-opaque-signature',
                  functionCall: { name: 'pet_say', args: { text: 'Hello' } },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
      });
    expect(
      body.contents[0].parts.find((part: { functionCall?: unknown }) => part.functionCall)
        .thoughtSignature,
    ).toBe('fixture-opaque-signature');
    expect(body.contents[1].parts[0].functionResponse).toMatchObject({
      name: 'pet_say',
      response: { ok: true },
    });
    return Response.json({
      responseId: 'r2',
      candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2, totalTokenCount: 14 },
    });
  });
  vi.stubGlobal('fetch', fetch);
  const endpoint = { id: 'fixture-g', baseUrl: 'https://fixture.invalid', protocol: 'gemini' };
  const first = (await respondCompatible(
    'fixture-secret',
    'fixture-model',
    {
      input: [{ type: 'message', role: 'user', content: 'Hello' }],
      tools: [{ type: 'function', name: 'pet_say', parameters: { type: 'object' } }],
    },
    new AbortController().signal,
    endpoint,
  )) as { response: { output: JsonObject[] }; origin: JsonObject };
  const reasoning = first.response.output.find((item) => item['type'] === 'reasoning')!;
  const tool = first.response.output.find((item) => item['type'] === 'function_call')!;
  expect(reasoning['encrypted_content']).toBe('fixture-opaque-signature');
  const second = (await respondCompatible(
    'fixture-secret',
    'fixture-model',
    {
      input: [
        ...first.response.output,
        { type: 'function_call_output', call_id: tool['call_id']!, output: '{"ok":true}' },
      ],
    },
    new AbortController().signal,
    endpoint,
    false,
    [{ id: reasoning['id']!, origin: first.origin }],
  )) as { response: { output: JsonObject[] } };
  expect(JSON.stringify(second.response.output)).toContain('Done');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not fabricate zero token usage when the native provider omits its usage receipt', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        responseId: 'no-usage',
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' },
        ],
      }),
    ),
  );
  const result = (await respondCompatible(
    'fixture-secret',
    'fixture-model',
    { input: [{ type: 'message', role: 'user', content: 'Hi' }] },
    new AbortController().signal,
    { id: 'fixture-no-usage', baseUrl: 'https://fixture.invalid', protocol: 'gemini' },
    true,
  )) as { response: { usage: unknown }; attempts: { meters: JsonObject }[] };
  expect(result.response.usage).toBeNull();
  expect(result.attempts[0]?.meters).toMatchObject({ input: null, output: null, total: null });
});
