import { afterEach, expect, it, vi } from 'vitest';
import { register } from 'tsx/esm/api';
import plugin from './index.ts';
import { modelProviderId } from '@pet/contracts';
register();
const { createResponse } = await import('cortico/protocol/open-responses/index.ts');
afterEach(() => vi.unstubAllGlobals());
async function probe(chooseModel, { id = 'chatgpt', effort, respond = false } = {}) {
  const methods = new Map();
  const signal = new AbortController().signal;
  await plugin.activate({
    provide: (id, handlers) => methods.set(id, handlers),
    host: {
      config: {
        get: async () => ({
          ok: true,
          value: {
            data: {
              model: 'legacy-model',
              models: { [id]: 'stored-model' },
              reasoningEfforts: { openai: 'high', ...(effort ? { [id]: effort } : {}) },
            },
          },
        }),
      },
      credentials: {
        withSecret: async (_task, key, operation) => {
          expect(key).toBe(id === 'deepseek' ? 'api-key' : id + '-api-key');
          return { ok: true, value: await operation('fixture-access', signal) };
        },
      },
    },
  });
  return methods
    .get(modelProviderId(id))
    [respond ? 'respond' : 'test'](
      { taskId: 'fixture-probe', signal },
      respond
        ? { request: { input: [{ type: 'message', role: 'user', content: 'Hello' }] } }
        : chooseModel
          ? { chooseModel: true }
          : null,
    );
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

it.each([undefined, 'default', 'medium'])(
  'reads only the selected endpoint effort (%s) for the shared probe',
  async (effort) => {
    const fetch = vi.fn(async (url, init) => {
      expect(url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('stored-model');
      expect(body.max_tokens).toBe(256);
      if (effort === 'medium') expect(body.reasoning_effort).toBe('medium');
      else expect(body).not.toHaveProperty('reasoning_effort');
      return Response.json({
        id: 'chat-r1',
        model: 'stored-model',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(probe(false, { id: 'glm-intl', effort })).resolves.toMatchObject({
      ok: true,
      model: 'stored-model',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it('passes persisted effort to normal endpoint replies without forcing diagnostic limits', async () => {
  const fetch = vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'stored-model',
      max_tokens: 8192,
      reasoning_effort: 'low',
    });
    return Response.json({
      id: 'chat-r1',
      model: 'stored-model',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' },
      ],
    });
  });
  vi.stubGlobal('fetch', fetch);
  const result = await probe(false, { id: 'glm-intl', effort: 'low', respond: true });
  expect(result.response.status).toBe('completed');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves explicit reasoning effort through the signed-in browser request adapter', async () => {
  const fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    return completed(body.model);
  });
  vi.stubGlobal('fetch', fetch);
  await expect(probe(false, { effort: 'high' })).resolves.toMatchObject({
    ok: true,
    model: 'stored-model',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
