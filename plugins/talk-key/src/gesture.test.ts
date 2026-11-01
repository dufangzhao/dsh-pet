import { expect, it } from 'vitest';
import { TalkKeyGesture } from './gesture.js';
it('starts on first down, keeps a short press, and finishes on the next down', () => {
  const gesture = new TalkKeyGesture();
  expect(gesture.event('down', 0)).toBe('toggle');
  expect(gesture.event('down', 50)).toBeNull();
  expect(gesture.event('up', 249)).toBeNull();
  expect(gesture.event('down', 400)).toBe('toggle');
});
it('uses the fixed 250ms boundary and ignores release/repeat without an owned press', () => {
  const gesture = new TalkKeyGesture();
  expect(gesture.event('up', 0)).toBeNull();
  expect(gesture.event('down', 10)).toBe('toggle');
  expect(gesture.event('down', 200)).toBeNull();
  expect(gesture.event('up', 260)).toBe('finish');
  expect(gesture.event('up', 300)).toBeNull();
  gesture.event('down', 400);
  gesture.reset();
  expect(gesture.event('up', 800)).toBeNull();
});
