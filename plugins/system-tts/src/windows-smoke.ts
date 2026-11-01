import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SPEECH_OUTPUT_SAMPLE_RATE } from '@pet/contracts';
import { SystemSpeechEngine } from './engine.js';

const engine = new SystemSpeechEngine();
try {
  const result = await engine.synthesize(
    {
      utteranceId: 'windows-smoke',
      text: '你好，我是小蓝。This is the offline Windows speech test.',
      language: 'zh-CN',
      voice: null,
      rate: 0,
    },
    AbortSignal.timeout(30000),
  );
  if (!result.ok) throw new Error(result.reason ?? result.errorCode);
  const wave = Buffer.alloc(44 + result.pcm.byteLength);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.byteLength - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(SPEECH_OUTPUT_SAMPLE_RATE, 24);
  wave.writeUInt32LE(SPEECH_OUTPUT_SAMPLE_RATE * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(result.pcm.byteLength, 40);
  wave.set(result.pcm, 44);
  let peak = 0;
  for (let i = 44; i < wave.byteLength; i += 2)
    peak = Math.max(peak, Math.abs(wave.readInt16LE(i)));
  if (peak < 10) throw new Error('silent-speech');
  const destination = path.resolve('.cache/speech-output-smoke/windows-system-speech.wav');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, wave);
  console.log(
    JSON.stringify({
      ok: true,
      path: destination,
      bytes: result.pcm.byteLength,
      sampleRate: SPEECH_OUTPUT_SAMPLE_RATE,
      channels: 1,
      seconds: result.pcm.byteLength / (SPEECH_OUTPUT_SAMPLE_RATE * 2),
      peak,
    }),
  );
} finally {
  engine.close();
}
