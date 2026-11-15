import { afterEach, expect, it, vi } from 'vitest';
import type { VoiceBegin, VoiceFinal } from '@pet/contracts';
import type { SharedVoicePorts } from '@pet/companion-runtime';
import { SharedVoiceInput } from './index.js';
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const inputs = (captureId = 'capture-a', clientId = 'client-a'): VoiceBegin => ({
  captureId,
  clientId,
  agentId: 'agent-a',
  expectedFeatureRevision: 1,
  providerRef: 'pet.asr-magpie/magpie',
  bindingId: 'binding-a',
  finishMode: 'send',
});
async function* clip(
  bytes = new Uint8Array(new Float32Array([0.25, -0.5, 1]).buffer),
): AsyncIterable<Uint8Array> {
  yield bytes.subarray(0, 1);
  yield bytes.subarray(1, 7);
  yield bytes.subarray(7);
}
const features: SharedVoiceInput[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const feature of features.splice(0)) await feature.close();
  vi.useRealTimers();
});
function fixture(
  recognize: SharedVoicePorts['recognize'] = async () => ({ kind: 'final', text: 'transcript' }),
) {
  const source = new AbortController();
  const native = vi.fn(recognize),
    validate = vi.fn(async () => {});
  const feature = new SharedVoiceInput(
    {
      bind: () => async () => {},
      recognize: native,
      currentAgent: async () => ({ id: 'agent-a', acceptsInput: true }),
      validateBegin: validate,
    },
    source.signal,
  );
  features.push(feature);
  return { feature, source, native, validate };
}
it('holds retiring cleanup pending until raw recognition settles and suppresses the late final', async () => {
  const started = deferred<void>(),
    release = deferred<VoiceFinal>(),
    aborted = deferred<void>();
  releases.push(() => release.resolve({ kind: 'no-speech' }));
  const f = fixture(async (_ref, _binding, _samples, pcm, signal) => {
    for await (const chunk of pcm) {
      expect(chunk.byteLength).toBeGreaterThan(0);
    }
    signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    started.resolve();
    return release.promise;
  });
  const ticket = await f.feature.begin(inputs());
  const upload = f.feature.upload(ticket, 3, clip(), new AbortController().signal);
  await started.promise;
  let settled = false;
  const cancellation = f.feature.cancel(ticket).then((result) => {
    settled = true;
    return result;
  });
  await aborted.promise;
  expect(await f.feature.result(ticket)).toMatchObject({
    phase: 'retiring',
    cleanup: 'pending',
    outcome: null,
  });
  expect(settled).toBe(false);
  release.resolve({ kind: 'final', text: 'late result' });
  expect(await cancellation).toMatchObject({
    phase: 'cancelled',
    cleanup: 'settled',
    outcome: null,
  });
  expect(await upload).toMatchObject({ phase: 'cancelled' });
  expect(f.native).toHaveBeenCalledOnce();
});
it('source close joins actual work rather than just the abort signal', async () => {
  const started = deferred<void>(),
    release = deferred<VoiceFinal>();
  releases.push(() => release.resolve({ kind: 'no-speech' }));
  const f = fixture(async () => {
    started.resolve();
    return release.promise;
  });
  const ticket = await f.feature.begin(inputs());
  const upload = f.feature.upload(ticket, 3, clip(), new AbortController().signal);
  await started.promise;
  let closed = false;
  const closing = f.feature.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release.resolve({ kind: 'final', text: 'late' });
  await closing;
  expect(await upload).toMatchObject({ phase: 'cancelled' });
});
it('admits bounded independent clients, idempotent capture IDs and one upload without a scheduler', async () => {
  const f = fixture();
  const input = inputs();
  const ticket = await f.feature.begin(input);
  f.validate.mockRejectedValueOnce(new Error('no admission needed'));
  expect(await f.feature.begin(input)).toEqual(ticket);
  expect(f.validate).toHaveBeenCalledOnce();
  f.validate.mockReset().mockResolvedValue(undefined);
  await expect(f.feature.begin({ ...input, finishMode: 'review' })).rejects.toMatchObject({
    error: { code: 'conflict' },
  });
  await expect(f.feature.begin(inputs('different-capture'))).rejects.toMatchObject({
    error: { code: 'conflict' },
  });
  for (let n = 1; n < 4; n++) await f.feature.begin(inputs(`capture-${n}`, `client-${n}`));
  await expect(f.feature.begin(inputs('capture-4', 'client-4'))).rejects.toMatchObject({
    error: { code: 'quota-exceeded' },
  });
  const upload = f.feature.upload(ticket, 3, clip(), new AbortController().signal);
  await expect(
    f.feature.upload(ticket, 3, clip(), new AbortController().signal),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  expect((await upload).phase).toBe('final');
});
it('expires an idle ticket without inference and retains a finished result from completedAt', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const ticket = await f.feature.begin(inputs());
  await vi.advanceTimersByTimeAsync(119000);
  const result = await f.feature.upload(ticket, 3, clip(), new AbortController().signal);
  expect(result.phase).toBe('final');
  await vi.advanceTimersByTimeAsync(2000);
  expect((await f.feature.result(ticket)).phase).toBe('final');
  await vi.advanceTimersByTimeAsync(118001);
  await expect(f.feature.result(ticket)).rejects.toMatchObject({ error: { code: 'unavailable' } });
  const idle = await f.feature.begin(inputs('idle', 'idle-client'));
  await vi.advanceTimersByTimeAsync(120000);
  expect((await f.feature.result(idle)).phase).toBe('cancelled');
  expect(f.native).toHaveBeenCalledOnce();
});
it('15s body deadline closes and joins the pending iterator with zero native calls', async () => {
  vi.useFakeTimers();
  const blocked = deferred<IteratorResult<Uint8Array>>();
  let returned = false;
  const pcm: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: () => blocked.promise,
      return: async () => {
        returned = true;
        blocked.resolve({ done: true, value: undefined });
        return { done: true, value: undefined };
      },
    }),
  };
  const f = fixture();
  const ticket = await f.feature.begin(inputs());
  const upload = f.feature.upload(ticket, 3, pcm, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(15000);
  expect(returned).toBe(true);
  expect(await upload).toMatchObject({
    phase: 'failed',
    cleanup: 'settled',
    error: { code: 'timeout' },
  });
  expect(f.native).not.toHaveBeenCalled();
});
it('55s absolute upload deadline fences but waits for raw native cleanup', async () => {
  vi.useFakeTimers();
  const release = deferred<VoiceFinal>(),
    started = deferred<void>();
  releases.push(() => release.resolve({ kind: 'no-speech' }));
  const f = fixture(async () => {
    started.resolve();
    return release.promise;
  });
  const ticket = await f.feature.begin(inputs());
  const upload = f.feature.upload(ticket, 3, clip(), new AbortController().signal);
  await started.promise;
  await vi.advanceTimersByTimeAsync(55000);
  expect(await f.feature.result(ticket)).toMatchObject({ phase: 'retiring', cleanup: 'pending' });
  release.resolve({ kind: 'final', text: 'too late' });
  expect(await upload).toMatchObject({
    phase: 'failed',
    outcome: null,
    error: { code: 'timeout' },
  });
});
it('prunes oldest retained terminals and validates body/sample shape before native work', async () => {
  const f = fixture();
  let first: Awaited<ReturnType<SharedVoiceInput['begin']>> | undefined;
  for (let n = 0; n < 33; n++) {
    const ticket = await f.feature.begin(inputs(`capture-${n}`));
    first ??= ticket;
    await f.feature.cancel(ticket);
  }
  if (!first) throw new Error('missing first ticket');
  await expect(f.feature.result(first)).rejects.toMatchObject({ error: { code: 'unavailable' } });
  const ticket = await f.feature.begin(inputs('invalid'));
  expect(
    await f.feature.upload(ticket, 3, clip(new Uint8Array(11)), new AbortController().signal),
  ).toMatchObject({ phase: 'failed', error: { code: 'audio-format' } });
  expect(f.native).not.toHaveBeenCalled();
});
