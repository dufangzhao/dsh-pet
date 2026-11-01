import { expect, it } from 'vitest';
import { prepareConfigDefinition } from './schema.js';
const field = { type: ['string', 'null'], maxLength: 8, default: null };
const definition = (properties: unknown) => ({
  version: 1,
  schema: { type: 'object', additionalProperties: false, properties },
});
it('accepts bounded nullable values and keeps null defaults explicit', () => {
  const prepared = prepareConfigDefinition(
    definition({
      voice: field,
      provider: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: { id: { type: 'string', maxLength: 8 } },
        default: null,
      },
    }),
  );
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  expect(prepared.value.defaults).toEqual({ voice: null, provider: null });
  expect(prepared.value.validate({ voice: null, provider: null }).ok).toBe(true);
  expect(prepared.value.validate({ voice: 'local', provider: { id: 'one' } }).ok).toBe(true);
  expect(prepared.value.validate({ voice: 3, provider: null }).ok).toBe(false);
  expect(prepared.value.validate({ voice: '123456789', provider: null }).ok).toBe(false);
  expect(prepared.value.validate({ voice: null, provider: { unknown: 1 } }).ok).toBe(false);
});
it('does not broaden arbitrary unions, root values or credential exposure', () => {
  expect(
    prepareConfigDefinition(definition({ x: { type: ['string', 'number', 'null'] } })).ok,
  ).toBe(false);
  expect(prepareConfigDefinition(definition({ x: { type: ['null', 'null'] } })).ok).toBe(false);
  expect(prepareConfigDefinition(definition({ apiKey: field })).ok).toBe(false);
  expect(
    prepareConfigDefinition({
      version: 1,
      schema: { type: ['object', 'null'], additionalProperties: false, properties: {} },
    }).ok,
  ).toBe(false);
});
