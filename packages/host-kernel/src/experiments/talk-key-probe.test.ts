import { describe, expect, it } from 'vitest';
import { replayPulses, TalkKeyGesture } from './talk-key-probe.js';
describe('one key, two gestures', () => {
  it('starts on down without waiting for hold threshold', () => {
    const g = new TalkKeyGesture();
    expect(g.key('down', 0)).toEqual(['start']);
    expect(g.state).toBe('pressed');
  });
  it.each([250, 251, 1000])('finishes a hold released at %ims', (duration) => {
    const g = new TalkKeyGesture();
    g.key('down', 0);
    expect(g.key('up', duration)).toEqual(['finish']);
    expect(g.state).toBe('idle');
  });
  it.each([1, 100, 249])('latches a tap released at %ims and stops on next down', (duration) => {
    const g = new TalkKeyGesture();
    g.key('down', 0);
    expect(g.key('up', duration)).toEqual([]);
    expect(g.state).toBe('continuous');
    expect(g.key('down', 500)).toEqual(['finish']);
    expect(g.key('down', 600)).toEqual([]);
    expect(g.key('up', 900)).toEqual([]);
    expect(g.state).toBe('idle');
  });
  it('does not restart or reset hold time on repeat', () => {
    const g = new TalkKeyGesture();
    g.key('down', 0);
    expect(g.key('down', 200)).toEqual([]);
    expect(g.key('up', 250)).toEqual(['finish']);
    expect(g.key('up', 300)).toEqual([]);
  });
  it('cancels a held key and drains its release', () => {
    const g = new TalkKeyGesture();
    g.key('down', 0);
    expect(g.cancel(10)).toEqual(['cancel']);
    expect(g.cancel(20)).toEqual([]);
    expect(g.key('down', 30)).toEqual([]);
    expect(g.key('up', 40)).toEqual([]);
    expect(g.key('down', 50)).toEqual(['start']);
  });
  it('cancels continuous mode without waiting for another release', () => {
    const g = new TalkKeyGesture();
    g.key('down', 0);
    g.key('up', 10);
    expect(g.cancel(20)).toEqual(['cancel']);
    expect(g.state).toBe('idle');
  });
  it('rejects invalid times without mutating the gesture state', () => {
    const g = new TalkKeyGesture();
    g.key('down', 100);
    expect(() => g.key('up', 99)).toThrow();
    expect(() => g.key('up', NaN)).toThrow();
    expect(g.state).toBe('pressed');
    expect(g.key('up', 350)).toEqual(['finish']);
    expect(() => new TalkKeyGesture(0)).toThrow();
  });
  it('demonstrates that a pulse shorter than a polling gap can be missed', () => {
    const ticks = Array.from({ length: 100 }, (_, i) => i * 30);
    expect(replayPulses(ticks, 10).missed).toBeGreaterThan(0);
    expect(replayPulses(ticks, 30).missed).toBe(0);
    expect(() => replayPulses([10, 1], 10)).toThrow();
  });
});
