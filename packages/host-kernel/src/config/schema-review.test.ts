import { expect, it } from 'vitest';
import { prepareConfigDefinition, CONFIG_MAX_VALUE_BYTES } from './schema.js';
it('leaves envelope headroom by enforcing the exact config JSON budget', () => {
  const properties = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => ['f' + i, { type: 'string' }]),
  );
  const result = prepareConfigDefinition({
    version: 1,
    schema: { type: 'object', additionalProperties: false, properties },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const data = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => ['f' + i, 'x'.repeat(4096)]),
  );
  data['f11'] = 'x'.repeat(
    4096 - (Buffer.byteLength(JSON.stringify(data), 'utf8') - CONFIG_MAX_VALUE_BYTES),
  );
  expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBe(CONFIG_MAX_VALUE_BYTES);
  expect(result.value.validate(data).ok).toBe(true);
  data['f11'] += 'x';
  expect(result.value.validate(data)).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
});
