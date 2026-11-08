import { expect, it } from 'vitest';
import { parseMagpieConfig, describeMagpieConfig } from './index.js';

it('describes the default loopback client label without claiming a saved secret or model', () => {
  expect(
    describeMagpieConfig({
      baseUrl: 'http://127.0.0.1:3425/v1/',
      model: '',
      authMode: 'local-client-id',
    }),
  ).toEqual({
    label: 'Magpie',
    synthetic: false,
    settings: { baseUrl: 'http://127.0.0.1:3425/v1', model: '', authMode: 'local-client-id' },
    model: null,
    credentialRequired: false,
    credentialWritable: false,
  });
});

it.each([
  ['http://example.test/v1', 'gateway-key'],
  ['https://example.test/v1', 'local-client-id'],
  ['https://user:password@example.test/v1', 'gateway-key'],
  ['https://example.test/v1?key=x', 'gateway-key'],
  ['https://example.test/v1#key', 'gateway-key'],
  ['file:///tmp/model', 'gateway-key'],
])('refuses unsafe endpoint/auth pair %s %s', (baseUrl, authMode) => {
  expect(() => parseMagpieConfig({ baseUrl, model: 'provider/model', authMode })).toThrow();
});

it('retains the full normalized endpoint path for independent remote gateway credentials', () => {
  expect(
    parseMagpieConfig({
      baseUrl: 'https://EXAMPLE.test:443/owner-a/v1/',
      model: 'provider/model',
      authMode: 'gateway-key',
    }),
  ).toEqual({
    baseUrl: 'https://example.test/owner-a/v1',
    model: 'provider/model',
    authMode: 'gateway-key',
  });
});
