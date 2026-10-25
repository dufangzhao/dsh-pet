import { expect, it, vi } from 'vitest';
import { createPluginHostServices } from './host.js';
import type { PluginHostPort } from './index.js';
const owner = { pluginId: 'test.sdk-review', instanceId: 'default', generation: 1 };
const port = {
  getConfig: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: false },
  }),
  invoke: async () => ({ ok: true, value: null }),
  openInput: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: false },
  }),
  openOutput: async () => ({
    ok: false,
    error: { code: 'not-ready', messageKey: 'errors.not-ready', retryable: false },
  }),
} as PluginHostPort;
it('does not inspect a proxied native signal supplied in scope', () => {
  const calls = vi.fn();
  const signal = new Proxy(new AbortController().signal, {
    getPrototypeOf(target) {
      calls();
      return Reflect.getPrototypeOf(target);
    },
    get(target, key, receiver) {
      calls();
      return Reflect.get(target, key, receiver);
    },
  });
  expect(() => createPluginHostServices({ owner, signal }, port)).toThrow();
  expect(calls).not.toHaveBeenCalled();
});
it('does not run a shadow aborted getter on a native signal', () => {
  const signal = new AbortController().signal,
    getter = vi.fn(() => false);
  Object.defineProperty(signal, 'aborted', { get: getter });
  expect(() => createPluginHostServices({ owner, signal }, port)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
it('does not reflect through a proxied host-port prototype', () => {
  const calls = vi.fn();
  const prototype = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        calls();
        throw new Error('private');
      },
    },
  );
  const fake = Object.create(prototype) as PluginHostPort;
  expect(() =>
    createPluginHostServices({ owner, signal: new AbortController().signal }, fake),
  ).toThrow();
  expect(calls).not.toHaveBeenCalled();
});
