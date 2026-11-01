import { afterEach, expect, it, vi } from 'vitest';
import type { ControlMessage } from '@pet/contracts';
import { ControlEndpoint, type ControlTransport } from './control-endpoint.js';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.useRealTimers();
});
function pair() {
  const receivers: ((message: unknown) => void)[] = [];
  const sent: ControlMessage[] = [];
  let budget: number | null | undefined;
  let aborted = false;
  const transport = (index: number): ControlTransport => ({
    send: async (message) => {
      sent.push(message);
      queueMicrotask(() => receivers[1 - index]?.(message));
    },
    onMessage: (listener) => {
      receivers[index] = listener;
      return () => {};
    },
    onClose: () => () => {},
    close() {},
  });
  const options = {
    sessionId: 'owner-scoped',
    owner: { pluginId: 'core.runtime', instanceId: 'peer', generation: 1 },
    live: () => true,
  };
  const client = new ControlEndpoint(transport(0), options),
    server = new ControlEndpoint(transport(1), {
      ...options,
      workCompletionMethods: ['runtime.invoke'],
      handlers: {
        'runtime.invoke': async (context) => {
          budget = context.budgetMs;
          await new Promise<void>((resolve) => {
            context.signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            );
          });
          return { ok: true, value: null };
        },
      },
    });
  cleanup.push(() => {
    client.close();
    server.close();
  });
  return { client, server, sent, budget: () => budget, aborted: () => aborted };
}
it('keeps an owner-scoped runtime invocation alive beyond the RPC default and finite cap until owner cancellation', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = pair(),
    owner = new AbortController();
  const result = f.client.request('runtime.invoke', null, {
    taskId: 'native-key-listener',
    signal: owner.signal,
    budgetMs: null,
    waitForWork: true,
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.client.diagnostics().pendingRequests).toBe(1);
  expect(f.budget()).toBeNull();
  await vi.advanceTimersByTimeAsync(2 * 86400000);
  expect(f.aborted()).toBe(false);
  expect(f.client.diagnostics().pendingRequests).toBe(1);
  expect(f.server.diagnostics().runningHandlers).toBe(1);
  owner.abort();
  expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(f.aborted()).toBe(true);
  expect(f.client.diagnostics().pendingRequests).toBe(0);
});
it('requires a tracked task signal and physical-work completion for an owner-scoped call', async () => {
  const f = pair();
  for (const options of [
    { taskId: 'key', budgetMs: null, waitForWork: true },
    { taskId: 'key', budgetMs: null, signal: new AbortController().signal },
  ])
    expect(await f.client.request('runtime.invoke', null, options)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
  expect(f.sent).toEqual([]);
});
