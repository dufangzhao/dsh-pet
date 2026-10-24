import { describe, expect, it } from 'vitest';
import { decodePcm16Wave } from './wave-pcm.js';

function fixture() {
  const data = Buffer.alloc(50);
  data.write('RIFF', 0);
  data.writeUInt32LE(42, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(6, 40);
  data.writeInt16LE(-32768, 44);
  data.writeInt16LE(0, 46);
  data.writeInt16LE(32767, 48);
  return data;
}
describe('M0 owned-buffer WAV reader', () => {
  it('returns normalized samples in an independently owned buffer', () => {
    const data = fixture();
    const wave = decodePcm16Wave(data);
    expect(wave.sampleRate).toBe(16000);
    expect([...wave.samples]).toEqual([-1, 0, 32767 / 32768]);
    data.fill(0);
    expect(wave.samples[0]).toBe(-1);
  });
  it.each([0, 8, 20, 22, 24, 28, 32, 34])('rejects invalid field at %i', (offset) => {
    const data = fixture();
    data[offset] = 0xff;
    expect(() => decodePcm16Wave(data)).toThrow();
  });
  it('rejects RIFF length mismatch and truncated input', () => {
    expect(() => decodePcm16Wave(fixture().subarray(0, 49))).toThrow(/length/);
    expect(() => decodePcm16Wave(new Uint8Array(10))).toThrow(/size/);
  });
  it('rejects chunk overflow and incomplete samples', () => {
    const data = fixture();
    data.writeUInt32LE(1000, 40);
    expect(() => decodePcm16Wave(data)).toThrow(/chunk/);
    data.writeUInt32LE(5, 40);
    expect(() => decodePcm16Wave(data)).toThrow(/samples/);
  });
  it('skips bounded unknown chunks and their word padding', () => {
    const original = fixture();
    const junk = Buffer.alloc(10);
    junk.write('JUNK');
    junk.writeUInt32LE(1, 4);
    const data = Buffer.concat([original.subarray(0, 36), junk, original.subarray(36)]);
    data.writeUInt32LE(data.length - 8, 4);
    expect([...decodePcm16Wave(data).samples]).toEqual([-1, 0, 32767 / 32768]);
  });
});
