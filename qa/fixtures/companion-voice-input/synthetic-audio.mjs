// Non-speech test signal: reproducible PCM, not a recognition-quality fixture.
export const SAMPLE_RATE = 16000;
export const SAMPLE_COUNT = 16137;
export const FRAME_SAMPLES = 1600;
export const FULL_FRAMES = 10;
export const TAIL_SAMPLES = 137;

function sample(index) {
  if (index >= FULL_FRAMES * FRAME_SAMPLES) return (index - FULL_FRAMES * FRAME_SAMPLES) * 31 - 2108;
  const phase = index % 80;
  return (phase < 40 ? phase - 20 : 60 - phase) * 600;
}

/** 16 kHz, mono, 16-bit PCM WAV for a future browser fake audio device. */
export function syntheticWav() {
  const bytes = Buffer.alloc(44 + SAMPLE_COUNT * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24); bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(SAMPLE_COUNT * 2, 40);
  for (let index = 0; index < SAMPLE_COUNT; index++) bytes.writeInt16LE(sample(index), 44 + index * 2);
  return bytes;
}

/** Equivalent f32le input, including one distinguishable partial final frame. */
export function syntheticPcm() {
  const bytes = Buffer.alloc(SAMPLE_COUNT * 4);
  for (let index = 0; index < SAMPLE_COUNT; index++) bytes.writeFloatLE(sample(index) / 32768, index * 4);
  return bytes;
}

export function syntheticFrames() {
  const bytes = syntheticPcm();
  const frames = [];
  for (let offset = 0; offset < bytes.length; offset += FRAME_SAMPLES * 4)
    frames.push(Uint8Array.from(bytes.subarray(offset, offset + FRAME_SAMPLES * 4)));
  return frames;
}
