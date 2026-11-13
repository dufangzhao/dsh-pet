import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import {
  COMPANION_MATERIAL_INPUT_MAX_BYTES,
  COMPANION_VOICE_ATTACHMENT_MAX_MS,
  COMPANION_VOICE_ATTACHMENT_MAX_SPANS,
  VOICE_SAMPLE_RATE,
  VOICE_MAX_SAMPLES,
  SPEECH_FORMAT,
} from '@pet/contracts';

const INPUT = '/input/input.bin';
const OUTPUT = '/output/audio.bin';
const META = '/output/result.json';
const SILK_HEADER = Buffer.from('\x02#!SILK_V3');
const maxDecodedFrames = (VOICE_SAMPLE_RATE * COMPANION_VOICE_ATTACHMENT_MAX_MS) / 1000;
const maxEncodedFrames = (SPEECH_FORMAT.sampleRate * COMPANION_VOICE_ATTACHMENT_MAX_MS) / 1000;
const formats = ['wav', 'mp3', 'ogg', 'mov', 'aac', 'flac'];
const formatWhitelist = formats.join(',');
const probeArgs = [
  '-v',
  'error',
  '-protocol_whitelist',
  'file,pipe',
  '-format_whitelist',
  formatWhitelist,
  '-show_entries',
  'stream=index,codec_type,codec_name,sample_rate,channels:format=format_name',
  '-of',
  'json',
  INPUT,
];
class CodecFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
async function processBytes(executable, args, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      env: { HOME: '/tmp', LANG: 'C', PATH: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let bytes = 0,
      stderrBytes = 0,
      failure;
    child.stdout.on('data', (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        failure ??= new CodecFailure('budget');
        child.kill('SIGKILL');
      } else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 16 * 1024) {
        failure ??= new CodecFailure('bad-format');
        child.kill('SIGKILL');
      }
    });
    child.once('error', () => {
      failure ??= new CodecFailure('codec-unavailable');
    });
    child.once('close', (code) => {
      if (failure) reject(failure);
      else if (code !== 0) reject(new CodecFailure('bad-format'));
      else resolve(Buffer.concat(chunks));
    });
  });
}
function silkPackets(bytes) {
  if (
    bytes.length < SILK_HEADER.length + 3 ||
    !bytes.subarray(0, SILK_HEADER.length).equals(SILK_HEADER)
  )
    throw new CodecFailure('bad-format');
  let offset = SILK_HEADER.length,
    packets = 0;
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) throw new CodecFailure('bad-format');
    const size = bytes.readInt16LE(offset);
    offset += 2;
    if (size <= 0 || offset + size > bytes.length) throw new CodecFailure('bad-format');
    offset += size;
    packets++;
  }
  return packets;
}
function asBuffer(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
async function silkModule() {
  return import('/codec/silk/index.mjs');
}
async function decode(bytes) {
  let pcm, detected;
  if (bytes.subarray(0, SILK_HEADER.length).equals(SILK_HEADER)) {
    silkPackets(bytes);
    const silk = await silkModule();
    const result = await silk.decode(bytes, VOICE_SAMPLE_RATE);
    pcm = asBuffer(result.data);
    detected = 'tencent-silk-v3';
  } else {
    const probe = JSON.parse(
      (await processBytes('/codec/bin/ffprobe', probeArgs, 32 * 1024)).toString('utf8'),
    );
    if (
      !Array.isArray(probe.streams) ||
      probe.streams.length !== 1 ||
      probe.streams[0]?.codec_type !== 'audio' ||
      typeof probe.format?.format_name !== 'string' ||
      !formats.includes(probe.format.format_name.split(',')[0])
    )
      throw new CodecFailure('bad-format');
    detected = probe.format.format_name;
    pcm = await processBytes(
      '/codec/bin/ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-err_detect',
        'explode',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        formatWhitelist,
        '-i',
        INPUT,
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-ac',
        '1',
        '-ar',
        String(VOICE_SAMPLE_RATE),
        '-c:a',
        'pcm_s16le',
        '-f',
        's16le',
        'pipe:1',
      ],
      maxDecodedFrames * 2,
    );
  }
  if (!pcm.length || pcm.length % 2) throw new CodecFailure('bad-format');
  const frames = pcm.length / 2;
  if (frames > maxDecodedFrames) throw new CodecFailure('budget');
  const output = Buffer.allocUnsafe(frames * 4);
  for (let frame = 0; frame < frames; frame++)
    output.writeFloatLE(pcm.readInt16LE(frame * 2) / 32768, frame * 4);
  const spans = [];
  for (let offset = 0; offset < frames; offset += VOICE_MAX_SAMPLES)
    spans.push({ startFrame: offset, frames: Math.min(VOICE_MAX_SAMPLES, frames - offset) });
  if (spans.length > COMPANION_VOICE_ATTACHMENT_MAX_SPANS) throw new CodecFailure('budget');
  return {
    output,
    metadata: {
      encoding: 'pcm-f32le',
      sampleRate: VOICE_SAMPLE_RATE,
      channels: 1,
      frames,
      durationMs: Math.ceil((frames * 1000) / VOICE_SAMPLE_RATE),
      detected,
      spans,
    },
  };
}
async function encode(bytes) {
  if (!bytes.length || bytes.length % 2) throw new CodecFailure('bad-format');
  const sourceFrames = bytes.length / 2;
  if (sourceFrames > maxEncodedFrames) throw new CodecFailure('budget');
  const silk = await silkModule();
  const result = await silk.encode(bytes, SPEECH_FORMAT.sampleRate);
  const output = asBuffer(result.data);
  const packets = silkPackets(output);
  const paddedFrames =
    Math.ceil(sourceFrames / (SPEECH_FORMAT.sampleRate / 50)) * (SPEECH_FORMAT.sampleRate / 50);
  if (packets !== paddedFrames / (SPEECH_FORMAT.sampleRate / 50))
    throw new CodecFailure('codec-failed');
  // Parseable framing is not encoding proof: decode the actual emitted SILK and check every frame.
  const checked = await silk.decode(output, SPEECH_FORMAT.sampleRate);
  const decodedFrames = checked.data.byteLength / 2;
  if (
    decodedFrames !== paddedFrames ||
    decodedFrames < sourceFrames ||
    decodedFrames > maxEncodedFrames
  )
    throw new CodecFailure('codec-failed');
  return {
    output,
    metadata: {
      encoding: 'tencent-silk-v3',
      sampleRate: SPEECH_FORMAT.sampleRate,
      channels: 1,
      frames: decodedFrames,
      sourceFrames,
      paddingFrames: decodedFrames - sourceFrames,
      durationMs: Math.ceil((decodedFrames * 1000) / SPEECH_FORMAT.sampleRate),
      packets,
      spans: [],
    },
  };
}
try {
  if (process.argv.length !== 3 || !['decode', 'encode'].includes(process.argv[2]))
    throw new CodecFailure('bad-format');
  const information = await stat(INPUT);
  if (
    !information.isFile() ||
    information.size < 1 ||
    information.size > COMPANION_MATERIAL_INPUT_MAX_BYTES
  )
    throw new CodecFailure('budget');
  const input = await readFile(INPUT);
  const { output, metadata } =
    process.argv[2] === 'decode' ? await decode(input) : await encode(input);
  if (output.length > 8 * 1024 * 1024) throw new CodecFailure('budget');
  await writeFile(OUTPUT, output, { flag: 'wx', mode: 0o600 });
  const result = {
    version: 1,
    ok: true,
    ...metadata,
    sizeBytes: output.length,
    sha256: createHash('sha256').update(output).digest('hex'),
  };
  await writeFile(META, JSON.stringify(result) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, frames: metadata.frames, sizeBytes: output.length }));
} catch (error) {
  const code =
    error instanceof CodecFailure
      ? error.code
      : ['EFBIG', 'ENOSPC'].includes(error?.code)
        ? 'budget'
        : 'codec-failed';
  await writeFile(META, JSON.stringify({ version: 1, ok: false, code }) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
}
