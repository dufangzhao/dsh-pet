// Future controlled Q2 round trip through the actual service and Phase 0 client exports.
// No execution before backend/source freeze, parent build and explicit integration authorization.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
import { SAMPLE_COUNT, syntheticPcm, syntheticWav } from '../fixtures/companion-voice-input/synthetic-audio.mjs';
import { startControlledMagpie } from '../fixtures/companion-voice-input/controlled-magpie.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--run-frozen') {
  console.error('Parent source freeze, build and explicit integration authorization are required');
  process.exit(2);
}
register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { CompanionClient } = await import('../../plugins/text-client/src/client/client.ts');
const { VOICE_ASR_PROVIDER } = await import('../../packages/contracts/src/companion-voice.ts');
const report = { scope: 'controlled-q2-service-client', status: 'running', checks: [],
  limit: 'Synthetic PCM and controlled loopback peer; no microphone, real Magpie or recognition-quality claim.' };
let service, peer, client, token;
let stage = 'preflight', exit = 1;
function value(result) {
  assert.equal(result.ok, true, `actual operation failed: ${result.error?.code ?? 'unknown'}`);
  return result.value;
}
try {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'companion-voice-q2-'));
  token = randomUUID() + randomUUID();
  peer = await startControlledMagpie({ expectedWav: syntheticWav(),
    expectedAuthorization: 'Bearer magpie-dsh-pet' });
  service = await createCompanionService({ dataDirectory, token, mode: 'scripted' });
  client = new CompanionClient({ baseUrl: service.url });
  await client.connect(token);
  const target = client.getVoiceTarget();
  assert.ok(target, 'actual client must be live');
  stage = 'empty-model-catalog';
  const initial = value(await client.readVoice(target));
  const provider = initial.providers.find((item) => item.providerRef === VOICE_ASR_PROVIDER);
  assert.ok(provider, 'actual registered provider must be visible');
  const configured = value(await client.saveAsrProvider({ providerRef: provider.providerRef,
    expectedRevision: provider.configRevision, settings: { baseUrl: peer.baseUrl, modelRef: '',
      authMode: 'local-client-id', protocol: 'mimo-native' } }, target));
  const empty = configured.providers.find((item) => item.providerRef === provider.providerRef);
  assert.ok(empty?.bindingId); assert.equal(empty.settings.modelRef, '');
  const catalog = value(await client.readAsrCatalog({ providerRef: provider.providerRef,
    bindingId: empty.bindingId }, target));
  const candidate = catalog.candidates.find((item) => item.modelRef === 'xiaomi/mimo-v2.5-asr');
  assert.ok(candidate?.selectable && candidate.protocol === 'mimo-native');
  assert.ok(!catalog.candidates.some((item) => item.modelRef.includes('tts')));
  assert.equal(peer.snapshot.catalogCount, 1); assert.equal(peer.snapshot.audioCount, 0);
  assert.equal(peer.snapshot.requests[0].userAgent, 'dsh-pet-voice/1');
  report.checks.push('actual-empty-model-catalog-with-independent-identity-and-no-inference');
  stage = 'one-binary-upload-and-status-recovery';
  const selected = value(await client.saveAsrProvider({ providerRef: provider.providerRef,
    expectedRevision: empty.configRevision, settings: { ...empty.settings, modelRef: candidate.modelRef } }, target));
  const chosen = selected.providers.find((item) => item.providerRef === provider.providerRef);
  assert.ok(chosen?.bindingId); assert.equal(chosen.settings.modelRef, candidate.modelRef);
  const before = client.getState().snapshot;
  assert.ok(before);
  const ticket = value(await client.beginVoiceCapture({ captureId: randomUUID(), clientId: target.clientId,
    agentId: target.agentId, expectedFeatureRevision: selected.feature.configRevision,
    providerRef: chosen.providerRef, bindingId: chosen.bindingId, finishMode: selected.feature.finishMode }));
  assert.equal(peer.snapshot.audioCount, 0);
  const result = value(await client.uploadVoiceCapture(ticket, SAMPLE_COUNT, syntheticPcm()));
  assert.equal(result.phase, 'final'); assert.equal(result.cleanup, 'settled');
  assert.equal(result.outcome?.kind, 'final'); assert.equal(result.samples, SAMPLE_COUNT);
  const observed = await peer.firstAudio;
  assert.equal(observed.samples, SAMPLE_COUNT);
  const key = { captureId: ticket.captureId, clientId: ticket.clientId, agentId: ticket.agentId,
    serviceEpoch: ticket.serviceEpoch };
  const recovered = value(await client.readVoiceCapture(key));
  assert.deepEqual(recovered, result);
  assert.equal(peer.snapshot.audioCount, 1, 'status recovery must not post audio again');
  await client.refresh();
  assert.equal(client.getState().snapshot.agent.id, before.agent.id);
  assert.deepEqual(client.getState().snapshot.messages, before.messages, 'server ASR does not dispatch a message');
  report.checks.push('actual-binary-upload-controlled-mimo-and-one-call-status-recovery');
  stage = 'one-explicit-message';
  const command = { commandId: randomUUID(), text: result.outcome.text };
  assert.equal(await client.submitIntent(command, target), 'accepted');
  await client.refresh();
  const after = client.getState().snapshot;
  assert.equal(after.agent.id, before.agent.id);
  assert.equal(after.messages.filter((message) => message.role === 'user' &&
    message.inputId === command.commandId && message.text === command.text).length, 1);
  assert.equal(peer.snapshot.audioCount, 1);
  report.checks.push('single-explicit-same-agent-message-from-final-transcript');
  report.status = 'controlled-q2-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'controlled-q2-failed'; report.failure = `${stage}: ${detail.slice(0, 700)}`;
} finally {
  try { client?.dispose(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await service?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await peer?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
