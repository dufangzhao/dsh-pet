import { afterEach, expect, it, vi } from 'vitest';
import type { ControlMessage, OwnerRef } from '@pet/contracts';
import { ControlEndpoint, type ControlTransport, type RpcHandler } from './control-endpoint.js';
const owner: OwnerRef = { pluginId: 'core.runtime', instanceId: 'peer-1', generation: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
class MemoryTransport implements ControlTransport {
  peer!: MemoryTransport;
  listeners = new Set<(value: unknown) => void>();
  closers = new Set<() => void>();
  closed = false;
  sent: ControlMessage[] = [];
  async send(message: ControlMessage) {
    if (this.closed) throw new Error('closed');
    this.sent.push(structuredClone(message));
    queueMicrotask(() => {
      if (!this.peer.closed) for (const fn of this.peer.listeners) fn(structuredClone(message));
    });
  }
  onMessage(fn: (value: unknown) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  onClose(fn: () => void) {
    this.closers.add(fn);
    return () => {
      this.closers.delete(fn);
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of [...this.closers]) fn();
    this.peer.close();
  }
  inject(value: unknown) {
    for (const fn of this.listeners) fn(value);
  }
}
const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});
function setup(handlers: Record<string, RpcHandler> = {}, maxPending = 64) {
  const a = new MemoryTransport(),
    b = new MemoryTransport();
  a.peer = b;
  b.peer = a;
  const client = new ControlEndpoint(a, {
    sessionId: 'session',
    owner,
    live: () => true,
    maxPending,
  });
  const server = new ControlEndpoint(b, {
    sessionId: 'session',
    owner,
    live: () => true,
    handlers,
    maxPending,
  });
  stops.push(() => client.close());
  return { a, b, client, server };
}
it('round trips fixed-identity calls and cleans request state', async () => {
  const p = setup({ echo: async (_ctx, value) => ({ ok: true, value }) });
  expect(await p.client.request('echo', { value: 1 })).toEqual({ ok: true, value: { value: 1 } });
  expect(p.client.diagnostics().pendingRequests).toBe(0);
  expect(p.a.sent[0]).toMatchObject({ id: 'm-1', taskId: 'rpc-1' });
});
it('rejects methods outside the peer allowlist', async () => {
  const p = setup();
  expect(await p.client.request('private.execute', null)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
});
it('refuses malformed requests without consuming a message sequence', async () => {
  const p = setup({ echo: async (_ctx, value) => ({ ok: true, value }) });
  expect(await p.client.request('bad/method', null)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(await p.client.request('echo', true)).toEqual({ ok: true, value: true });
  expect(p.a.sent[0]?.id).toBe('m-1');
});
it('closes on a forged session or owner', async () => {
  const p = setup();
  p.a.inject({
    protocol: 1,
    sessionId: 'other',
    id: 'm-1',
    owner,
    type: 'response',
    replyTo: 'm-1',
    result: { ok: true, value: null },
  });
  expect(p.client.diagnostics().closed).toBe(true);
  expect(p.a.listeners.size).toBe(0);
});
it('closes on replay instead of remembering unbounded request IDs', async () => {
  const p = setup({ echo: async (_ctx, value) => ({ ok: true, value }) });
  await p.client.request('echo', 1);
  p.b.inject(p.a.sent[0]);
  expect(p.server.diagnostics().closed).toBe(true);
});
it('forwards cancellation even without an explicit task ID', async () => {
  const entered = deferred<AbortSignal>();
  const gate = deferred<null>();
  const p = setup({
    slow: async (ctx) => {
      entered.resolve(ctx.signal);
      await gate.promise;
      return { ok: true, value: 'late' };
    },
  });
  const ac = new AbortController();
  const result = p.client.request('slow', null, { signal: ac.signal });
  const signal = await entered.promise;
  ac.abort();
  expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
  expect(p.a.sent.some((m) => m.type === 'cancel')).toBe(true);
  gate.resolve(null);
});
it('counts cancelled uncooperative handlers against inbound capacity', async () => {
  const entered = deferred<void>(),
    gate = deferred<null>();
  const p = setup(
    {
      slow: async () => {
        entered.resolve();
        await gate.promise;
        return { ok: true, value: null };
      },
    },
    1,
  );
  const ac = new AbortController();
  const one = p.client.request('slow', null, { signal: ac.signal });
  await entered.promise;
  ac.abort();
  await one;
  expect(await p.client.request('slow', null)).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  gate.resolve(null);
});
it('times out a call and ignores its later response', async () => {
  vi.useFakeTimers();
  const gate = deferred<null>();
  const p = setup({
    slow: async () => {
      await gate.promise;
      return { ok: true, value: null };
    },
  });
  const result = p.client.request('slow', null, { budgetMs: 20 });
  await vi.advanceTimersByTimeAsync(21);
  expect(await result).toMatchObject({ ok: false, error: { code: 'timeout' } });
  gate.resolve(null);
  await vi.runAllTimersAsync();
  expect(p.client.diagnostics().pendingRequests).toBe(0);
});
it('disconnect rejects outstanding calls and aborts handlers', async () => {
  const entered = deferred<AbortSignal>(),
    gate = deferred<null>();
  const p = setup({
    slow: async (ctx) => {
      entered.resolve(ctx.signal);
      await gate.promise;
      return { ok: true, value: null };
    },
  });
  const result = p.client.request('slow', null);
  const signal = await entered.promise;
  p.server.close();
  expect(await result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(signal.aborted).toBe(true);
  expect(p.a.listeners.size).toBe(0);
  expect(p.b.listeners.size).toBe(0);
  gate.resolve(null);
});
it('does not echo handler exceptions or invalid result payloads', async () => {
  const p = setup({
    bad: async () => {
      throw new Error('private-token');
    },
    large: async () => ({ ok: true, value: 'x'.repeat(70000) }),
  });
  const first = await p.client.request('bad', null);
  expect(first).toMatchObject({ ok: false, error: { code: 'internal' } });
  expect(JSON.stringify(first)).not.toContain('private-token');
  expect(await p.client.request('large', null)).toMatchObject({
    ok: false,
    error: { code: 'internal' },
  });
});
it('does not allow a stream-control caller to replace headers or issue RPC methods', () => {
  const p = setup();
  expect(
    p.client.streamControl({
      type: 'stream-credit',
      streamId: 's',
      taskId: 't',
      credits: 1,
      sessionId: 'other',
    } as never),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(
    p.client.streamControl({ type: 'request', method: 'private.execute', payload: null } as never),
  ).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  expect(p.a.sent).toEqual([]);
});
