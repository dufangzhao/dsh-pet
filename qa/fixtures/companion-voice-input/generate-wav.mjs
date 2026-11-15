import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SAMPLE_COUNT, SAMPLE_RATE, syntheticWav } from './synthetic-audio.mjs';

// Create only this fixture; refuse to overwrite an existing artifact.
const file = fileURLToPath(new URL('./synthetic-tone-16k.wav', import.meta.url));
const bytes = syntheticWav();
await writeFile(file, bytes, { flag: 'wx' });
console.log(JSON.stringify({ fixture: 'synthetic-tone-16k.wav', kind: 'non-speech',
  sampleRate: SAMPLE_RATE, samples: SAMPLE_COUNT, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') }));
