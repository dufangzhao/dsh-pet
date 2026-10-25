import { expect, it, vi } from 'vitest';
import type { MediaFrame } from '@pet/contracts';
import { SensitivePeer } from './sensitive-peer.js';
const owner = { pluginId: 'test.sensitive', instanceId: 'default', generation: 1 },
  ref = { owner, taskId: 'task', streamId: 'secret-transfer' };
function pair() {
  const frames: Array<{ sequence: number; bytes: number }> = [];
  const observed = vi.fn(() => true);
  const a: SensitivePeer = new SensitivePeer({
      write: async (frame) => {
        frames.push({ sequence: frame.header.sequence, bytes: frame.payload.byteLength });
        return b.receive(frame);
      },
    }),
    b: SensitivePeer = new SensitivePeer({
      write: async (frame) => {
        frames.push({ sequence: frame.header.sequence, bytes: frame.payload.byteLength });
        return a.receive(frame);
      },
      observe: observed,
    });
  return { a, b, frames, observed };
}
it('delivers once and keeps callback result out of the ACK', async () => {
  const { a, b, frames, observed } = pair(),
    scope = new AbortController();
  const accepted = b.accept(ref, scope.signal, async (secret) => {
    expect(secret).toBe('PUBLIC_FIXTURE');
    return { privateResult: secret };
  });
  const sent = a.send(ref, 'PUBLIC_FIXTURE', scope.signal);
  expect(await accepted).toEqual({ ok: true, value: { privateResult: 'PUBLIC_FIXTURE' } });
  expect(await sent).toEqual({ ok: true, value: null });
  await Promise.all([a.drain(), b.drain()]);
  expect(frames).toEqual([
    { sequence: 0, bytes: 14 },
    { sequence: 1, bytes: 0 },
  ]);
  expect(observed).toHaveBeenCalledOnce();
  expect(a.diagnostics().pending).toBe(0);
  expect(b.diagnostics().running).toBe(0);
  expect(await a.send(ref, 'PUBLIC_FIXTURE', scope.signal)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  a.close();
  b.close();
});
it('does not decode or deliver an unknown reference and wipes received bytes', () => {
  const peer = new SensitivePeer({ write: async () => ({ ok: true, value: null }) }),
    bytes = Buffer.from('PUBLIC_FIXTURE');
  const result = peer.receive({
    header: { ...ref, sequence: 0, byteLength: bytes.length },
    payload: bytes,
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(bytes.every((v) => v === 0)).toBe(true);
  peer.close();
});
it('refuses a cross-owner reference', async () => {
  const { a, b } = pair(),
    scope = new AbortController(),
    operation = vi.fn(async () => true);
  const accepted = b.accept(ref, scope.signal, operation);
  expect(
    await a.send({ ...ref, owner: { ...owner, generation: 2 } }, 'PUBLIC_FIXTURE', scope.signal),
  ).toMatchObject({ ok: false });
  b.close();
  expect(await accepted).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(operation).not.toHaveBeenCalled();
  a.close();
});
it('drops a known late delivery after cancellation without running the callback', async () => {
  const peer = new SensitivePeer({ write: async () => ({ ok: true, value: null }) }),
    scope = new AbortController(),
    operation = vi.fn(async () => true);
  const accepted = peer.accept(ref, scope.signal, operation);
  scope.abort();
  expect(await accepted).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  const bytes = Buffer.from('PUBLIC_FIXTURE');
  expect(
    peer.receive({ header: { ...ref, sequence: 0, byteLength: bytes.length }, payload: bytes }).ok,
  ).toBe(true);
  expect(bytes.every((v) => v === 0)).toBe(true);
  expect(operation).not.toHaveBeenCalled();
  await peer.drain();
  peer.close();
});
it('retains cancelled uncooperative work until it physically settles', async () => {
  const { a, b } = pair(),
    scope = new AbortController();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const accepted = b.accept(ref, scope.signal, async () => {
    entered();
    await gate;
    return true;
  });
  const sent = a.send(ref, 'PUBLIC_FIXTURE', scope.signal);
  await started;
  scope.abort();
  expect(await accepted).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(await sent).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(b.diagnostics().running).toBe(1);
  release();
  await Promise.all([a.drain(), b.drain()]);
  expect(b.diagnostics().running).toBe(0);
  a.close();
  b.close();
});
it('refuses invalid UTF8, oversized secrets and nonempty ACK payload', async () => {
  const peer = new SensitivePeer({ write: async () => ({ ok: true, value: null }) }),
    scope = new AbortController();
  expect(await peer.send(ref, 'x'.repeat(16385), scope.signal)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  const accepted = peer.accept(ref, scope.signal, async () => true);
  const invalid: MediaFrame = {
    header: { ...ref, sequence: 0, byteLength: 1 },
    payload: new Uint8Array([255]),
  };
  expect(peer.receive(invalid).ok).toBe(false);
  peer.close();
  await accepted;
});
