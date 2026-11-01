import { expect, it } from 'vitest';
import { synthesizePetTones } from './tones.js';
it('emits finite non-silent PCM with a bounded duration even for a long reply', () => {
  const pcm = synthesizePetTones('你好'.repeat(2000), new AbortController().signal);
  expect(pcm.byteLength).toBe(24 * 1680 * 2);
  const view = new DataView(pcm.buffer);
  let peak = 0;
  for (let i = 0; i < pcm.byteLength; i += 2)
    peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
  expect(peak).toBeGreaterThan(1000);
  expect(peak).toBeLessThan(32767);
});
it('does not synthesize after cancellation', () => {
  const abort = new AbortController();
  abort.abort();
  expect(() => synthesizePetTones('你好', abort.signal)).toThrow();
});
