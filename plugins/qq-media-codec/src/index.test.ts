import { expect, it } from 'vitest';
import { parseCodecConfig } from './index.js';

it('requires an exact image and manifest rather than a mutable tag, path or URL', () => {
  const pin = { imageId: `sha256:${'a'.repeat(64)}`, manifestSha256: 'b'.repeat(64) };
  expect(parseCodecConfig(pin)).toEqual(pin);
  for (const value of [
    { imageId: 'node:latest', manifestSha256: pin.manifestSha256 },
    { imageId: 'https://registry.example/image', manifestSha256: pin.manifestSha256 },
    { imageId: pin.imageId, manifestSha256: '' },
    { ...pin, inputPath: '/private/account' },
    {},
  ])
    expect(() => parseCodecConfig(value)).toThrow();
});
