import { afterEach, expect, it, vi } from 'vitest';
import { respondCompatible } from './responses.mjs';
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
