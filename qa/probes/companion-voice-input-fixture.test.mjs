// Pure synthetic-fixture checks only: no service, browser, microphone or model.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { VOICE_CHUNK_SAMPLES, VOICE_MAX_SAMPLES, VOICE_SAMPLE_RATE } from '../../packages/contracts/src/audio-capture.ts';
import { FRAME_SAMPLES, FULL_FRAMES, SAMPLE_COUNT, SAMPLE_RATE, TAIL_SAMPLES,
  syntheticFrames, syntheticPcm, syntheticWav } from '../fixtures/companion-voice-input/synthetic-audio.mjs';

const file = new URL('../fixtures/companion-voice-input/synthetic-tone-16k.wav', import.meta.url);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('generated non-speech WAV is reproducible 16 kHz mono PCM16', async () => {
  const wav = await readFile(file);
  assert.deepEqual(wav, syntheticWav());
  assert.equal(digest(wav), 'b3b0e82ca963856487afca7a4667aff68eb2d9f2964af746ef28947130b65f6c');
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.subarray(8, 16).toString('ascii'), 'WAVEfmt ');
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), VOICE_SAMPLE_RATE);
  assert.equal(wav.readUInt32LE(28), VOICE_SAMPLE_RATE * 2);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.subarray(36, 40).toString('ascii'), 'data');
  assert.equal(wav.readUInt32LE(40), SAMPLE_COUNT * 2);
  assert.equal(wav.length, 44 + SAMPLE_COUNT * 2);
  assert.equal(SAMPLE_RATE, VOICE_SAMPLE_RATE);
  assert.ok(SAMPLE_COUNT < VOICE_MAX_SAMPLES);
});

test('owned f32le frames preserve every sample and a partial 137-sample tail', async () => {
  const wav = await readFile(file);
  const pcm = syntheticPcm();
  const frames = syntheticFrames();
  assert.equal(FRAME_SAMPLES, VOICE_CHUNK_SAMPLES);
  assert.equal(frames.length, FULL_FRAMES + 1);
  assert.ok(frames.slice(0, FULL_FRAMES).every((frame) => frame.byteLength === FRAME_SAMPLES * 4));
  assert.equal(frames.at(-1).byteLength, TAIL_SAMPLES * 4);
  assert.equal(new Set(frames.map((frame) => frame.buffer)).size, frames.length);
  assert.deepEqual(Buffer.concat(frames), pcm);
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const value = pcm.readFloatLE(index * 4);
    assert.ok(Number.isFinite(value) && Math.abs(value) <= 1);
    assert.equal(value, wav.readInt16LE(44 + index * 2) / 32768);
  }
  assert.equal(wav.readInt16LE(44 + FULL_FRAMES * FRAME_SAMPLES * 2), -2108);
  assert.equal(wav.readInt16LE(wav.length - 2), 2108);
});
