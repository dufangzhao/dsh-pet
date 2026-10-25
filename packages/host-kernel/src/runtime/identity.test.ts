import { expect, it } from 'vitest';
import { featureSubset } from './identity.js';
import { isSameCapability } from '@pet/contracts';
it('matches recursive feature subsets conservatively', () => {
  expect(featureSubset({ stream: true }, { stream: true, local: true })).toBe(true);
  expect(featureSubset({ mode: { partial: true } }, { mode: { partial: false } })).toBe(false);
  expect(featureSubset({ rates: [16000] }, { rates: [16000, 48000] })).toBe(false);
  expect(featureSubset(undefined, undefined)).toBe(true);
});
it('does not equate identical invalid capability names', () => {
  expect(isSameCapability('', '')).toBe(false);
  expect(isSameCapability('invalid', 'invalid')).toBe(false);
  expect(isSameCapability('test.echo@1', 'test.echo@1')).toBe(true);
});
