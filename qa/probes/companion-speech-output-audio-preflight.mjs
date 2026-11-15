// Explicitly authorized null-only software server check. No product/browser/audio stream.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNullAudio } from '../fixtures/companion-speech-output/software-audio.mjs';
assert.deepEqual(process.argv.slice(2), ['--null-service-only']);
const root = fileURLToPath(new URL('../..', import.meta.url));
const tool = process.env.PET_SPEECH_PULSE_TOOLS;
assert.ok(tool, 'Parent-prepared private Pulse tool directory required');
const report = { id: randomUUID().slice(0, 8), scope: 'private-null-only-Pulse-service-preflight-no-audio-stream', status: 'running' };
let audio, exit = 1;
try {
  audio = await startNullAudio(tool); report.proof = audio.proof;
  assert.equal(audio.proof.sinkInputs, 0);
  report.finalProof = await audio.verify(); assert.equal(report.finalProof.sinkInputs, 0);
  report.status = 'passed'; exit = 0;
} catch (error) { report.status = 'failed'; report.failure = error.message.slice(0, 2000); }
finally {
  if (audio) { try { report.cleanup = await audio.close(); } catch (error) { report.cleanupFailure = error.message; exit = 1; } }
  report.actualExit = exit;
  const directory = path.join(root, 'qa/fixtures/companion-speech-output/evidence'); await mkdir(directory, { recursive: true });
  const name = path.join(directory, `${report.id}-null-preflight.json`); await writeFile(name, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: path.relative(root, name) }, null, 2)); process.exitCode = exit;
}
