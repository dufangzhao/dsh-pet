// Synthetic raw PCM only. This is a fixture codec declaration, not a device or model measurement.
export const SYNTHETIC_PCM_FORMAT = Object.freeze({ encoding: 'pcm-s16le', sampleRate: 24000, channels: 1 });

export function syntheticPcm16(frames, frameOffset = 0) {
  if (!Number.isSafeInteger(frames) || frames < 0 || !Number.isSafeInteger(frameOffset) || frameOffset < 0)
    throw new TypeError('Invalid synthetic frame range');
  const bytes = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index++)
    bytes.writeInt16LE(((frameOffset + index) * 997 % 65536) - 32768, index * 2);
  return bytes;
}

// Generate bounded chunks; long fixtures do not allocate a whole utterance.
export function* syntheticPcmChunks(frames, chunkBytes = 4800) {
  if (!Number.isSafeInteger(frames) || frames < 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 512 * 1024)
    throw new TypeError('Invalid synthetic stream bounds');
  let offset = 0;
  while (offset < frames * 2) {
    const count = Math.min(chunkBytes, frames * 2 - offset);
    const first = Math.floor(offset / 2);
    const bytes = syntheticPcm16(Math.ceil((offset % 2 + count) / 2), first);
    yield bytes.subarray(offset % 2, offset % 2 + count);
    offset += count;
  }
}
