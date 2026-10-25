import { expect, it } from 'vitest';
import { SecretRedactor } from './redactor.js';
it('omits a whole diagnostic containing raw or commonly encoded secret values', () => {
  const r = new SecretRedactor();
  const secret = 'public-fixture-token';
  r.add(secret);
  for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')])
    expect(r.redact('Bearer ' + value)).toBe('[REDACTED diagnostic]');
});
it('short keys do not recursively expand replacement markers', () => {
  const r = new SecretRedactor();
  r.add('R');
  r.add('E');
  expect(r.redact('RE')).toBe('[REDACTED diagnostic]');
});
it('does not invoke diagnostic getters or proxy traps', () => {
  const r = new SecretRedactor();
  let calls = 0;
  const error = new Error();
  Object.defineProperty(error, 'message', {
    get() {
      calls++;
      throw new Error('private');
    },
  });
  expect(r.redact(error)).toBe('[non-text error]');
  expect(
    r.redact(
      new Proxy(error, {
        getPrototypeOf() {
          calls++;
          throw new Error('private');
        },
      }),
    ),
  ).toBe('[non-text diagnostic]');
  expect(calls).toBe(0);
});
it('omits oversized diagnostics instead of leaking a truncated secret', () => {
  const r = new SecretRedactor();
  expect(r.redact('x'.repeat(8193))).toBe('[oversized diagnostic omitted]');
});
