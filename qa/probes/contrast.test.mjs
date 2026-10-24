import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseColor, composite, contrastRatio, checkContrast } from './contrast.mjs';
test('known black/white and same-color vectors', () => {
  assert.equal(contrastRatio(parseColor('#000'), parseColor('#fff')), 21);
  assert.equal(contrastRatio(parseColor('#ffffff'), parseColor('#fff')), 1);
});
test('identifies the original failing accent', () => {
  const ratio = contrastRatio(parseColor('#fff'), parseColor('#4c7df0'));
  assert.ok(Math.abs(ratio - 3.8188759686347287) < 1e-10);
});
test('parses RGB, percentages and alpha', () => {
  assert.deepEqual(parseColor('rgba(255, 0, 0, 0.5)'), [255, 0, 0, 0.5]);
  assert.deepEqual(parseColor('rgb(0 0 0 / 50%)'), [0, 0, 0, 0.5]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
});
test('composites a translucent white surface over black', () => {
  assert.deepEqual(composite([255, 255, 255, 0.94], [0, 0, 0, 1]), [239.7, 239.7, 239.7, 1]);
});
test('rejects unsupported or invalid colors rather than passing them', () => {
  for (const value of ['currentcolor', 'hsl(0 0 0)', 'rgb(999,0,0)', 'rgba(0,0,0,2)', 'rgb(0,0)', 'rgb(NaN,0,0)', 'rgb(12junk,0,0)', 'rgb(0x10,0,0)', 'rgb(1,,2,3)', 'rgb(1,2,3 / 50%)', 'rgb(1 2 3 0.5)']) {
    assert.throws(() => parseColor(value));
  }
});
test('checks both extreme backdrops and refuses unaccounted opacity', () => {
  const sample = { id: 'text', color: '#46536a', backgrounds: ['rgba(255,255,255,0.94)', 'transparent'], opacities: ['1', '1'] };
  assert.equal(checkContrast(sample).passed, true);
  assert.throws(() => checkContrast({ ...sample, opacities: ['0.5'] }));
  assert.throws(() => checkContrast({ ...sample, opacities: ['NaN'] }));
});
