import { expect, it, vi } from 'vitest';
import type { Result } from '@pet/contracts';
import { SensitivePeer } from './sensitive-peer.js';
const owner = { pluginId: 'test.sensitive-review', instanceId: 'default', generation: 1 };
const reference = { owner, taskId: 'task', streamId: 'request' };
it('does not accept an ACK before any delivery has started', async () => {
  const peer = new SensitivePeer({ write: async () => ({ ok: true, value: null }) }),
    scope = new AbortController();
  const sending = peer.send(reference, 'PUBLIC_REVIEW', scope.signal);
  expect(
    peer.receive({
      header: { ...reference, sequence: 1, byteLength: 0 },
      payload: new Uint8Array(0),
    }),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  peer.close();
  expect(await sending).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  await peer.drain();
});
it('normalizes malformed native-port results without leaking their text', async () => {
  const peer = new SensitivePeer({
    write: async () => ({ ok: true, value: 'private-port' }) as unknown as Result<null>,
  });
  const result = await peer.send(reference, 'PUBLIC_REVIEW', new AbortController().signal);
  expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(JSON.stringify(result)).not.toContain('private-port');
  await peer.drain();
  peer.close();
});
it('does not start the callback when the observation gate refuses the value', async () => {
  const operation = vi.fn(async () => true),
    peer = new SensitivePeer({
      write: async () => ({ ok: true, value: null }),
      observe: () => false,
    }),
    scope = new AbortController();
  const accepting = peer.accept(reference, scope.signal, operation),
    payload = Buffer.from('PUBLIC_REVIEW');
  expect(
    peer.receive({ header: { ...reference, sequence: 0, byteLength: payload.length }, payload }).ok,
  ).toBe(true);
  expect(await accepting).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
  expect(operation).not.toHaveBeenCalled();
  expect(payload.every((v) => v === 0)).toBe(true);
  await peer.drain();
  peer.close();
});
it('retains all 32 callback slots after logical cancellation until actual settlement', async () => {
  const peer = new SensitivePeer({ write: async () => ({ ok: true, value: null }) }),
    scope = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const accepting = [];
  for (let i = 0; i < 32; i++) {
    const ref = { ...reference, streamId: 'r' + i };
    accepting.push(
      peer.accept(ref, scope.signal, async () => {
        await gate;
        return true;
      }),
    );
    const payload = Buffer.from('PUBLIC_REVIEW');
    expect(
      peer.receive({ header: { ...ref, sequence: 0, byteLength: payload.length }, payload }).ok,
    ).toBe(true);
  }
  scope.abort();
  expect((await Promise.all(accepting)).every((r) => !r.ok)).toBe(true);
  expect(peer.diagnostics().running).toBe(32);
  expect(
    await peer.accept(
      { ...reference, streamId: 'later' },
      new AbortController().signal,
      async () => true,
    ),
  ).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
  release();
  await peer.drain();
  expect(peer.diagnostics().running).toBe(0);
  peer.close();
});
it('bounds an unanswered registration by its timeout', async () => {
  vi.useFakeTimers();
  try {
    const peer = new SensitivePeer({
        write: async () => ({ ok: true, value: null }),
        timeoutMs: 100,
      }),
      operation = vi.fn(async () => true);
    const accepting = peer.accept(reference, new AbortController().signal, operation);
    await vi.advanceTimersByTimeAsync(100);
    expect(await accepting).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(operation).not.toHaveBeenCalled();
    await peer.drain();
    peer.close();
  } finally {
    vi.useRealTimers();
  }
});
