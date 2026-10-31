import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register } from 'tsx/esm/api';
register();
const pluginRequire = createRequire(path.resolve('plugins/llm-provider/package.json'));
const { createResponse } = await import(
  pathToFileURL(pluginRequire.resolve('cortico/protocol/open-responses/index.ts')).href
);
const calls = [];
globalThis.__startModelFixtureCalls = calls;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const headers = new Headers(init.headers);
  const key =
    headers.get('authorization') ?? headers.get('x-api-key') ?? headers.get('x-goog-api-key') ?? '';
  const record = {
    host: url.host,
    path: url.pathname,
    method: init.method ?? 'GET',
    credentialPresent: !!key,
    slow: key.includes('SLOW'),
    effort: null,
    settled: false,
  };
  calls.push(record);
  if (
    ![
      'api.deepseek.com',
      'dashscope.aliyuncs.com',
      'dashscope-intl.aliyuncs.com',
      'api.openai.com',
    ].includes(url.host)
  )
    throw new Error('Fixture blocked an unexpected external origin');
  if (key.includes('BAD')) {
    record.settled = true;
    return new Response('', { status: 401 });
  }
  if (key.includes('SLOW')) await new Promise((r) => setTimeout(r, 1200));
  record.settled = true;
  if (init.signal?.aborted) {
    record.aborted = true;
    throw new DOMException('Aborted', 'AbortError');
  }
  if (url.pathname.endsWith('/models')) {
    const vendor = url.host === 'api.deepseek.com' ? 'deepseek' : 'qwen';
    return Response.json({
      data: [{ id: 'qa-' + vendor + '-one' }, { id: 'qa-' + vendor + '-two' }],
    });
  }
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  record.effort = body.reasoning_effort ?? body.reasoning?.effort ?? null;
  record.model = body.model ?? null;
  if (url.pathname.endsWith('/responses')) {
    let initial;
    try {
      initial = createResponse('qa-r1', { model: body.model, input: [] });
    } catch (error) {
      record.fixtureError = error instanceof Error ? error.message : 'fixture-error';
      throw error;
    }
    const item = {
      type: 'message',
      id: 'qa-m1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'OK', annotations: [], logprobs: [] }],
    };
    const response = {
      ...initial,
      status: 'completed',
      output: [item],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    };
    return Response.json(response);
  }
  if (url.pathname.endsWith('/chat/completions'))
    return Response.json({
      id: 'qa-reply',
      object: 'chat.completion',
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  throw new Error('Fixture blocked an unexpected external route');
};
await import(pathToFileURL(path.resolve('apps/desktop/dist/main/index.mjs')).href);
