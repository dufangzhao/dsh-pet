// Actual isolated Core/Docker/held-ASR continuity across controlled speech delivery and cancellation.
// Preparation alone starts nothing. Parent must freeze sources and authorize --run-frozen separately.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'tsx/esm/api';

if (process.argv.length !== 3 || process.argv[2] !== '--run-frozen') throw new Error('Requires separately authorized --run-frozen');
register();
const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
const { SPEECH_TTS_USER_AGENT } = await import('../../apps/companion-service/src/speech-client.ts');
const { SPEECH_FORMAT, isSpeechVerifiedTerminal } = await import('../../packages/contracts/src/index.ts');
const { getSpeech, saveSpeechProvider, beginSpeechUtterance, reserveSpeechSegment, consumeSpeechAudio,
  getSpeechUtterance, cancelSpeechUtterance, getVoice, saveAsrProvider, beginVoiceCapture,
  uploadVoiceCapture, getVoiceCapture, cancelVoiceCapture } = await import('../../plugins/text-client/src/protocol.ts');
const { controlledClient, assistantMessage } = await import('../fixtures/companion-service/controlled-client.mjs');
const { effectRecord, jobsRoot, records, cleanupContainers, inspectOwned, docker, until, within } = await import('../fixtures/companion-service/helpers.mjs');
const { startControlledSpeechMagpie } = await import('../fixtures/companion-speech-output/controlled-magpie.mjs');
const { syntheticPcmChunks } = await import('../fixtures/companion-speech-output/synthetic-pcm.mjs');
const { startControlledMagpie } = await import('../fixtures/companion-voice-input/controlled-magpie.mjs');
const { SAMPLE_COUNT, syntheticPcm, syntheticWav } = await import('../fixtures/companion-voice-input/synthetic-audio.mjs');

const IMAGE_TAG = '1panel/deepseek-harness:0.2.0-rc.2';
const IMAGE_DIGEST = 'sha256:a9975a0df83b07f6ef3a57098174a8303cb0e322570e1d2f175ceba33f417a72';
const IMAGE_REPOSITORY_DIGEST = `1panel/deepseek-harness@${IMAGE_DIGEST}`;
const PCM_FRAMES = 9600;
const replyTexts = [' First controlled formal reply.\r\n保持原文。 ', 'Second controlled formal reply, cancelled only in speech.'];
const value = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'speech-core-docker-asr-continuity', status: 'running', checks: [],
  limit: 'Actual service/Core/Docker and loopback synthetic TTS/ASR; no renderer, playback device, hearing or live model claim.' };
const abort = new AbortController();
let root, token, service, model, tts, asr, transport, asrTicket, speechIntent;
let asrUpload, speechDownload;
let stage = 'preflight', exit = 1;
try {
  const requestedImage = process.env.PET_CLOUD_EXEC_IMAGE ?? IMAGE_TAG;
  assert.ok([IMAGE_TAG, IMAGE_DIGEST, IMAGE_REPOSITORY_DIGEST].includes(requestedImage), 'Only the explicitly authorized existing image is allowed');
  const inspectedImage = await docker(['image', 'inspect', '--format', '{"id":{{json .Id}},"digests":{{json .RepoDigests}}}', requestedImage]);
  assert.equal(inspectedImage.failed, false); assert.equal(inspectedImage.truncated, false);
  assert.equal(inspectedImage.code, 0, 'Required image must already exist; never pull or execute on the host');
  const image = JSON.parse(inspectedImage.stdout);
  assert.match(image.id, /^sha256:[a-f0-9]{64}$/);
  assert.ok(image.id === IMAGE_DIGEST || image.digests?.includes(IMAGE_REPOSITORY_DIGEST), 'Existing image identity must match the authorized digest');
  report.imageId = image.id;
  root = await mkdtemp(path.join(os.tmpdir(), 'companion-speech-worker-'));
  report.syntheticRoot = root;
  token = randomUUID() + randomUUID(); model = controlledClient({ holdResponses: 3 });
  tts = await startControlledSpeechMagpie({ expectedUserAgent: SPEECH_TTS_USER_AGENT,
    expectedAuthorization: 'Bearer magpie-dsh-pet', voice: 'Mia', frames: PCM_FRAMES,
    pcmChunkBytes: 4801, fragments: [29, 257, 1021], holdTerminal: true });
  // ASR retains its existing M4 16kHz fixture codec; TTS alone uses the declared 24kHz PCM codec.
  asr = await startControlledMagpie({ expectedWav: syntheticWav(), expectedAuthorization: 'Bearer magpie-dsh-pet', hold: true });
  service = await createCompanionService({ dataDirectory: root, token, image: image.id,
    mode: 'model', model: 'controlled-offline', client: model.client });
  const serviceUrl = new URL(service.url); assert.equal(serviceUrl.hostname, '127.0.0.1'); assert.notEqual(serviceUrl.port, '0');
  transport = { baseUrl: service.url, token };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (route, body) => {
    const response = await fetch(service.url + route, { headers, signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    assert.ok(response.ok, `Controlled service route failed: ${route} (${response.status})`);
    return value(await response.json());
  };
  stage = 'commit-legitimate-Core-replies';
  for (let index = 0; index < replyTexts.length; index++) {
    await request('/api/messages', { commandId: randomUUID(), text: `Prepare controlled formal reply ${index + 1}.` });
    const inference = await model.next(index + 1);
    assert.equal(inference.options.signal.aborted, false);
    inference.complete([assistantMessage(replyTexts[index])]);
    await until(() => request('/api/snapshot'), snapshot => snapshot.agent.status === 'ready' &&
      snapshot.messages.some(message => message.role === 'assistant' && message.text === replyTexts[index]), 'actual committed assistant reply');
  }
  const canonical = await request('/api/snapshot');
  const committedEvents = await service.runtime.events(0, canonical.epoch);
  const replies = replyTexts.map(text => {
    const messages = canonical.messages.filter(message => message.role === 'assistant' && message.text === text);
    assert.equal(messages.length, 1); const message = messages[0];
    const event = committedEvents.events.find(item => item.kind === 'message' && item.data.messageId === message.id);
    assert.ok(event); assert.equal(event.data.role, 'assistant');
    return { message, event };
  });
  const clientId = randomUUID();
  const speechView = value(await getSpeech(transport));
  const speechProvider = speechView.providers.find(provider => provider.providerRef === speechView.feature.providerRef); assert.ok(speechProvider);
  const configuredSpeech = value(await saveSpeechProvider(transport, { providerRef: speechProvider.providerRef,
    expectedRevision: speechProvider.configRevision, settings: { baseUrl: tts.baseUrl, modelRef: 'xiaomi/mimo-v2.5-tts',
      authMode: 'local-client-id', protocol: 'mimo-native-pcm16-sse', voice: 'Mia' } }));
  const selectedSpeech = configuredSpeech.providers.find(provider => provider.providerRef === configuredSpeech.feature.providerRef);
  assert.equal(configuredSpeech.feature.source, 'ready'); assert.ok(selectedSpeech?.bindingId);
  const voiceView = value(await getVoice(transport));
  const voiceProvider = voiceView.providers.find(provider => provider.providerRef === voiceView.feature.providerRef); assert.ok(voiceProvider);
  const configuredVoice = value(await saveAsrProvider(transport, { providerRef: voiceProvider.providerRef,
    expectedRevision: voiceProvider.configRevision, settings: { baseUrl: asr.baseUrl, modelRef: 'xiaomi/mimo-v2.5-asr', authMode: 'local-client-id', protocol: 'mimo-native' } }));
  const selectedVoice = configuredVoice.providers.find(provider => provider.providerRef === configuredVoice.feature.providerRef); assert.ok(selectedVoice?.bindingId);
  const modelBefore = await request('/api/model');

  stage = 'actual-Docker-work-and-held-Core-ASR';
  const work = await request('/api/tasks', { commandId: randomUUID(), title: 'Speech independent work',
    code: "import {appendFileSync,existsSync,writeFileSync} from 'node:fs'; appendFileSync('effect.txt','once\\n'); let heartbeat=0; const deadline=Date.now()+25000; while(!existsSync('release')&&Date.now()<deadline){writeFileSync('heartbeat.txt',String(++heartbeat)); await new Promise(r=>setTimeout(r,40));} if(!existsSync('release'))throw new Error('watchdog'); writeFileSync('result.txt','speech work completed\\n');",
    outputs: [{ path: 'result.txt', mediaType: 'text/plain' }], timeoutMs: 28000 });
  const record = await effectRecord(root);
  const workDir = path.join(jobsRoot(root), record.jobId, 'work');
  assert.equal(record.mounts[0].Source, workDir);
  report.task = { taskId: work.taskId, executionId: record.executionId, supervisorTaskId: record.taskId, jobId: record.jobId, containerId: record.containerId };
  await request('/api/messages', { commandId: randomUUID(), text: 'Keep the third controlled turn pending while speech runs.' });
  const thinking = await model.next(3);
  asrTicket = value(await beginVoiceCapture(transport, { captureId: randomUUID(), clientId, agentId: canonical.agent.id,
    expectedFeatureRevision: configuredVoice.feature.configRevision, providerRef: selectedVoice.providerRef,
    bindingId: selectedVoice.bindingId, finishMode: configuredVoice.feature.finishMode }, abort.signal));
  asrUpload = uploadVoiceCapture(transport, asrTicket, SAMPLE_COUNT, syntheticPcm(), abort.signal);
  void asrUpload.catch(() => {});
  await within(asr.firstAudio, 'actual held native ASR request');
  const messagesBefore = (await request('/api/snapshot')).messages;
  let lastHeartbeat = 0;
  const unchanged = async () => {
    assert.equal(thinking.done, false); assert.equal(thinking.options.signal.aborted, false);
    assert.equal(model.requests.length, 3, 'Speech must not create another Core inference');
    assert.equal(asr.snapshot.audioCount, 1); assert.equal(asr.snapshot.abortedResponses, 0);
    assert.equal(value(await getVoiceCapture(transport, asrTicket)).phase, 'transcribing');
    const task = await request(`/api/tasks/${work.taskId}`);
    assert.equal(task.status, 'running'); assert.equal(task.executionId, record.executionId);
    const durable = await records(root); assert.equal(durable.length, 1);
    assert.equal(durable[0].jobId, record.jobId); assert.equal(durable[0].containerId, record.containerId);
    const actual = await inspectOwned(record); assert.equal(actual.kind, 'owned'); assert.equal(actual.container.id, record.containerId);
    assert.equal(actual.container.state.Running, true);
    lastHeartbeat = await until(async () => Number(await readFile(path.join(workDir, 'heartbeat.txt'), 'utf8')),
      heartbeat => Number.isSafeInteger(heartbeat) && heartbeat > lastHeartbeat, 'actual same-container work progress');
    assert.equal(await readFile(path.join(workDir, 'effect.txt'), 'utf8'), 'once\n');
    assert.deepEqual((await request('/api/snapshot')).messages, messagesBefore, 'Speech must not add user/assistant messages');
  };
  await unchanged();
  const expectedPcm = createHash('sha256'); for (const chunk of syntheticPcmChunks(PCM_FRAMES, 4801)) expectedPcm.update(chunk);
  const expectedPcmHash = expectedPcm.digest('hex');
  const startSpeech = async index => {
    const { message, event } = replies[index];
    speechIntent = { utteranceId: randomUUID(), clientId, agentId: canonical.agent.id, serviceEpoch: canonical.epoch,
      messageId: message.id, eventSequence: event.sequence, expectedFeatureRevision: configuredSpeech.feature.configRevision,
      providerRef: selectedSpeech.providerRef, bindingId: selectedSpeech.bindingId, volume: 75 };
    const receipt = value(await beginSpeechUtterance(transport, speechIntent, abort.signal));
    assert.equal(receipt.segmentCount, 1);
    const key = { utteranceId: receipt.utteranceId, clientId, agentId: receipt.agentId, serviceEpoch: receipt.serviceEpoch,
      utteranceBindingId: receipt.utteranceBindingId, segmentIndex: 0, requestId: `${receipt.utteranceId}.0` };
    value(await reserveSpeechSegment(transport, key, abort.signal));
    const first = Promise.withResolvers(); const hash = createHash('sha256'); let receivedBytes = 0;
    speechDownload = consumeSpeechAudio(transport, key, receipt, async (header, pcm) => {
      assert.deepEqual(header.format, SPEECH_FORMAT);
      for await (const chunk of pcm) { receivedBytes += chunk.byteLength; hash.update(chunk); first.resolve(); }
    }, abort.signal);
    void first.promise.catch(() => {});
    void speechDownload.then(result => { if (!result.ok) first.reject(new Error(result.error.code)); }, error => first.reject(error));
    return { receipt, key, first: first.promise, digest: () => hash.digest('hex'), bytes: () => receivedBytes };
  };
  stage = 'complete-speech-while-Core-ASR-work-remain-held';
  const completed = await startSpeech(0);
  await within(completed.first, 'first consumed TTS PCM before terminal');
  assert.equal(tts.snapshot.requests[0].terminalWritten, null);
  await unchanged();
  tts.releaseTerminal(1);
  const received = value(await speechDownload); speechDownload = undefined;
  assert.equal(received.receivedFrames, PCM_FRAMES); assert.equal(completed.bytes(), PCM_FRAMES * 2);
  assert.equal(completed.digest(), expectedPcmHash);
  const finishedSpeech = value(await getSpeechUtterance(transport, completed.receipt));
  assert.equal(isSpeechVerifiedTerminal(finishedSpeech.currentSegment?.terminal), true);
  assert.equal(finishedSpeech.currentSegment.terminal.producedFrames, PCM_FRAMES);
  assert.equal(tts.snapshot.requestCount, 1); assert.equal(tts.snapshot.requests[0].textSha256, sha(replyTexts[0]));
  await unchanged(); report.checks.push('completed-native-speech-delivery-keeps-actual-Core-held-ASR-and-same-running-container');

  stage = 'cancel-speech-without-cancelling-Core-ASR-work';
  const cancelled = await startSpeech(1);
  await within(cancelled.first, 'second TTS stream first PCM');
  assert.equal(tts.snapshot.requests[1].terminalWritten, null); await unchanged();
  const cancellation = value(await cancelSpeechUtterance(transport, cancelled.receipt));
  assert.equal(cancellation.outcome, 'cancelled'); assert.equal(cancellation.cleanup, 'settled');
  assert.equal((await speechDownload).ok, false); speechDownload = undefined;
  await within(tts.firstResponseAborted, 'actual cancelled TTS native response close');
  assert.equal(tts.snapshot.requestCount, 2); assert.equal(tts.snapshot.abortedResponses, 1);
  assert.equal(tts.snapshot.requests[1].textSha256, sha(replyTexts[1]));
  await unchanged();
  const modelAfter = await request('/api/model');
  assert.deepEqual(modelAfter.desired, modelBefore.desired); assert.deepEqual(modelAfter.applied, modelBefore.applied);
  assert.deepEqual(modelAfter.connectors.map(({ id, configRevision, credential }) => ({ id, configRevision, version: credential.version })),
    modelBefore.connectors.map(({ id, configRevision, credential }) => ({ id, configRevision, version: credential.version })));
  const voiceAfter = value(await getVoice(transport)).providers.find(provider => provider.providerRef === selectedVoice.providerRef);
  assert.equal(voiceAfter.configRevision, selectedVoice.configRevision); assert.equal(voiceAfter.bindingId, selectedVoice.bindingId);
  assert.equal(voiceAfter.credential.version, selectedVoice.credential.version);
  report.checks.push('speech-cancel-joins-only-owned-native-audio-without-stopping-held-Core-ASR-or-Docker-execution');

  stage = 'release-ASR-Core-and-same-work';
  asr.release(); const transcript = value(await asrUpload); asrUpload = undefined;
  assert.equal(transcript.phase, 'final'); assert.equal(transcript.cleanup, 'settled');
  assert.equal(thinking.done, false); assert.equal(thinking.options.signal.aborted, false); assert.equal(model.requests.length, 3);
  assert.deepEqual((await request('/api/snapshot')).messages, messagesBefore);
  thinking.complete([assistantMessage('Controlled pending turn completed after speech checks.')]);
  await until(() => request('/api/snapshot'), snapshot => snapshot.agent.status === 'ready', 'same Core turn completion');
  assert.equal((await inspectOwned(record)).container.state.Running, true);
  await writeFile(path.join(workDir, 'release'), 'release\n', { flag: 'wx', mode: 0o600 });
  const finished = await until(() => request(`/api/tasks/${work.taskId}`), task => task.status === 'completed', 'same work completion');
  assert.equal(finished.executionId, record.executionId); assert.equal(finished.artifacts.length, 1);
  const artifact = finished.artifacts[0];
  const response = await fetch(`${service.url}/api/artifacts/${artifact.id}`, { headers, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
  const localBytes = await readFile(path.join(workDir, 'result.txt'));
  assert.equal(bytes.byteLength, artifact.sizeBytes); assert.equal(bytes.toString('utf8'), 'speech work completed\n');
  assert.equal(sha(bytes), sha(localBytes)); assert.equal(await readFile(path.join(workDir, 'effect.txt'), 'utf8'), 'once\n');
  assert.equal((await records(root)).length, 1);
  report.artifactSha256 = sha(bytes); report.pcmSha256 = expectedPcmHash;
  report.checks.push('held-ASR-and-original-Core-finish-independently-and-same-worker-produces-one-effect-and-matching-artifact');
  report.status = 'passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  if (token) detail = detail.split(token).join('[redacted]');
  report.status = 'failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  const failures = [];
  // Cleanup acts only on known intents and the exact records/mounts of this fresh private root.
  if (transport && speechIntent) try { value(await cancelSpeechUtterance(transport, speechIntent, AbortSignal.timeout(15000))); } catch { failures.push('speech-cancel'); }
  if (transport && asrTicket) try { value(await cancelVoiceCapture(transport, {
    captureId: asrTicket.captureId, clientId: asrTicket.clientId, agentId: asrTicket.agentId, serviceEpoch: asrTicket.serviceEpoch,
  }, AbortSignal.timeout(15000))); } catch { failures.push('asr-cancel'); }
  abort.abort(); model?.close();
  if (tts) try {
    const closed = await tts.close(); assert.equal(closed.listening, false); assert.equal(closed.openSockets, 0); assert.equal(closed.pendingHandlers, 0);
  } catch { failures.push('speech-peer-close'); }
  if (asr) try { await asr.close(); } catch { failures.push('asr-peer-close'); }
  if (service) try { await service.close(); } catch { failures.push('service-close'); }
  const pending = await Promise.allSettled([asrUpload, speechDownload].filter(Boolean));
  if (pending.some(result => result.status === 'rejected')) failures.push('owned-http-join');
  if (root && await access(jobsRoot(root)).then(() => true, () => false)) {
    try { await cleanupContainers(root); } catch { failures.push('owned-container-cleanup'); }
  }
  report.cleanup = { status: failures.length ? 'failed' : 'settled', failures };
  if (failures.length) { report.status = 'cleanup-failed'; exit = 1; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
