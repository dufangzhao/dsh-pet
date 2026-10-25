import { expect, it } from 'vitest';
import { CreditMediaSender } from './credit-sender.js';
const identity = {
  streamId: 's',
  taskId: 't',
  owner: { pluginId: 'test.sender', instanceId: 'default', generation: 1 },
};
const frame = (sequence: number) => ({
  header: { ...identity, sequence, byteLength: 1 },
  payload: new Uint8Array([sequence]),
});
it('requires explicit initial credit and rejects over-acknowledgement', async () => {
  const sender = new CreditMediaSender(
    identity,
    async () => ({ ok: true, value: null }),
    new AbortController().signal,
  );
  expect(await sender.send(frame(0))).toMatchObject({ ok: false });
  expect(sender.grant(8).ok).toBe(true);
  expect(sender.grant(1)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  await sender.send(frame(0));
  expect(sender.grant(2).ok).toBe(false);
  expect(sender.grant(1).ok).toBe(true);
  expect(sender.snapshot().credits).toBe(8);
});
it('stops at eight unacknowledged chunks and resumes only on credit', async () => {
  const sender = new CreditMediaSender(
    identity,
    async () => ({ ok: true, value: null }),
    new AbortController().signal,
  );
  sender.grant(8);
  for (let i = 0; i < 8; i++) expect((await sender.send(frame(i))).ok).toBe(true);
  expect(await sender.send(frame(8))).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  const waiting = sender.waitWritable();
  expect(sender.snapshot().waiters).toBe(1);
  sender.grant(1);
  expect((await waiting).ok).toBe(true);
  expect((await sender.send(frame(8))).ok).toBe(true);
});
it('does not call normal end until all sent frames are acknowledged', async () => {
  const sender = new CreditMediaSender(
    identity,
    async () => ({ ok: true, value: null }),
    new AbortController().signal,
  );
  sender.grant(1);
  await sender.send(frame(0));
  expect(sender.end().ok).toBe(false);
  const drained = sender.drain();
  sender.grant(1);
  expect((await drained).ok).toBe(true);
  expect(sender.end()).toEqual({ ok: true, value: 1 });
  sender.cancel();
  expect(sender.snapshot().ended).toBe(true);
});
it('cancels credit waiters and does not retry uncertain writes', async () => {
  const signal = new AbortController();
  const sender = new CreditMediaSender(
    identity,
    async () => ({
      ok: false,
      error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: false },
    }),
    signal.signal,
  );
  const waiting = sender.waitWritable();
  signal.abort();
  expect(await waiting).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  const broken = new CreditMediaSender(
    identity,
    async () => {
      throw new Error('private');
    },
    new AbortController().signal,
  );
  broken.grant(1);
  expect(await broken.send(frame(0))).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(await broken.send(frame(1))).toMatchObject({ ok: false, error: { code: 'unavailable' } });
});
