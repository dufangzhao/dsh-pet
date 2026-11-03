import { expect, it, vi } from 'vitest';
import { StreamingAsrSession, type AsrRecognizer, type AsrStream } from './stream-session.js';
function nativeFixture() {
  const streams: {
    samples: number;
    pending: boolean;
    finished: boolean;
    text: string;
    acceptWaveform: AsrStream['acceptWaveform'];
    inputFinished: () => void;
  }[] = [];
  const decode = vi.fn((stream: AsrStream) => {
    const current = streams.find((item) => item === stream);
    if (!current) throw new Error('Unknown stream');
    current.pending = false;
    current.text = 'recognized ' + current.samples;
  });
  const recognizer: AsrRecognizer = {
    createStream: vi.fn(() => {
      const stream = {
        samples: 0,
        pending: false,
        finished: false,
        text: '',
        acceptWaveform(input: { samples: Float32Array }) {
          stream.samples += input.samples.length;
          stream.pending = true;
        },
        inputFinished() {
          stream.finished = true;
          stream.pending = true;
        },
      };
      streams.push(stream);
      return stream;
    }),
    decode,
    getResult: (stream) => ({ text: streams.find((item) => item === stream)?.text ?? '' }),
    isReady: (stream) => {
      const current = streams.find((item) => item === stream);
      return !!current && current.pending && current.samples >= 3200;
    },
  };
  return { recognizer, streams, decode };
}
it('runs at most one real SenseVoice prefix per new second and reuses an exact final prefix', async () => {
  const native = nativeFixture(),
    partial = vi.fn(async () => {}),
    session = new StreamingAsrSession(
      'sensevoice-small-int8',
      native.recognizer,
      partial,
      async () => '',
    );
  for (let frame = 0; frame < 200; frame++) await session.push(new Float32Array(1600));
  expect(native.decode).toHaveBeenCalledTimes(20);
  expect(partial).toHaveBeenCalledTimes(20);
  expect(partial).toHaveBeenNthCalledWith(1, 'recognized 16000');
  expect(session.sampleCount).toBe(320000);
  expect(await session.finish()).toBe('recognized 320000');
  expect(native.decode).toHaveBeenCalledTimes(20);
  await expect(session.finish()).rejects.toThrow('asr-failed');
});
it('decodes the remaining SenseVoice tail only at explicit finish', async () => {
  const native = nativeFixture(),
    partial = vi.fn(async () => {}),
    session = new StreamingAsrSession(
      'sensevoice-small-int8',
      native.recognizer,
      partial,
      async () => '',
    );
  for (let frame = 0; frame < 15; frame++) await session.push(new Float32Array(1600));
  expect(partial).toHaveBeenCalledOnce();
  expect(await session.finish()).toBe('recognized 24000');
  expect(native.decode).toHaveBeenCalledTimes(2);
  expect(partial).toHaveBeenCalledOnce();
});
it('feeds one online Paraformer stream incrementally before finishing it', async () => {
  const native = nativeFixture(),
    partial = vi.fn(async () => {}),
    session = new StreamingAsrSession(
      'streaming-paraformer-zh-en-int8',
      native.recognizer,
      partial,
      async () => '',
    );
  await session.push(new Float32Array(1600));
  expect(native.decode).not.toHaveBeenCalled();
  await session.push(new Float32Array(1600));
  expect(partial).toHaveBeenCalledWith('recognized 3200');
  expect(native.streams[0]?.finished).toBe(false);
  await session.finish();
  expect(native.recognizer.createStream).toHaveBeenCalledOnce();
  expect(native.streams[0]?.finished).toBe(true);
  expect(session.sampleCount).toBe(3200);
});
it('keeps Whisper and SAPI final-only and does not call either decoder during input', async () => {
  const native = nativeFixture(),
    partial = vi.fn(async () => {}),
    sapi = vi.fn(async (samples: Float32Array) => 'batch ' + samples.length);
  const whisper = new StreamingAsrSession('whisper-small-int8', native.recognizer, partial, sapi),
    windows = new StreamingAsrSession('windows-sapi', null, partial, sapi);
  for (let frame = 0; frame < 10; frame++) {
    await whisper.push(new Float32Array(1600));
    await windows.push(new Float32Array(1600));
  }
  expect(partial).not.toHaveBeenCalled();
  expect(native.decode).not.toHaveBeenCalled();
  expect(sapi).not.toHaveBeenCalled();
  expect(await whisper.finish()).toBe('recognized 16000');
  expect(await windows.finish()).toBe('batch 16000');
  expect(sapi).toHaveBeenCalledOnce();
  expect(partial).not.toHaveBeenCalled();
});
it('rejects invalid samples and the real audio budget before emitting a hypothesis', async () => {
  const native = nativeFixture(),
    partial = vi.fn(async () => {}),
    session = new StreamingAsrSession(
      'sensevoice-small-int8',
      native.recognizer,
      partial,
      async () => '',
    );
  await expect(session.push(new Float32Array([NaN]))).rejects.toThrow('audio-format');
  await expect(session.push(new Float32Array(1601))).rejects.toThrow('audio-format');
  expect(session.sampleCount).toBe(0);
  expect(partial).not.toHaveBeenCalled();
});
