import { expect, it, vi } from 'vitest';
import { ControlEndpoint, type ControlTransport } from './control-endpoint.js';
import type { ControlMessage, JsonValue } from '@pet/contracts';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(workMode = true, maxPending = 2) {
  const entered = deferred<void>(),
    aborted = deferred<void>(),
    gate = deferred<JsonValue>();
  const sent: ControlMessage[] = [];
  const receive: Array<(value: unknown) => void> = [];
  const transport = (index: number): ControlTransport => ({
    send: async (message) => {
      sent.push(message);
      queueMicrotask(() => receive[1 - index]!(message));
    },
    onMessage: (listener) => {
      receive[index] = listener;
      return () => {};
    },
    onClose: () => () => {},
    close() {},
  });
  const options = {
    sessionId: 'work-completion',
    owner: { pluginId: 'core.work', instanceId: 'default', generation: 1 },
    live: () => true,
    maxPending,
  };
  const a = new ControlEndpoint(transport(0), options),
    b = new ControlEndpoint(transport(1), {
      ...options,
      ...(workMode ? { workCompletionMethods: ['work'] } : {}),
      handlers: {
        work: async (ctx) => {
          ctx.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
          entered.resolve();
          return { ok: true, value: await gate.promise };
        },
        echo: async () => ({ ok: true, value: null }),
      },
    });
  return {
    a,
    b,
    sent,
    entered,
    aborted,
    gate,
    close() {
      gate.resolve(null);
      a.close();
      b.close();
    },
  };
}
it('holds client and handler capacity after cancellation until actual work returns', async () => {
  const f = fixture(),
    signal = new AbortController();
  try {
    const result = f.a.request('work', null, { signal: signal.signal, waitForWork: true });
    await f.entered.promise;
    signal.abort();
    await f.aborted.promise;
    expect(f.a.diagnostics().pendingRequests).toBe(1);
    expect(f.b.diagnostics().runningHandlers).toBe(1);
    f.gate.resolve('LATE_PRIVATE_VALUE');
    expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(JSON.stringify(f.sent.filter((message) => message.type === 'response'))).not.toContain(
      'LATE_PRIVATE_VALUE',
    );
    expect(f.a.diagnostics().pendingRequests).toBe(0);
  } finally {
    f.close();
  }
});
it('keeps a timed-out work request in its capacity until the handler settles', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = fixture(true, 1);
  try {
    const result = f.a.request('work', null, { budgetMs: 100, waitForWork: true });
    await f.entered.promise;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.a.diagnostics().pendingRequests).toBe(1);
    expect(await f.a.request('echo', null)).toMatchObject({
      ok: false,
      error: { code: 'quota-exceeded' },
    });
    f.gate.resolve('LATE');
    expect(await result).toMatchObject({ ok: false, error: { code: 'timeout' } });
  } finally {
    f.close();
    vi.useRealTimers();
  }
});
it('preserves the existing fast logical cancellation mode for other RPCs', async () => {
  const f = fixture(false),
    scope = new AbortController();
  try {
    const result = f.a.request('work', null, { signal: scope.signal });
    await f.entered.promise;
    scope.abort();
    expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(f.a.diagnostics().pendingRequests).toBe(0);
    expect(f.b.diagnostics().runningHandlers).toBe(1);
  } finally {
    f.close();
  }
});
it('returns transport failure on closure so the owning driver can wait for exit proof', async () => {
  const f = fixture();
  try {
    const result = f.a.request('work', null, { waitForWork: true });
    await f.entered.promise;
    f.a.close();
    expect(await result).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  } finally {
    f.close();
  }
});
it('does not start any physical request for a pre-aborted work scope', async () => {
  const f = fixture(),
    scope = new AbortController();
  try {
    scope.abort();
    expect(
      await f.a.request('work', null, { signal: scope.signal, waitForWork: true }),
    ).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(f.sent).toHaveLength(0);
  } finally {
    f.close();
  }
});
it('keeps the first cancellation reason despite the later timer deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = fixture(),
    scope = new AbortController();
  try {
    const result = f.a.request('work', null, {
      signal: scope.signal,
      budgetMs: 100,
      waitForWork: true,
    });
    await f.entered.promise;
    scope.abort();
    await f.aborted.promise;
    await vi.advanceTimersByTimeAsync(100);
    f.gate.resolve(null);
    expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  } finally {
    f.close();
    vi.useRealTimers();
  }
});
