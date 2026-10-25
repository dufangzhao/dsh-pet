import { expect, it } from 'vitest';
import { jsonPreflight } from './json-preflight.js';
import { validateMediaFrame } from './validate.js';
it('rejects a proxy before any user trap can execute', () => {
  let touched = 0;
  const proxy = new Proxy(
    { value: 1 },
    {
      ownKeys() {
        touched++;
        return ['value'];
      },
      getPrototypeOf() {
        touched++;
        return Object.prototype;
      },
      getOwnPropertyDescriptor() {
        touched++;
        return { value: 1, enumerable: true, configurable: true };
      },
      get() {
        touched++;
        return 1;
      },
    },
  );
  expect(jsonPreflight(proxy).ok).toBe(false);
  expect(touched).toBe(0);
});
it('rejects unrepresentable own array properties rather than silently discarding them', () => {
  const value: unknown[] = [1];
  Object.defineProperty(value, 'extra', { value: 'not-json', enumerable: true });
  expect(jsonPreflight(value).ok).toBe(false);
});
it('rejects non-enumerable accessors without invoking them', () => {
  let touched = 0;
  const value = { a: 1 };
  Object.defineProperty(value, 'hidden', {
    get() {
      touched++;
      return 'secret';
    },
    enumerable: false,
  });
  expect(jsonPreflight(value).ok).toBe(false);
  expect(touched).toBe(0);
});
const header = {
  streamId: 's',
  taskId: 't',
  owner: { pluginId: 'test.media', instanceId: 'default', generation: 1 },
  sequence: 0,
  byteLength: 1,
};
it('media validation does not invoke envelope getters', () => {
  let calls = 0;
  const frame = {
    header,
    get payload() {
      calls++;
      return new Uint8Array([1]);
    },
  };
  expect(validateMediaFrame(frame).ok).toBe(false);
  expect(calls).toBe(0);
});
it('media validation rejects proxies without touching traps', () => {
  let calls = 0;
  const frame = new Proxy(
    { header, payload: new Uint8Array([1]) },
    {
      ownKeys() {
        calls++;
        return ['header', 'payload'];
      },
    },
  );
  expect(validateMediaFrame(frame).ok).toBe(false);
  expect(calls).toBe(0);
});
it('media validation owns a snapshot and ignores spoofed typed-array accessors', () => {
  let calls = 0;
  const payload = new Uint8Array([7]);
  Object.defineProperty(payload, 'byteLength', {
    get() {
      calls++;
      return 999;
    },
  });
  const result = validateMediaFrame({ header, payload });
  expect(result.ok).toBe(true);
  expect(calls).toBe(0);
  if (result.ok) {
    payload[0] = 9;
    expect(result.value.payload[0]).toBe(7);
    expect(result.value.payload).not.toBe(payload);
  }
});
