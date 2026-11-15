import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { consumeSpeechAudio } from '../src/client/speech-protocol.ts';
import { SPEECH_AUDIO_HEADER, SPEECH_FORMAT, makeError } from '@pet/contracts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const key = {
  utteranceId: 'utterance-1',
  clientId: 'client-1',
  agentId: 'agent-1',
  serviceEpoch: 'epoch-1',
  utteranceBindingId: 'whole-binding',
  segmentIndex: 0,
  requestId: 'request-1',
};
const binding = { providerRef: 'pet.tts-magpie/magpie', bindingId: 'provider-binding' };
const header = { ...key, ...binding, version: 1, format: SPEECH_FORMAT };
const transport = { baseUrl: '', token: 'synthetic-service-token' };
const deferred = () => Promise.withResolvers();
function response(body, override = {}) {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      [SPEECH_AUDIO_HEADER]: JSON.stringify({ ...header, ...override }),
    },
  });
}

test('healthy deferred authorized consumer may exceed the old unobservable 15s yield timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const seen = deferred(),
    release = deferred();
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([1, 0]));
      c.close();
    },
  });
  const received = response(body);
  globalThis.fetch = async () => received;
  let settled = false;
  const work = consumeSpeechAudio(transport, key, binding, async (_header, audio, signal) => {
    for await (const chunk of audio) {
      assert.deepEqual(chunk, new Uint8Array([1, 0]));
      seen.resolve(signal);
      await release.promise;
    }
  });
  work.then(() => {
    settled = true;
  });
  const signal = await seen.promise;
  t.mock.timers.tick(16_000);
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  assert.equal(settled, false);
  release.resolve();
  const result = await work;
  assert.equal(result.ok, true);
  assert.equal(result.value.receivedFrames, 1);
  assert.equal(received.body.locked, false);
});

test('explicit cancellation joins the actual reader cancellation before releasing its authorized scope', async () => {
  const seen = deferred(),
    cancelled = deferred(),
    close = deferred();
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([2, 0]));
    },
    async cancel() {
      cancelled.resolve();
      await close.promise;
    },
  });
  const received = response(body);
  globalThis.fetch = async () => received;
  const abort = new AbortController();
  const work = consumeSpeechAudio(
    transport,
    key,
    binding,
    async (_header, audio, signal) => {
      for await (const chunk of audio) {
        assert.equal(chunk.byteLength, 2);
        seen.resolve();
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
        );
      }
    },
    abort.signal,
  );
  let settled = false;
  work.then(() => {
    settled = true;
  });
  await seen.promise;
  abort.abort();
  await cancelled.promise;
  await Promise.resolve();
  assert.equal(settled, false);
  close.resolve();
  assert.deepEqual(await work, { ok: false, error: makeError('cancelled', false) });
  assert.equal(received.body.locked, false);
});

test('wrong captured binding cancels response without invoking the native consumer', async () => {
  let cancelled = false,
    consumed = false;
  const received = response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { bindingId: 'replacement-binding' },
  );
  globalThis.fetch = async () => received;
  const result = await consumeSpeechAudio(transport, key, binding, async () => {
    consumed = true;
  });
  assert.equal(result.ok, false);
  assert.equal(cancelled, true);
  assert.equal(consumed, false);
});

test('partial consumer return is incomplete and closes its one-shot response', async () => {
  let cancelled = false;
  const received = response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 0]));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  globalThis.fetch = async () => received;
  const result = await consumeSpeechAudio(transport, key, binding, async (_header, audio) => {
    for await (const chunk of audio) {
      assert.equal(chunk.byteLength, 2);
      break;
    }
  });
  assert.equal(result.ok, false);
  assert.equal(cancelled, true);
  assert.equal(received.body.locked, false);
});

test('split PCM frames survive HTTP boundaries but an odd EOF is incomplete', async () => {
  for (const [chunks, expected] of [
    [[new Uint8Array([1]), new Uint8Array([0, 2]), new Uint8Array([0])], true],
    [[new Uint8Array([1, 0, 2])], false],
  ]) {
    const received = response(
      new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      }),
    );
    globalThis.fetch = async () => received;
    const samples = [];
    const result = await consumeSpeechAudio(transport, key, binding, async (_header, audio) => {
      for await (const chunk of audio) samples.push(...chunk);
    });
    assert.equal(result.ok, expected);
    if (expected) assert.deepEqual(samples, [1, 0, 2, 0]);
    assert.equal(received.body.locked, false);
  }
});
