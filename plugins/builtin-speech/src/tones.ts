import { SPEECH_OUTPUT_SAMPLE_RATE } from '@pet/contracts';

/** Short expressive tones, explicitly distinct from a spoken voice provider. */
export function synthesizePetTones(text: string, signal: AbortSignal): Uint8Array {
  const glyphs = [...text].filter((c) => !/\s/u.test(c)).slice(0, 24);
  const framesPerTone = Math.round(SPEECH_OUTPUT_SAMPLE_RATE * 0.07);
  const bytes = new Uint8Array(Math.max(1, glyphs.length) * framesPerTone * 2);
  const view = new DataView(bytes.buffer);
  for (let n = 0; n < glyphs.length; n++) {
    signal.throwIfAborted();
    const glyph = glyphs[n];
    if (glyph === undefined) continue;
    const frequency = 310 + ((glyph.codePointAt(0) ?? 0) % 13) * 31;
    for (let i = 0; i < framesPerTone; i++) {
      const t = i / SPEECH_OUTPUT_SAMPLE_RATE;
      const envelope = Math.sin((Math.PI * i) / framesPerTone) ** 2;
      const sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.22;
      view.setInt16((n * framesPerTone + i) * 2, Math.round(sample * 32767), true);
    }
  }
  return bytes;
}
