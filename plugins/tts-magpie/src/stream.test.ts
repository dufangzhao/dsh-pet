import { afterEach, expect, it, vi } from 'vitest';
import { SPEECH_FORMAT } from '@pet/contracts';
import type { AuthorizedMagpieSpeechTransport, NativeSpeechInput } from '@pet/companion-runtime';
import { streamMiMoSpeech } from './stream.js';

const encode = (value: unknown) =>
  new TextEncoder().encode(
    `data: ${JSON.stringify({
      id: 'completion',
      model: 'mimo-v2.5-tts',
      choices: [{ index: 0, delta: value, finish_reason: null }],
    })}\r\n\r\n`,
  );
const audio = encode({ audio: { id: 'audio', data: 'AQACAA==' } });
const stop = new TextEncoder().encode(
  'data: {"id":"completion","model":"mimo-v2.5-tts","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
);
function input(
  write: NativeSpeechInput['audio']['write'] = async () => ({ ok: true, value: null }),
): NativeSpeechInput {
  return {
    key: {
      utteranceId: 'u',
      clientId: 'client',
      agentId: 'agent',
      serviceEpoch: 'epoch',
      utteranceBindingId: 'whole',
      segmentIndex: 0,
      requestId: 'r',
    },
    modelRef: 'xiaomi/mimo-v2.5-tts',
    text: '原文',
    voice: 'Mia',
    format: SPEECH_FORMAT,
    onProduced: () => {},
    audio: {
      reference: {
        streamId: 's',
        taskId: 't',
        owner: { pluginId: 'pet.tts-magpie', instanceId: 'default', generation: 1 },
      },
      write,
      end: async () => ({ ok: true, value: null }),
      cancel: vi.fn(),
    },
  };
}
function transport(
  body: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
): AuthorizedMagpieSpeechTransport {
  return {
    catalog: async () => ({}),
    close: async () => {},
    mimoSpeech: async (_input, signal) => ({
      body: body(signal),
      settled: Promise.resolve(),
      cancel() {},
    }),
  };
}
function untilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
afterEach(() => vi.useRealTimers());

it('does not charge healthy consumer backpressure to producer idle or a second unobservable stall clock', async () => {
  vi.useFakeTimers();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writing = () => {};
  const entered = new Promise<void>((resolve) => {
    writing = resolve;
  });
  const work = streamMiMoSpeech(
    transport(async function* () {
      yield audio;
      yield stop;
    }),
    input(async () => {
      writing();
      await gate;
      return { ok: true, value: null };
    }),
    new AbortController().signal,
  );
  let finished = false;
  void work.then(() => {
    finished = true;
  });
  await entered;
  await vi.advanceTimersByTimeAsync(31_000);
  expect(finished).toBe(false);
  release();
  expect(await work).toEqual({ finishReason: 'stop', producedFrames: 2, producedBytes: 4 });
});

it('first audio includes metadata/header wait and cancellation reaches actual pending native work', async () => {
  vi.useFakeTimers();
  const native = transport(async function* (signal) {
    yield encode({ role: 'assistant' });
    await untilAbort(signal);
  });
  const target = input();
  const observed = streamMiMoSpeech(native, target, new AbortController().signal).then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await observed).toMatchObject({ error: { code: 'timeout' } });
  expect(target.audio.cancel).toHaveBeenCalled();
});

it('keeps a progressing long stream alive beyond the old 40s, 55s and 120s limits', async () => {
  vi.useFakeTimers();
  const native = transport(async function* () {
    for (let at = 0; at < 8; at++) {
      yield audio;
      if (at < 7) await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
    }
    yield stop;
  });
  const observed = streamMiMoSpeech(native, input(), new AbortController().signal).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(140_001);
  expect(await observed).toEqual({
    value: { finishReason: 'stop', producedFrames: 16, producedBytes: 32 },
  });
});

it('usage metadata cannot renew an active producer silence budget', async () => {
  vi.useFakeTimers();
  const native = transport(async function* (signal) {
    yield audio;
    yield new TextEncoder().encode(
      'data: {"id":"completion","model":"mimo-v2.5-tts","choices":[],"usage":{}}\n\n',
    );
    await untilAbort(signal);
  });
  const observed = streamMiMoSpeech(native, input(), new AbortController().signal).then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await observed).toMatchObject({ error: { code: 'timeout' } });
});

it('retains fixed finish reasons without calling an incomplete stream completed', async () => {
  for (const finishReason of ['length', 'content_filter'] as const) {
    const end = new TextEncoder().encode(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
    );
    await expect(
      streamMiMoSpeech(
        transport(async function* () {
          yield audio;
          yield end;
        }),
        input(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ finishReason, error: { code: 'audio-format' } });
  }
});
