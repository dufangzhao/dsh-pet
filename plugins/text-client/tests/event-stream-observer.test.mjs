import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { streamEvents } from '../src/client/protocol.ts';
import { event, sseText } from './fixtures.mjs';

const originalFetch = globalThis.fetch;
const encode = (value) => new TextEncoder().encode(value);
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const validFrame = (sequence) =>
  sseText([
    { event: 'companion', data: JSON.stringify(event(sequence, { data: { note: '中文' } })) },
  ]);

async function consume(chunks, strict = true) {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(typeof chunk === 'string' ? encode(chunk) : chunk);
        controller.close();
      },
    }),
  );
  globalThis.fetch = async () => response;
  const messages = [];
  let invalid = 0;
  const result = await streamEvents(
    { baseUrl: '', token: 'test-token' },
    {
      after: 0,
      epoch: 'epoch-1',
      signal: new AbortController().signal,
      ...(strict
        ? {
            onInvalidEvent: () => {
              invalid++;
            },
          }
        : {}),
    },
    (message) => messages.push(message),
  );
  assert.equal(response.body.locked, false);
  return { result, messages, invalid };
}

test('durable-event observer sees corrupt companion frames while refresh and extension semantics stay unchanged', async () => {
  const wire =
    ': heartbeat\n\n' +
    validFrame(1) +
    'event: companion\ndata: {bad-json}\n\n' +
    'event: companion\ndata: {}\n\n' +
    'event: extension\ndata: {bad-json}\n\n' +
    'event: refresh\ndata: {\n\n' +
    validFrame(2);
  const strict = await consume([wire]);
  assert.equal(strict.invalid, 2);
  assert.deepEqual(
    strict.messages.map((message) => message.kind),
    ['companion', 'refresh', 'companion'],
  );
  assert.deepEqual(
    strict.messages
      .filter((message) => message.kind === 'companion')
      .map((message) => message.event.sequence),
    [1, 2],
  );
  assert.equal(strict.result.kind, 'ended');
  const legacy = await consume([wire], false);
  assert.equal(legacy.invalid, 0);
  assert.deepEqual(legacy.messages, strict.messages);
  assert.equal(legacy.result.kind, 'ended');
});

test('strict EOF observes an incomplete persistent event without delivering its partial data', async () => {
  const wire = validFrame(1) + 'event: companion\ndata: {"sequence":';
  const strict = await consume([wire]);
  assert.equal(strict.invalid, 1);
  assert.equal(strict.messages.length, 1);
  const legacy = await consume([wire], false);
  assert.equal(legacy.invalid, 0);
  assert.deepEqual(legacy.messages, strict.messages);
  const unrelated = await consume(['event: refresh\ndata: {}']);
  assert.equal(unrelated.invalid, 0);
  assert.equal((await consume([': final heartbeat'])).invalid, 0);
});

test('strict decoding preserves split UTF8 and final standalone CR framing', async () => {
  const bytes = encode(validFrame(3).replaceAll('\n', '\r'));
  const result = await consume([...bytes].map((byte) => new Uint8Array([byte])));
  assert.equal(result.invalid, 0);
  assert.equal(result.result.kind, 'ended');
  assert.equal(result.messages[0].event.data.note, '中文');
  assert.equal(result.messages[0].event.sequence, 3);
});

test('invalid UTF8 is observable without changing text-reader delivery or stopping later events', async () => {
  const corrupt = encode(validFrame(2));
  const index = corrupt.indexOf(0xe4);
  assert.ok(index >= 0);
  corrupt[index] = 0xff;
  const chunks = [validFrame(1), corrupt, validFrame(3)];
  const strict = await consume(chunks);
  const legacy = await consume(chunks, false);
  assert.equal(strict.result.kind, 'ended');
  assert.equal(strict.invalid, 1);
  assert.deepEqual(strict.messages, legacy.messages);
  assert.deepEqual(
    strict.messages.map((message) => message.event.sequence),
    [1, 2, 3],
  );
  assert.match(strict.messages[1].event.data.note, /\uFFFD/);
});

test('EOF reports incomplete UTF8 while preserving the existing text stream end policy', async () => {
  const result = await consume([
    validFrame(1),
    'event: refresh\ndata: ',
    new Uint8Array([0xe4, 0xb8]),
  ]);
  assert.equal(result.result.kind, 'ended');
  assert.equal(result.invalid, 1);
  assert.equal(result.messages.length, 1);
});

test('explicit abort after actual frame processing does not report a partial frame as corruption', async () => {
  const seen = Promise.withResolvers();
  const abort = new AbortController();
  let cancelled = false;
  let invalid = 0;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encode('event: refresh\ndata: {}\n\nevent: companion\ndata: {'));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  globalThis.fetch = async () => response;
  const pending = streamEvents(
    { baseUrl: '', token: 'test-token' },
    {
      after: 0,
      epoch: 'epoch-1',
      signal: abort.signal,
      onInvalidEvent: () => {
        invalid++;
      },
    },
    () => seen.resolve(),
  );
  await seen.promise;
  assert.equal(response.body.locked, true, 'the reader must actually be active before abort');
  abort.abort();
  assert.equal((await pending).kind, 'ended');
  assert.equal(invalid, 0);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});
