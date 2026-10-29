import { afterEach, expect, it, vi } from 'vitest';
import { register } from 'tsx/esm/api';
import plugin from './index.ts';
register();
const { createResponse } = await import('cortico/protocol/open-responses/index.ts');
afterEach(() => vi.unstubAllGlobals());
async function probe(chooseModel) {
  const methods = new Map();
  const signal = new AbortController().signal;
  await plugin.activate({
    provide: (id, handlers) => methods.set(id, handlers),
    host: {
      config: {
        get: async () => ({
          ok: true,
          value: { data: { model: 'legacy-model', models: { chatgpt: 'stored-model' } } },
        }),
      },
      credentials: {
        withSecret: async (_task, key, operation) => {
          expect(key).toBe('chatgpt-api-key');
          return { ok: true, value: await operation('fixture-access', signal) };
        },
      },
    },
  });
  return methods
    .get('responses-chatgpt')
    .test({ taskId: 'fixture-probe', signal }, chooseModel ? { chooseModel: true } : null);
}
function completed(model) {
  const initial = createResponse('r1', { model, input: [] });
  const item = {
    type: 'message',
    id: 'm1',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'OK', annotations: [], logprobs: [] }],
  };
  const response = {
    ...initial,
    status: 'completed',
    output: [item],
    usage: {
      input_tokens: 5,
      output_tokens: 1,
      total_tokens: 6,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  const events = [
    { type: 'response.created', sequence_number: 0, response: initial },
    {
      type: 'response.output_item.added',
      sequence_number: 1,
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    },
    { type: 'response.output_item.done', sequence_number: 2, output_index: 0, item },
    { type: 'response.completed', sequence_number: 3, response },
  ];
  return new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
it.each([true, false])(
  'selects granted plan models only when save-and-start requests it (%s)',
  async (chooseModel) => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        calls.push(url);
        expect(new Headers(options.headers).get('authorization')).toBe('Bearer fixture-access');
        if (url === 'https://api.openai.com/v1/models')
          return Response.json({
            models: [
              { slug: 'hidden-model', visibility: 'hidden' },
              { slug: 'granted-model', visibility: 'list' },
            ],
          });
        expect(url).toBe('https://api.openai.com/v1/responses');
        const body = JSON.parse(options.body);
        expect(body.model).toBe(chooseModel ? 'granted-model' : 'stored-model');
        return completed(body.model);
      }),
    );
    const result = await probe(chooseModel);
    expect(result).toMatchObject({
      ok: true,
      model: chooseModel ? 'granted-model' : 'stored-model',
    });
    expect(calls).toEqual(
      chooseModel
        ? ['https://api.openai.com/v1/models', 'https://api.openai.com/v1/responses']
        : ['https://api.openai.com/v1/responses'],
    );
    expect(JSON.stringify(result)).not.toContain('fixture-access');
  },
);
it('does not claim connection when a signed-in plan grants no visible model', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ models: [{ slug: 'hidden', visibility: 'hidden' }] }),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await probe(true)).toMatchObject({ ok: false, reason: 'ChatGPT暂时没有可用模型' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
