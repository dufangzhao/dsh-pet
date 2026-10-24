// Small, fail-closed WCAG contrast helper for M0 computed-style verification.
export function parseColor(value) {
  const text = String(value).trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  if (/^#[0-9a-f]{3}$/.test(text)) return [...text.slice(1)].map(c => parseInt(c + c, 16)).concat(1);
  if (/^#[0-9a-f]{6}$/.test(text)) return [1, 3, 5].map(i => parseInt(text.slice(i, i + 2), 16)).concat(1);
  const match = /^rgba?[(](.*)[)]$/.exec(text);
  if (!match) throw new Error('Unsupported computed color: ' + text);
  const body = match[1].trim();
  const whitespace = value => [...value].map(c => [9,10,12,13,32].includes(c.charCodeAt(0)) ? ' ' : c).join('');
  let parts;
  if (body.includes(',')) {
    if (body.includes('/')) throw new Error('Mixed RGB separators');
    parts = body.split(',').map(v => v.trim());
  } else {
    const segments = body.split('/');
    if (segments.length > 2) throw new Error('Too many alpha separators');
    parts = whitespace(segments[0]).split(' ').filter(Boolean);
    if (parts.length !== 3) throw new Error('Space RGB needs exactly three color components');
    if (segments.length === 2) parts.push(segments[1].trim());
  }
  if (parts.length !== 3 && parts.length !== 4) throw new Error('Invalid color component count');
  const decimal = /^[-+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:[eE][-+]?[0-9]+)?$/;
  const values = parts.map((part, i) => {
    const percent = part.endsWith('%'), number = percent ? part.slice(0, -1) : part;
    if (!decimal.test(number)) throw new Error('Invalid numeric color component');
    return Number(number) * (percent ? (i === 3 ? 1 : 255) / 100 : 1);
  });
  if (values.length === 3) values.push(1);
  if (values.some((v, i) => !Number.isFinite(v) || v < 0 || v > (i === 3 ? 1 : 255))) throw new Error('Invalid color component');
  return values;
}
export function composite(front, back) {
  const alpha = front[3] + back[3] * (1 - front[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha);
}
export function luminance(rgb) {
  const linear = rgb.slice(0, 3).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function checkContrast(sample, minimum = 4.5) {
  if (sample.opacities.some(v => !Number.isFinite(Number(v)) || Math.abs(Number(v) - 1) > 0.00001)) throw new Error('Element opacity needs separate compositing: ' + sample.id);
  const cases = ['#000000', '#ffffff'].map(backdrop => {
    let background = parseColor(backdrop);
    for (const layer of [...sample.backgrounds].reverse()) background = composite(parseColor(layer), background);
    const foreground = composite(parseColor(sample.color), background);
    return { backdrop, ratio: contrastRatio(foreground, background) };
  });
  return { id: sample.id, color: sample.color, minimum, cases, passed: cases.every(c => c.ratio >= minimum) };
}
