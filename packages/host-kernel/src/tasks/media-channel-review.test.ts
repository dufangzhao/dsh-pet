import { expect, it } from 'vitest';
import { BoundedMediaChannel } from './media-channel.js';
const identity = {
  streamId: 's',
  taskId: 't',
  owner: { pluginId: 'test.media', instanceId: 'default', generation: 1 },
};
const frame = (sequence: number) => ({
  header: { ...identity, sequence, byteLength: 1 },
  payload: new Uint8Array([sequence]),
});
it('does not classify malformed frames as retryable quota while full', () => {
  const q = new BoundedMediaChannel(identity, () => true);
  for (let i = 0; i < 8; i++) q.push(frame(i));
  expect(q.push({ ...frame(8), header: { ...frame(8).header, streamId: 'wrong' } })).toMatchObject({
    ok: false,
    error: { code: 'invalid-input', retryable: false },
  });
});
it('does not rewrite normal empty completion on late external cancellation', async () => {
  const ac = new AbortController();
  const q = new BoundedMediaChannel(identity, () => true, ac.signal);
  expect(q.close(0).ok).toBe(true);
  ac.abort();
  expect(await q[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
  expect(q.push(frame(0))).toMatchObject({ ok: false, error: { code: 'not-ready' } });
});
it('still cancels a closed input while accepted data is waiting to drain', async () => {
  const ac = new AbortController();
  const q = new BoundedMediaChannel(identity, () => true, ac.signal);
  q.push(frame(0));
  q.close(1);
  ac.abort();
  await expect(q[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    error: { code: 'cancelled' },
  });
  expect(q.snapshot().queuedBytes).toBe(0);
});
it('keeps the terminal channel reason over a late waiter signal', async () => {
  const q = new BoundedMediaChannel(identity, () => true);
  q.cancel({ code: 'timeout', messageKey: 'errors.timeout', retryable: false });
  const ac = new AbortController();
  ac.abort();
  expect(await q.waitWritable(1, ac.signal)).toMatchObject({
    ok: false,
    error: { code: 'timeout' },
  });
});
