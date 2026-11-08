import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { register } from 'tsx/esm/api';
register();
const { ResponsesProvider } = await import('cortico/providers/openai-responses-compat/native.ts');
const { createResponse } = await import('cortico/protocol/open-responses/index.ts');
const { NativeResponseAssembly } = await import('cortico/providers/transport/response-assembly.ts');
const { ResponseProtocolError } = await import('cortico/protocol/open-responses/stream.ts');
const { GenerationError } = await import('cortico/core/generation.ts');
const { createMagpieNativeProvider } = await import('./native-provider.mjs');
const cleanups = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const request = {
  model: 'fixture-model',
  input: [{ type: 'message', role: 'user', content: 'Reply with OK.' }],
  max_output_tokens: 256,
};
const options = { diagnostic: true, role: 'probe', onEvent() {} };
const metadata = ['codex.rate_limits', 'codex.response.metadata', 'response.metadata'];

// Sanitized protocol shape only. No captured instructions, model text, IDs, headers or accounts.
function stream({ instructions = '', text = 'OK', sidebands = true, tool = false } = {}) {
  const initial = { ...createResponse('response-fixture', request, 0), instructions };
  const part = { type: 'output_text', text, annotations: [] };
  const args = '{"title":"fixture"}';
  const item = tool
    ? {
        id: 'call-item',
        type: 'function_call',
        call_id: 'new-call',
        name: 'start_work',
        arguments: args,
        status: 'completed',
      }
    : {
        id: 'message-fixture',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [part],
      };
  const usage = {
    input_tokens: 10,
    output_tokens: 2,
    total_tokens: 12,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
  const completed = { ...initial, status: 'completed', output: [item], usage };
  const events = sidebands ? [{ type: metadata[0], rate_limits: {} }, { type: metadata[1] }] : [];
  let sequence = 0;
  const emit = (type, value) => events.push({ type, sequence_number: sequence++, ...value });
  emit('response.created', { response: initial });
  emit('response.in_progress', { response: initial });
  emit('response.output_item.added', {
    output_index: 0,
    item: tool
      ? { ...item, arguments: '', status: 'in_progress' }
      : { ...item, content: [], status: 'in_progress' },
  });
  if (tool) {
    emit('response.function_call_arguments.delta', {
      output_index: 0,
      item_id: item.id,
      delta: args,
    });
    if (sidebands) emit(metadata[2], { metadata: {} });
    emit('response.function_call_arguments.done', {
      output_index: 0,
      item_id: item.id,
      arguments: args,
    });
  } else {
    emit('response.content_part.added', {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      part: { ...part, text: '' },
    });
    emit('response.output_text.delta', {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      delta: text,
      logprobs: [],
    });
    if (sidebands) emit(metadata[2], { metadata: {} });
    emit('response.output_text.done', {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      text,
      logprobs: [],
    });
    emit('response.content_part.done', {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      part,
    });
  }
  emit('response.output_item.done', { output_index: 0, item });
  emit('response.completed', { response: completed });
  return { events, completed };
}
const encoded = (events) =>
  Buffer.from(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
async function writeChunks(response, events) {
  const bytes = encoded(events);
  for (let offset = 0; offset < bytes.length && !response.destroyed; offset += 997) {
    response.write(bytes.subarray(offset, offset + 997));
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!response.destroyed) response.end();
}
async function gateway(handle) {
  const requests = [];
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      outgoing.writeHead(200, { 'Content-Type': 'text/event-stream' });
      await handle(outgoing, body);
    })().catch(() => outgoing.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

it('reproduces the first real metadata failure and delegates the unchanged standard objects to strict native assembly', () => {
  const fixture = stream();
  const original = new NativeResponseAssembly();
  expect(() => original.feed(fixture.events[0], () => {})).toThrow(
    'Unknown Open Responses event type',
  );
  const provider = createMagpieNativeProvider('https://fixture.invalid/v1', 'fixture');
  const assembly = provider.responseAssembly();
  const emitted = [];
  for (const event of fixture.events) assembly.feed(event, (value) => emitted.push(value));
  expect(assembly.finish().output).toEqual(fixture.completed.output);
  expect(emitted.map((event) => event.sequence_number)).toEqual(
    fixture.events
      .filter((event) => !metadata.includes(event.type))
      .map((event) => event.sequence_number),
  );
  const delta = fixture.events.find((event) => event.type === 'response.output_text.delta');
  expect(emitted.find((event) => event.type === delta.type)).toBe(delta);
  expect(emitted.some((event) => metadata.includes(event.type))).toBe(false);
});

it('keeps the default 6144-unit limit while Magpie accepts a split 23k legal resource without changing the 256-token request', async () => {
  const fixture = stream({ instructions: 'synthetic instruction '.repeat(1100), sidebands: false });
  const f = await gateway((response) => writeChunks(response, fixture.events));
  const strict = new ResponsesProvider({
    baseUrl: f.baseUrl,
    apiKey: 'fixture',
    reasoningReplay: 'plaintext',
    sendSyntheticReasoning: false,
  });
  await expect(strict.respond(request, options)).rejects.toMatchObject({
    name: 'GenerationError',
    cause: expect.any(ResponseProtocolError),
  });
  const seen = [];
  const quote = vi.fn(() => []);
  const generation = await createMagpieNativeProvider(f.baseUrl, 'fixture').respond(request, {
    ...options,
    quote,
    sessionId: 'private-fixture',
    onEvent: (event) => seen.push(event),
  });
  expect(generation.response.instructions).toBe(fixture.completed.instructions);
  expect(generation.response.output).toEqual(fixture.completed.output);
  expect(generation.response.usage.total_tokens).toBe(12);
  expect(generation.attempts).toHaveLength(1);
  expect(quote).toHaveBeenCalledOnce();
  expect(seen.at(-1).type).toBe('response.completed');
  expect(f.requests).toHaveLength(2);
  expect(
    f.requests.every(
      (body) => body.max_output_tokens === 256 && body.stream === true && body.store === false,
    ),
  ).toBe(true);
});

it('counts UTF-16 code units rather than UTF-8 bytes and preserves all three metadata-independent standard resources', async () => {
  const fixture = stream({ instructions: '汉'.repeat(23000) });
  const frame = JSON.stringify(fixture.events.find((event) => event.type === 'response.created'));
  expect(Buffer.byteLength(frame)).toBeGreaterThan(65536);
  expect(frame.length).toBeLessThan(65536);
  const f = await gateway((response) => writeChunks(response, fixture.events));
  const result = await createMagpieNativeProvider(f.baseUrl, 'fixture').respond(request, options);
  expect(result.response.status).toBe('completed');
  expect(result.response.instructions).toBe(fixture.completed.instructions);
});

it('preserves native function calls, prior function outputs, terminal usage and private origin', async () => {
  const fixture = stream({ tool: true, instructions: 'synthetic instruction '.repeat(1100) });
  const f = await gateway((response) => writeChunks(response, fixture.events));
  const origin = {
    instance: 'fixture',
    module: 'fixture',
    model: request.model,
    compatibilityDomain: 'fixture',
  };
  const result = await createMagpieNativeProvider(f.baseUrl, 'fixture').respond(
    {
      ...request,
      input: [
        {
          type: 'function_call',
          id: 'old-item',
          call_id: 'old-call',
          name: 'list_work',
          arguments: '{}',
        },
        { type: 'function_call_output', call_id: 'old-call', output: 'retained-output' },
        ...request.input,
      ],
    },
    { ...options, origin },
  );
  expect(result.origin).toBe(origin);
  expect(result.response.output).toEqual(fixture.completed.output);
  expect(result.response.usage.total_tokens).toBe(12);
  expect(f.requests[0].input).toContainEqual(
    expect.objectContaining({
      type: 'function_call_output',
      call_id: 'old-call',
      output: 'retained-output',
    }),
  );
});

it.each(['unknown', 'error', 'missing-terminal', 'sequence', 'over-frame', 'over-output'])(
  'still fails strictly for %s without a hidden retry',
  async (mode) => {
    let fixture = stream({ sidebands: false });
    if (mode === 'unknown')
      fixture.events.splice(1, 0, { type: 'codex.unobserved_event', sequence_number: 1 });
    if (mode === 'error')
      fixture.events = [
        fixture.events[0],
        { type: 'error', sequence_number: 1, code: 'fixture-error', message: 'synthetic failure' },
      ];
    if (mode === 'missing-terminal') fixture.events.pop();
    if (mode === 'sequence') fixture.events[1].sequence_number = fixture.events[0].sequence_number;
    if (mode === 'over-frame')
      fixture = stream({ instructions: 'x'.repeat(65536), sidebands: false });
    if (mode === 'over-output')
      fixture = stream({ text: 'x'.repeat(256 * 12 + 1), sidebands: false });
    const f = await gateway((response) => writeChunks(response, fixture.events));
    const error = await createMagpieNativeProvider(f.baseUrl, 'fixture')
      .respond(request, options)
      .catch((error) => error);
    expect(error).toBeInstanceOf(GenerationError);
    if (mode !== 'over-output') expect(error.cause).toBeInstanceOf(ResponseProtocolError);
    else expect(error.message).toContain('output character limit');
    expect(f.requests).toHaveLength(1);
  },
);

it.each([-1, 1.5, 65537, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid internal floor %s before I/O',
  async (floor) => {
    const fixture = stream({ sidebands: false });
    const f = await gateway((response) => writeChunks(response, fixture.events));
    const provider = new ResponsesProvider({ baseUrl: f.baseUrl, apiKey: 'fixture' });
    provider.eventCodeUnitsFloor = floor;
    await expect(provider.respond(request, options)).rejects.toMatchObject({
      name: 'GenerationError',
      cause: expect.any(ResponseProtocolError),
      attempts: [],
    });
    expect(f.requests).toHaveLength(0);
  },
);

it('retains native partials and waits for actual socket cancellation on a split stream', async () => {
  const fixture = stream({ instructions: 'synthetic instruction '.repeat(1100) });
  const partial = fixture.events.slice(
    0,
    fixture.events.findIndex((event) => event.type === 'response.output_text.delta') + 1,
  );
  let close = () => {};
  const closed = new Promise((resolve) => {
    close = resolve;
  });
  const f = await gateway(async (response) => {
    response.on('close', close);
    const bytes = encoded(partial);
    for (let offset = 0; offset < bytes.length && !response.destroyed; offset += 997) {
      response.write(bytes.subarray(offset, offset + 997));
      await new Promise((resolve) => setImmediate(resolve));
    }
    // No terminal or end: only the caller's abort can settle the transport.
  });
  const controller = new AbortController();
  const error = await createMagpieNativeProvider(f.baseUrl, 'fixture')
    .respond(request, {
      ...options,
      signal: controller.signal,
      onEvent(event) {
        if (event.type === 'response.output_text.delta') controller.abort();
      },
    })
    .catch((error) => error);
  expect(error).toBeInstanceOf(GenerationError);
  expect(error.partial.output[0].content[0].text).toBe('OK');
  await closed;
  expect(f.requests).toHaveLength(1);
});
