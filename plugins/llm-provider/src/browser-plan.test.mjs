import { afterEach, expect, it, vi } from 'vitest';
import { register } from 'tsx/esm/api';
import { respondCompatible } from './responses.mjs';
register();
const { createResponse } = await import('cortico/protocol/open-responses/index.ts');
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])(
  'replays only its signed reasoning and retains full plan stream output (%s)',
  async (matching) => {
    const item = {
      type: 'message',
      id: 'm1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'OK', annotations: [], logprobs: [] }],
    };
    const usage = {
      input_tokens: 5,
      output_tokens: 2,
      total_tokens: 7,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    };
    const initial = createResponse('r1', { model: 'fixture-model', input: [] });
    const events = [
      { type: 'response.created', sequence_number: 0, response: initial },
      {
        type: 'response.output_item.added',
        sequence_number: 1,
        output_index: 0,
        item: { ...item, status: 'in_progress', content: [] },
      },
      { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
      {
        type: 'response.completed',
        sequence_number: 3,
        response: {
          ...initial,
          status: 'completed',
          completed_at: Math.floor(Date.now() / 1000),
          output: [],
          usage,
        },
      },
    ];
    const fetch = vi.fn(async (url, options) => {
      expect(url).toBe('https://fixture.invalid/responses');
      const body = JSON.parse(options.body);
      expect(body.stream).toBe(true);
      expect(
        body.input.some(
          (item) => item.type === 'reasoning' && item.encrypted_content === 'fixture-opaque',
        ),
      ).toBe(matching);
      expect(body.store).toBe(false);
      expect(body).not.toHaveProperty('max_output_tokens');
      expect(body.tools).toEqual([
        {
          type: 'namespace',
          name: 'app',
          description: 'Application functions',
          tools: [
            {
              type: 'function',
              name: 'pet_say',
              description: 'Speak',
              parameters: { type: 'object' },
              strict: false,
            },
          ],
        },
      ]);
      expect(new Headers(options.headers).get('authorization')).toBe('Bearer fixture-access');
      return new Response(
        events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      );
    });
    vi.stubGlobal('fetch', fetch);
    const result = await respondCompatible(
      'fixture-access',
      'fixture-model',
      {
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
          {
            type: 'reasoning',
            id: 'signed-reasoning',
            summary: [],
            encrypted_content: 'fixture-opaque',
          },
          { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'pet_say', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call1', output: 'OK' },
        ],
        max_output_tokens: 256,
        tools: [
          {
            type: 'function',
            name: 'pet_say',
            description: 'Speak',
            parameters: { type: 'object' },
          },
        ],
      },
      new AbortController().signal,
      { id: 'fixture-browser', baseUrl: 'https://fixture.invalid', protocol: 'browser' },
      true,
      [
        {
          id: 'signed-reasoning',
          origin: {
            instance: 'fixture-browser',
            module: 'pet.llm-provider',
            model: 'fixture-model',
            compatibilityDomain: matching
              ? 'browser:fixture-browser:https://fixture.invalid'
              : 'foreign-domain',
          },
        },
      ],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.response.output).toEqual([item]);
    expect(result.response.status).toBe('completed');
    expect(result.attempts[0].meters).toMatchObject({ input: 5, output: 2, total: 7 });
    expect(JSON.stringify(result)).not.toContain('fixture-access');
  },
);
