// Q3: actual Core and Docker work remain independent of controlled ASR.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';
import { startControlledMagpie } from '../fixtures/companion-voice-input/controlled-magpie.mjs';
import { SAMPLE_COUNT, syntheticPcm, syntheticWav } from '../fixtures/companion-voice-input/synthetic-audio.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--run-frozen') throw new Error('Requires --run-frozen');
register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { CompanionClient } = await import('../../plugins/text-client/src/client/client.ts');
const { controlledClient, assistantMessage } = await import('../fixtures/companion-service/controlled-client.mjs');
const { effectRecord, jobsRoot, records, cleanupContainers } = await import('../fixtures/companion-service/helpers.mjs');
const report = { scope: 'voice-core-docker-continuity', status: 'running', checks: [], limit: 'Actual service/Core/Docker; synthetic audio and controlled model peers, no device or live model.' };
let root, service, client, model, audio, heldAudio, token;
let stage = 'setup', exit = 1;
const value = (result) => { assert.equal(result.ok, true, result.error?.code); return result.value; };
try {
  const image = process.env.PET_CLOUD_EXEC_IMAGE;
  assert.ok(image, 'Use an existing image; this probe never pulls');
  root = await mkdtemp(path.join(os.tmpdir(), 'companion-voice-worker-'));
  token = randomUUID() + randomUUID();
  model = controlledClient();
  audio = await startControlledMagpie({ expectedWav: syntheticWav() });
  heldAudio = await startControlledMagpie({ expectedWav: syntheticWav(), hold: true });
  service = await createCompanionService({ dataDirectory: root, token, image, mode: 'model', model: 'controlled-offline', client: model.client });
  client = new CompanionClient({ baseUrl: service.url });
  await client.connect(token);
  const target = client.getVoiceTarget(); assert.ok(target);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (route, body) => {
    const response = await fetch(service.url + route, { headers, signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    return value(await response.json());
  };
  const waitUntil = async (check, label) => {
    const deadline = Date.now() + 10000;
    while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise((resolve) => setTimeout(resolve, 30)); }
  };
  const configure = async (peer) => {
    const view = value(await client.readVoice(target));
    const provider = view.providers[0]; assert.ok(provider);
    return value(await client.saveAsrProvider({ providerRef: provider.providerRef, expectedRevision: provider.configRevision, settings: { baseUrl: peer.baseUrl, modelRef: 'xiaomi/mimo-v2.5-asr', authMode: 'local-client-id', protocol: 'mimo-native' } }, target));
  };
  const begin = async (view) => {
    const selected = view.providers.find((p) => p.providerRef === view.feature.providerRef);
    assert.ok(selected?.bindingId);
    return value(await client.beginVoiceCapture({ captureId: randomUUID(), clientId: target.clientId, agentId: target.agentId, expectedFeatureRevision: view.feature.configRevision, providerRef: selected.providerRef, bindingId: selected.bindingId, finishMode: view.feature.finishMode }));
  };
  const voiceView = await configure(audio);
  const beforeModel = await request('/api/model');
  stage = 'start-worker-and-thinking';
  const work = await request('/api/tasks', { commandId: randomUUID(), title: 'Voice independent work', code: "import {appendFileSync,existsSync,writeFileSync} from 'node:fs'; appendFileSync('effect.txt','once\\n'); const until=Date.now()+25000; while(!existsSync('release')&&Date.now()<until) await new Promise(r=>setTimeout(r,40)); if(!existsSync('release')) throw new Error('watchdog'); writeFileSync('result.txt','voice work completed\\n');", outputs: [{ path: 'result.txt', mediaType: 'text/plain' }], timeoutMs: 28000 });
  const record = await effectRecord(root);
  const workDir = path.join(jobsRoot(root), record.jobId, 'work');
  assert.equal(record.mounts[0].Source, workDir);
  const unchangedWork = async () => {
    const current = await request(`/api/tasks/${work.taskId}`);
    assert.equal(current.status, 'running'); assert.equal(current.executionId, record.executionId);
    const all = await records(root); assert.equal(all.length, 1); assert.equal(all[0].containerId, record.containerId);
    assert.equal(await readFile(path.join(workDir, 'effect.txt'), 'utf8'), 'once\n');
  };
  await client.submit('Keep this controlled turn pending.');
  const thinking = await model.next(1);
  stage = 'asr-during-thinking';
  const ticket = await begin(voiceView);
  const transcript = value(await client.uploadVoiceCapture(ticket, SAMPLE_COUNT, syntheticPcm()));
  assert.equal(transcript.phase, 'final'); assert.equal(audio.snapshot.audioCount, 1);
  assert.equal(thinking.options.signal.aborted, false);
  await unchangedWork();
  report.checks.push('record-admission-and-asr-do-not-interrupt-active-Core-or-worker');

  stage = 'cancel-asr-not-core-or-worker';
  const heldView = await configure(heldAudio);
  const heldTicket = await begin(heldView);
  const uploading = client.uploadVoiceCapture(heldTicket, SAMPLE_COUNT, syntheticPcm());
  await heldAudio.firstAudio;
  const cancelled = value(await client.cancelVoiceCapture({ captureId: heldTicket.captureId, clientId: heldTicket.clientId, agentId: heldTicket.agentId, serviceEpoch: heldTicket.serviceEpoch }));
  assert.equal(cancelled.phase, 'cancelled'); assert.equal(cancelled.cleanup, 'settled');
  await uploading;
  await waitUntil(async () => heldAudio.snapshot.abortedResponses === 1, 'native request did not close');
  assert.equal(thinking.options.signal.aborted, false);
  await unchangedWork();
  const afterModel = await request('/api/model');
  assert.deepEqual(afterModel.desired, beforeModel.desired); assert.deepEqual(afterModel.applied, beforeModel.applied);
  assert.deepEqual(afterModel.connectors.map(({ id, configRevision, credential }) => ({ id, configRevision, version: credential.version })), beforeModel.connectors.map(({ id, configRevision, credential }) => ({ id, configRevision, version: credential.version })));
  report.checks.push('ASR-cancel-closes-native-request-without-stopping-Core-work-or-text-auth');

  stage = 'same-agent-ordinary-message';
  thinking.complete([assistantMessage('Controlled turn complete.')]);
  await waitUntil(async () => (await request('/api/snapshot')).agent.status === 'ready', 'Core did not become ready');
  const command = { commandId: randomUUID(), text: transcript.outcome.text };
  assert.equal(await client.submitIntent(command, target), 'accepted');
  const next = await model.next(2); next.complete([assistantMessage('Voice message received.')]);
  await waitUntil(async () => (await request('/api/snapshot')).agent.status === 'ready', 'Voice turn did not complete');
  await unchangedWork();
  const snapshot = await request('/api/snapshot');
  assert.equal(snapshot.agent.id, target.agentId);
  assert.equal(snapshot.messages.filter((m) => m.role === 'user' && m.text === command.text).length, 1);
  report.checks.push('final-transcript-enters-same-Agent-once-through-normal-message-path');

  stage = 'worker-completion';
  await writeFile(path.join(workDir, 'release'), 'release\n', { flag: 'wx', mode: 0o600 });
  await waitUntil(async () => (await request(`/api/tasks/${work.taskId}`)).status === 'completed', 'worker did not complete');
  const finished = await request(`/api/tasks/${work.taskId}`);
  assert.equal(finished.executionId, record.executionId); assert.equal(finished.artifacts.length, 1);
  const response = await fetch(`${service.url}/api/artifacts/${finished.artifacts[0].id}`, { headers });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('utf8'), 'voice work completed\n');
  assert.equal(await readFile(path.join(workDir, 'effect.txt'), 'utf8'), 'once\n');
  assert.equal((await records(root)).length, 1);
  report.artifactSha256 = createHash('sha256').update(bytes).digest('hex');
  report.checks.push('same-task-execution-completes-with-one-effect-and-verified-artifact');
  report.status = 'passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  if (token) detail = detail.split(token).join('[redacted]');
  report.status = 'failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { client?.dispose(); model?.close(); await service?.close(); await audio?.close(); await heldAudio?.close(); }
  catch { report.status = 'cleanup-failed'; exit = 1; }
  if (root && await access(jobsRoot(root)).then(() => true, () => false)) {
    try { await cleanupContainers(root); } catch { report.status = 'cleanup-failed'; exit = 1; }
  }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
