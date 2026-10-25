import { expect, it, vi } from 'vitest';
import { KnownSecretBoundary } from './secret-boundary.js';
import { ControlEndpoint, type ControlTransport } from '../ipc/control-endpoint.js';
import type { ControlMessage, JsonValue } from '@pet/contracts';
const secret = 'PUBLIC_KNOWN_SECRET';
it('checks actual strings and keys including URL and base64 forms', () => {
  const boundary = new KnownSecretBoundary();
  expect(boundary.observe(secret)).toBe(true);
  for (const value of [
    secret,
    { [secret]: true },
    { data: Buffer.from(secret).toString('base64') },
    { data: encodeURIComponent(secret) },
  ])
    expect(boundary.allowJson(value)).toBe(false);
  expect(boundary.allowJson({ data: 'safe' })).toBe(true);
});
it('does not execute JSON getters or proxies', () => {
  const boundary = new KnownSecretBoundary(),
    getter = vi.fn(() => secret),
    proxy = vi.fn();
  const value = Object.defineProperty({}, 'value', { get: getter, enumerable: true });
  expect(boundary.allowJson(value as never)).toBe(false);
  expect(
    boundary.allowJson(
      new Proxy(
        {},
        {
          getPrototypeOf() {
            proxy();
            return null;
          },
        },
      ) as never,
    ),
  ).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(proxy).not.toHaveBeenCalled();
});
it('blocks a known value spanning two normal-media frames', () => {
  const boundary = new KnownSecretBoundary();
  boundary.observe(secret);
  const owner = { pluginId: 'test.guard', instanceId: 'default', generation: 1 },
    frame = (text: string, sequence: number) => ({
      header: {
        owner,
        streamId: 'stream',
        taskId: 'task',
        sequence,
        byteLength: Buffer.byteLength(text),
      },
      payload: Buffer.from(text),
    });
  expect(boundary.allowFrame(frame(secret.slice(0, 8), 0))).toBe(true);
  expect(boundary.allowFrame(frame(secret.slice(8), 1))).toBe(false);
  boundary.forget('stream');
  expect(boundary.allowFrame(frame('safe', 0))).toBe(true);
});
it('fails closed rather than evicting old known values on registration overflow', () => {
  const boundary = new KnownSecretBoundary();
  expect(boundary.observe(secret)).toBe(true);
  let refused = false;
  for (let i = 0; i < 100; i++) if (!boundary.observe((i + '-').padEnd(16000, 'z'))) refused = true;
  expect(refused).toBe(true);
  expect(boundary.allowJson(secret)).toBe(false);
});
it('does not put known request or response values on the control transport', async () => {
  const sent: ControlMessage[] = [],
    listeners: Array<(value: unknown) => void> = [];
  const transport = (index: number): ControlTransport => ({
    send: async (message) => {
      sent.push(message);
      queueMicrotask(() => listeners[1 - index]!(message));
    },
    onMessage: (listener) => {
      listeners[index] = listener;
      return () => {};
    },
    onClose: () => () => {},
    close() {},
  });
  const boundary = new KnownSecretBoundary();
  boundary.observe(secret);
  const options = {
    sessionId: 'guard',
    owner: { pluginId: 'core.guard', instanceId: 'default', generation: 1 },
    live: () => true,
    allowJson: (value: JsonValue) => boundary.allowJson(value),
  };
  const a = new ControlEndpoint(transport(0), options),
    b = new ControlEndpoint(transport(1), {
      ...options,
      handlers: { echo: async () => ({ ok: true, value: secret }) },
    });
  expect(await a.request('echo', { secret })).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(sent).toHaveLength(0);
  expect(await a.request('echo', null)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  expect(JSON.stringify(sent)).not.toContain(secret);
  a.close();
  b.close();
});
