/** Bounded M0 fixture reader. Only RIFF PCM16 mono 16 kHz, not a general audio codec. */
export function decodePcm16Wave(bytes: Uint8Array): {
  sampleRate: 16000;
  samples: Float32Array<ArrayBuffer>;
} {
  if (bytes.byteLength < 44 || bytes.byteLength > 32 * 1024 * 1024) {
    throw new Error('WAV size outside M0 bounds');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Unsupported WAV container');
  const end = view.getUint32(4, true) + 8;
  if (end !== bytes.byteLength) throw new Error('WAV RIFF length mismatch');
  let formatSeen = false;
  let dataStart: number | undefined;
  let dataLength = 0;
  let offset = 12;
  let chunks = 0;
  while (offset < end) {
    if (++chunks > 128 || offset + 8 > end) throw new Error('Invalid WAV chunk table');
    const name = tag(offset);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const chunkEnd = start + length;
    if (chunkEnd > end) throw new Error('Truncated WAV chunk');
    if (name === 'fmt ') {
      if (formatSeen || length < 16) throw new Error('Invalid WAV format chunk');
      formatSeen = true;
      if (
        view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 2, true) !== 1 ||
        view.getUint32(start + 4, true) !== 16000 ||
        view.getUint32(start + 8, true) !== 32000 ||
        view.getUint16(start + 12, true) !== 2 ||
        view.getUint16(start + 14, true) !== 16
      ) {
        throw new Error('M0 requires PCM16 mono 16kHz WAV');
      }
    } else if (name === 'data') {
      if (dataStart !== undefined) throw new Error('Duplicate WAV data chunk');
      dataStart = start;
      dataLength = length;
    }
    offset = chunkEnd + (length % 2);
    if (offset > end) throw new Error('Truncated WAV padding');
  }
  if (!formatSeen || dataStart === undefined || dataLength === 0 || dataLength % 2 !== 0) {
    throw new Error('WAV needs a format and complete PCM16 samples');
  }
  // V8-owned memory: never request an external native ArrayBuffer from sherpa.readWave.
  const samples = new Float32Array(dataLength / 2);
  for (let i = 0; i < samples.length; i += 1)
    samples[i] = view.getInt16(dataStart + i * 2, true) / 32768;
  return { sampleRate: 16000, samples };
}
