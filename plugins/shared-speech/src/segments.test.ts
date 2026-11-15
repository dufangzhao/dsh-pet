import { expect, it } from 'vitest';
import { speechSegments } from './segments.js';
it('preserves exact canonical UTF16 text and uses a few authoritative contiguous slices', () => {
  for (const text of [
    ' short 🌳\r\n reply ',
    '甲'.repeat(8000),
    '🌳'.repeat(4000),
    '甲'.repeat(3999) + '\r\n' + '乙'.repeat(3999),
    '甲'.repeat(2000) + '。' + '乙'.repeat(2000) + '\n' + '尾'.repeat(2000),
    ' '.repeat(4001) + '\r\n' + '尾',
    '👩‍💻e\u0301'.repeat(800),
  ]) {
    const parts = speechSegments(text);
    expect(parts.length).toBeLessThanOrEqual(4);
    expect(parts.map((p) => text.slice(p.start, p.end)).join('')).toBe(text);
    expect(parts[0]?.start).toBe(0);
    expect(parts.at(-1)?.end).toBe(text.length);
    for (let at = 0; at < parts.length; at++) {
      const part = parts[at];
      if (!part) throw new Error('part');
      expect([...text.slice(part.start, part.end)].length).toBeLessThanOrEqual(4000);
      if (at) expect(part.start).toBe(parts[at - 1]?.end);
      if (part.end < text.length) {
        expect(text.slice(part.end - 1, part.end + 1)).not.toBe('\r\n');
        const left = text.charCodeAt(part.end - 1),
          right = text.charCodeAt(part.end);
        expect(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff).toBe(false);
      }
    }
    if ([...text].length <= 4000) expect(parts).toHaveLength(1);
  }
});
it('does not turn illegal canonical text into a trimmed or summarized reply', () => {
  expect(() => speechSegments('')).toThrow();
  expect(() => speechSegments('字'.repeat(8001))).toThrow();
  expect(speechSegments(' \r\n ')).toEqual([{ start: 0, end: 4 }]);
});
