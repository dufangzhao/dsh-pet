// Q6: one explicitly authorized ASR request, fixed public 3s fixture, no message dispatch.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { register } from 'tsx/esm/api';

if (process.argv.length !== 3 || process.argv[2] !== '--run-authorized') {
  console.error('Requires explicit human authorization for this one 3s request and --run-authorized');
  process.exit(2);
}
const privateRoot = path.resolve('.companion-data/qa-private/companion-voice-input');
const fixture = path.join(privateRoot, 'public-speech-4v4u4zp5/zh-first-3s.wav');
const fixtureSha256 = '17e7fba4b006f086d644468a94c937d0d8cff182d16e479887fefa913b2a9467';
const baseUrl = 'http://127.0.0.1:3425/v1';
const modelRef = 'xiaomi/mimo-v2.5-asr';
const markerPath = path.join(privateRoot, 'live-mimo-3s-attempt.json');
const wav = await readFile(fixture);
assert.equal(createHash('sha256').update(wav).digest('hex'), fixtureSha256);
assert.equal(wav.length, 96044);
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.toString('ascii', 36, 40), 'data');
assert.equal(wav.readUInt16LE(22), 1);
assert.equal(wav.readUInt32LE(24), 16000);
assert.equal(wav.readUInt16LE(34), 16);
const pcm = Buffer.alloc(48000 * 4);
for (let index = 0; index < 48000; index++) pcm.writeFloatLE(wav.readInt16LE(44 + index * 2) / 32768, index * 4);
await mkdir(privateRoot, { recursive: true });
const runRoot = await mkdtemp(path.join(privateRoot, 'live-'));
const reportPath = path.join(runRoot, 'result.json');
const report = { scope: 'one-authorized-public-speech-asr', fixtureSha256, seconds: 3, baseUrl, modelRef, uploadAttempts: 0, status: 'preflight', limit: 'One project-to-Magpie audio POST; no retries, no Core message, no personal audio, no accuracy/latency aggregate claim.' };
register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { CompanionClient } = await import('../../plugins/text-client/src/client/client.ts');
let service, client, token;
const value = (result) => { assert.equal(result.ok, true, result.error?.code); return result.value; };
let exit = 1;
try {
  token = randomUUID() + randomUUID();
  service = await createCompanionService({ dataDirectory: path.join(runRoot, 'service'), token, mode: 'scripted' });
  client = new CompanionClient({ baseUrl: service.url });
  await client.connect(token);
  const target = client.getVoiceTarget(); assert.ok(target);
  const before = value(await client.readVoice(target));
  const provider = before.providers.find((item) => item.providerRef === 'pet.asr-magpie/magpie'); assert.ok(provider);
  const saved = value(await client.saveAsrProvider({ providerRef: provider.providerRef, expectedRevision: provider.configRevision, settings: { baseUrl, modelRef, authMode: 'local-client-id', protocol: 'mimo-native' } }, target));
  const selected = saved.providers.find((item) => item.providerRef === provider.providerRef); assert.ok(selected?.bindingId);
  const catalog = value(await client.readAsrCatalog({ providerRef: provider.providerRef, bindingId: selected.bindingId }, target));
  assert.ok(catalog.candidates.some((item) => item.modelRef === modelRef && item.selectable), 'selected model not advertised for this binding');
  const review = value(await client.saveVoiceSettings({ expectedRevision: saved.feature.configRevision, providerRef: provider.providerRef, finishMode: 'review' }, target));
  const ticket = value(await client.beginVoiceCapture({ captureId: randomUUID(), clientId: target.clientId, agentId: target.agentId, expectedFeatureRevision: review.feature.configRevision, providerRef: provider.providerRef, bindingId: selected.bindingId, finishMode: 'review' }));
  const key = { captureId: ticket.captureId, clientId: ticket.clientId, agentId: ticket.agentId, serviceEpoch: ticket.serviceEpoch };
  // Atomic evidence marker prevents an ambiguous/failed process from silently trying again.
  const marker = await open(markerPath, 'wx', 0o600);
  try { await marker.writeFile(JSON.stringify({ ...report, key, reportPath, admittedAt: Date.now() }) + '\n'); }
  finally { await marker.close(); }
  report.status = 'attempted'; report.uploadAttempts = 1;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const started = Date.now();
  const upload = await client.uploadVoiceCapture(ticket, 48000, pcm);
  report.elapsedMs = Date.now() - started;
  const result = upload.ok ? upload.value : value(await client.readVoiceCapture(key));
  report.phase = result.phase; report.cleanup = result.cleanup; report.error = result.error;
  report.transcript = result.outcome?.kind === 'final' ? result.outcome.text : null;
  await client.refresh();
  assert.equal(client.getState().phase, 'live');
  const snapshot = client.getState().snapshot; assert.ok(snapshot);
  assert.equal(snapshot.agent.id, target.agentId); assert.equal(snapshot.messages.length, 0);
  assert.equal(snapshot.tasks.length, 0);
  report.noMessageOrTask = true;
  assert.equal(result.phase, 'final'); assert.equal(result.cleanup, 'settled');
  assert.ok(report.transcript?.trim());
  report.status = 'passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  if (token) detail = detail.split(token).join('[redacted]');
  report.status = 'failed'; report.failure = detail.slice(0, 800);
} finally {
  try { client?.dispose(); await service?.close(); report.closed = true; }
  catch { report.status = 'cleanup-failed'; exit = 1; }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  process.exitCode = exit;
}
