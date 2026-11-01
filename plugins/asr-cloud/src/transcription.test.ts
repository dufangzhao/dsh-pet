import { expect, it, vi } from 'vitest';
import { pcmWave, transcribeOpenAI } from './transcription.js';
it('sends the same 16k mono PCM as multipart WAV to the configured declared origin', async () => {
  const request = vi.fn(
    async (_url: URL | string | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: ' public fixture ' }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const signal = new AbortController().signal,
    result = await transcribeOpenAI(
      new Float32Array([0, -1, 1]),
      'whisper-1',
      'fixture-key',
      signal,
      request,
      'https://api.groq.com/openai/v1',
    );
  expect(result).toEqual({ modelId: 'openai', text: 'public fixture', errorCode: null });
  const [url, init] = request.mock.calls[0] ?? [];
  expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
  expect(init?.signal).toBe(signal);
  expect(init?.redirect).toBe('error');
  const form = init?.body as FormData;
  expect(form.get('model')).toBe('whisper-1');
  const audio = form.get('file') as Blob;
  const wav = new DataView(await audio.arrayBuffer());
  expect(wav.getUint32(24, true)).toBe(16000);
  expect(wav.getUint16(22, true)).toBe(1);
  expect(wav.getInt16(46, true)).toBe(-32768);
  expect(wav.getInt16(48, true)).toBe(32767);
});
it('does not use undeclared origins or convert rejected/authenticated requests into a fake transcript', async () => {
  const request = vi.fn(async () => new Response('', { status: 401 }));
  expect(
    await transcribeOpenAI(
      new Float32Array([0]),
      'whisper-1',
      'fixture-key',
      new AbortController().signal,
      request,
      'https://unlisted.invalid/v1',
    ),
  ).toMatchObject({ errorCode: 'permission-denied' });
  expect(request).not.toHaveBeenCalled();
  expect(
    await transcribeOpenAI(
      new Float32Array([0]),
      'whisper-1',
      'fixture-key',
      new AbortController().signal,
      request,
    ),
  ).toEqual({ text: '', errorCode: 'auth-failed' });
  expect(() => pcmWave(new Float32Array([NaN]))).toThrow('audio-format');
});
it('retains cancellation and rejects malformed oversized output', async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = await transcribeOpenAI(
    new Float32Array([0]),
    'whisper-1',
    'fixture-key',
    controller.signal,
    async () => {
      throw new Error('aborted');
    },
  );
  expect(cancelled).toMatchObject({ errorCode: 'cancelled' });
  const oversized = await transcribeOpenAI(
    new Float32Array([0]),
    'whisper-1',
    'fixture-key',
    new AbortController().signal,
    async () => new Response('x'.repeat(70000)),
  );
  expect(oversized).toMatchObject({ errorCode: 'asr-failed' });
});
