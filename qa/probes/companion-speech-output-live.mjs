// Reviewable live-call proposal. NOT authorized by file creation, --describe or guard tests.
// No product import, listener or network operation occurs before exact approval + exclusive marker.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIVE_TEXT = '你好，我是你的桌宠。现在正在测试语音朗读。';
const hash = value => createHash('sha256').update(value).digest('hex');
export const LIVE_SCOPE = Object.freeze({ version: 1, gateway: 'http://127.0.0.1:3425/v1',
  nativeUrl: 'http://127.0.0.1:3425/v1/magpie/native/xiaomi/v1/chat/completions',
  modelRef: 'xiaomi/mimo-v2.5-tts', wireModel: 'mimo-v2.5-tts', voice: '冰糖',
  protocol: 'mimo-native-pcm16-sse', format: Object.freeze({ codec: 'pcm-s16le', sampleRate: 24000, channels: 1 }),
  text: LIVE_TEXT, textSha256: hash(LIVE_TEXT), maxNativePosts: 1, maxSegments: 1,
  maxWindowMs: 60000, maxAcceptedPcmBytes: 1024 * 1024,
  authMode: 'local-client-id', publicClientId: 'magpie-dsh-pet', userAgent: 'dsh-pet-speech/1',
  externalTextModelCalls: 0, playback: false, artifact: 'private test WAV, complete only after verified terminal; otherwise partial' });
export const LIVE_SCOPE_SHA256 = hash(JSON.stringify(LIVE_SCOPE));
const root = fileURLToPath(new URL('../..', import.meta.url));
const self = fileURLToPath(import.meta.url);
export const ATTEMPT_PATH = path.join(root, '.companion-data/qa-private/companion-speech-output/live-attempt-mimo-tts-bingtang-v1.json');
const attemptFacts = { claimed: false, marker: ATTEMPT_PATH, stats: null, cleanup: { service: 'not-created-or-not-returned' } };
export function safeLiveFailure(facts, markerRefused = false) {
  return { status: facts.claimed ? 'attempt-failed-or-unknown-no-retry' : markerRefused ? 'attempt-marker-refused-no-new-request-prior-outcome-unknown' : 'not-run-approval-required',
    attemptMarkerClaimed: facts.claimed, marker: facts.marker, nativePosts: facts.stats?.nativeDelegations ?? 0,
    cleanup: { service: facts.cleanup?.service ?? 'unknown', remote: typeof facts.cleanup?.remote === 'object' ? facts.cleanup.remote?.cleanup : facts.cleanup?.remote ?? 'unknown' } };
}
export async function persistLiveReport(filename, report, writer = writeFile) {
  try { await writer(filename, JSON.stringify(report, null, 2), { mode: 0o600 }); return true; }
  catch { return false; }
}

export function validateLiveApproval(args, env, scriptSha256) {
  assert.deepEqual(args.slice(0, 2), ['--run-authorized', '--approval-reference'], 'Only the reviewed explicit invocation is accepted');
  assert.equal(args.length, 3, 'No target/text/model/budget overrides');
  assert.ok(typeof args[2] === 'string' && args[2].trim().length >= 4 && args[2].length <= 300 && !/[\r\n\x00]/.test(args[2]), 'Exact human approval reference required');
  assert.equal(env.PET_SPEECH_LIVE_SCOPE_SHA256, LIVE_SCOPE_SHA256, 'Fresh approval of this exact scope required');
  assert.equal(env.PET_SPEECH_LIVE_SCRIPT_SHA256, scriptSha256, 'Approval must bind the reviewed script bytes');
  assert.match(scriptSha256, /^[a-f0-9]{64}$/);
  return { reference: args[2], scopeSha256: LIVE_SCOPE_SHA256, scriptSha256 };
}

export async function claimLiveAttempt(filename, record) {
  assert.equal(path.isAbsolute(filename), true);
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const handle = await open(filename, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(record, null, 2)); await handle.sync(); await handle.close(); }
  catch (error) { error.attemptMarkerReserved = true; await handle.close().catch(() => {}); throw error; }
  // Never delete/reset the marker, including setup failure, timeout, process crash or unknown result.
}

export function createLiveFetchGuard({ delegate, markerClaimed, localOrigin, signal, onNativeStart }) {
  assert.equal(markerClaimed, true, 'Native egress cannot be armed without an exclusive attempt marker');
  const stats = { nativeDelegations: 0, nativeAttempts: 0, refusedEgress: 0, audioGets: 0, native: null };
  const fetch = async (resource, init = {}) => {
    const target = new URL(resource instanceof Request ? resource.url : String(resource));
    const method = (init.method ?? (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
    if (target.href === LIVE_SCOPE.nativeUrl) {
      stats.nativeAttempts++;
      if (stats.nativeDelegations !== 0) { stats.refusedEgress++; throw new Error('native-budget-exhausted'); }
      assert.equal(method, 'POST');
      const headers = new Headers(init.headers ?? (resource instanceof Request ? resource.headers : undefined));
      assert.equal(headers.get('user-agent'), LIVE_SCOPE.userAgent);
      assert.equal(headers.get('authorization'), `Bearer ${LIVE_SCOPE.publicClientId}`);
      assert.equal(headers.get('accept'), 'text/event-stream');
      assert.match(headers.get('content-type') ?? '', /^application\/json/i);
      assert.equal(typeof init.body, 'string');
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { model: LIVE_SCOPE.wireModel, stream: true,
        messages: [{ role: 'assistant', content: LIVE_TEXT }], audio: { format: 'pcm16', voice: LIVE_SCOPE.voice } });
      signal.throwIfAborted();
      stats.nativeDelegations++; onNativeStart?.();
      stats.native = { startedAt: Date.now(), model: body.model, stream: body.stream, voice: body.audio.voice,
        bodyBytes: Buffer.byteLength(init.body), bodySha256: hash(init.body), textSha256: LIVE_SCOPE.textSha256 };
      const response = await delegate(resource, { ...init, redirect: 'error',
        signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal });
      stats.native.headersAt = Date.now(); stats.native.httpStatus = response.status;
      stats.native.contentType = response.headers.get('content-type');
      return response; // Actual response/body unmodified: no synthetic terminal, tee, codec or fallback.
    }
    if (localOrigin() && target.origin === localOrigin() && target.pathname.startsWith('/api/')) {
      if (/\/api\/speech\/utterances\/[^/]+\/segments\/\d+\/audio$/.test(target.pathname)) {
        assert.equal(method, 'GET'); stats.audioGets++;
        if (stats.audioGets > 1) { stats.refusedEgress++; throw new Error('audio-consumer-budget-exhausted'); }
      }
      return delegate(resource, init);
    }
    stats.refusedEgress++; throw new Error('unapproved-egress-target');
  };
  return { fetch, stats };
}

export function wavHeader(pcmBytes) {
  assert.ok(Number.isSafeInteger(pcmBytes) && pcmBytes >= 0 && pcmBytes <= LIVE_SCOPE.maxAcceptedPcmBytes && pcmBytes % 2 === 0);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(pcmBytes + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcmBytes, 40); return header;
}
async function writeAll(handle, bytes, position) {
  let offset = 0;
  while (offset < bytes.length) { const written = await handle.write(bytes, offset, bytes.length - offset, position + offset); assert.ok(written.bytesWritten > 0); offset += written.bytesWritten; }
}
async function within(work, ms, label) {
  let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}
const val = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
async function listedSourceHashes() {
  const files = ['pnpm-lock.yaml', 'apps/companion-service/src/service.ts', 'apps/companion-service/src/speech-client.ts',
    'apps/companion-service/src/speech-controller.ts', 'apps/companion-service/src/speech-http.ts',
    'plugins/shared-speech/src/index.ts', 'plugins/shared-speech/src/segments.ts', 'plugins/tts-magpie/src/index.ts',
    'plugins/tts-magpie/src/stream.ts', 'packages/contracts/src/companion-speech.ts',
    'plugins/text-client/src/client/speech-protocol.ts', 'plugins/harness-cortico/src/harness.mjs',
    'qa/fixtures/companion-service/controlled-client.mjs'];
  const result = {};
  for (const file of files) result[file] = hash(await readFile(path.join(root, file)));
  return result;
}

async function runApproved(approval) {
  const runId = randomUUID();
  const reserved = { runId, reservedAt: new Date().toISOString(), approval, scope: LIVE_SCOPE,
    state: 'exclusive attempt reserved; may be unknown; never automatically retry' };
  // This happens before importing/creating a product service, configuring a target, or arming any fetch.
  await claimLiveAttempt(ATTEMPT_PATH, reserved); attemptFacts.claimed = true;
  const directory = path.join(path.dirname(ATTEMPT_PATH), `live-${runId}`);
  await mkdir(directory, { mode: 0o700 }); const home = path.join(directory, 'home'); await mkdir(home, { mode: 0o700 });
  for (const key of Object.keys(process.env)) if (/^DSH_|^COMPANION_|API_KEY|TOKEN|^PULSE_|^ALSA_/.test(key)) delete process.env[key];
  Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache') });
  const report = { runId, scope: LIVE_SCOPE, approval, status: 'running', generationVerified: false,
    playback: 'not attempted; no browser/AudioContext/speaker', serviceImplementation: 'actual createCompanionService with existing controlled Core injection seam; public HTTP/protocol for all operations',
    directory, attemptMarker: ATTEMPT_PATH, receivedPcmBytes: 0, pcmChunks: 0, artifact: null,
    cleanup: { service: 'not-created' }, limits: ['No human-hearing/quality/full-duplex/latency-distribution evidence.',
      'One local Magpie native POST does not bound the gateway/vendor internal routing, retries or billing.',
      'Consumer accepts/persists at most 1 MiB PCM then aborts; read-ahead or provider computation after abort is not claimed bounded by this file cap.',
      'Generated raw PCM rate/channels follow the fixed codec/header contract, not an independent acoustic measurement.'] };
  let stage = 'fingerprints', service, core, streamTask, api, protocol, transport, utteranceKey, file, timer, exit = 1, forceExitAfterReport = false;
  let serviceOrigin = null; const nativeAbort = new AbortController(), eventAbort = new AbortController();
  const originalFetch = globalThis.fetch;
  const guard = createLiveFetchGuard({ delegate: originalFetch, markerClaimed: true, localOrigin: () => serviceOrigin, signal: nativeAbort.signal,
    onNativeStart: () => { timer = setTimeout(() => nativeAbort.abort('approved-60s-budget'), LIVE_SCOPE.maxWindowMs); } });
  attemptFacts.stats = guard.stats; attemptFacts.cleanup = report.cleanup;
  report.upstreamSseEventTiming = 'not directly observed: only response headers, public PCM chunk/EOF and product-verified terminal facts';
  report.hashScope = 'Only the explicitly listed source/lock/helper files; not a full dependency or production artifact freeze. Parent owns the outer full snapshot.';
  globalThis.fetch = guard.fetch;
  const partial = path.join(directory, 'test.partial.wav'), complete = path.join(directory, 'test.wav');
  const pcmHash = createHash('sha256'); let consumerComplete = false;
  try {
    report.listedSourceHashesBefore = await listedSourceHashes();
    stage = 'create-isolated-controlled-Core-service';
    const { createCompanionService } = await import('../../apps/companion-service/src/service.ts');
    const { controlledClient, assistantMessage } = await import('../fixtures/companion-service/controlled-client.mjs');
    protocol = await import('../../plugins/text-client/src/client/speech-protocol.ts');
    const { streamEvents, sendMessage, getSnapshot } = await import('../../plugins/text-client/src/client/protocol.ts');
    const { isSpeechVerifiedTerminal } = await import('../../packages/contracts/src/companion-speech.ts');
    core = controlledClient({ holdResponses: 1 }); const token = randomUUID() + randomUUID();
    service = await createCompanionService({ dataDirectory: path.join(directory, 'service'), token, port: 0, hostname: '127.0.0.1',
      mode: 'model', model: 'controlled-offline', client: core.client, name: 'Approved one-shot TTS check' });
    serviceOrigin = service.url; transport = { baseUrl: service.url, token }; report.serviceOrigin = serviceOrigin;
    api = async (route, body) => {
      const response = await fetch(service.url + route, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
      assert.ok(response.ok); return val(await response.json());
    };
    stage = 'configure-frozen-Magpie-provider';
    const initial = val(await protocol.getSpeech(transport));
    const provider = initial.providers.find(value => value.providerRef === 'pet.tts-magpie/magpie'); assert.ok(provider);
    const configured = val(await protocol.saveSpeechProvider(transport, { providerRef: provider.providerRef, expectedRevision: provider.configRevision,
      settings: { baseUrl: LIVE_SCOPE.gateway, modelRef: LIVE_SCOPE.modelRef, authMode: 'local-client-id', protocol: LIVE_SCOPE.protocol, voice: LIVE_SCOPE.voice } }));
    const selected = configured.providers.find(value => value.providerRef === configured.feature.providerRef); assert.ok(selected?.bindingId);
    assert.equal(selected.credential.source, 'local-client-id'); assert.equal(guard.stats.nativeDelegations, 0);
    stage = 'canonical-formal-message-through-real-Core';
    const baseline = val(await getSnapshot(transport, AbortSignal.timeout(15000)));
    const canonical = Promise.withResolvers(); void canonical.promise.catch(() => {});
    streamTask = streamEvents(transport, { after: baseline.cursor, epoch: baseline.epoch, signal: eventAbort.signal, onInvalidEvent: () => canonical.reject(new Error('invalid-canonical-event')) }, message => {
      if (message.kind === 'companion' && message.event.kind === 'message' && message.event.data.role === 'assistant') canonical.resolve(message.event);
    });
    void streamTask.then(result => { if (!eventAbort.signal.aborted) canonical.reject(new Error(result.kind)); });
    val(await sendMessage(transport, { commandId: randomUUID(), text: 'Produce the single controlled formal reply for the separately approved TTS check.' }));
    const inference = await core.next(1); inference.complete([assistantMessage(LIVE_TEXT)]);
    const event = await within(canonical.promise, 15000, 'canonical-event-timeout');
    const snapshot = val(await getSnapshot(transport, AbortSignal.timeout(15000)));
    const message = snapshot.messages.find(value => value.id === event.data.messageId);
    assert.ok(message && message.role === 'assistant' && message.text === LIVE_TEXT);
    assert.equal(snapshot.messages.filter(value => value.role === 'assistant').length, 1);
    report.canonical = { agentId: snapshot.agent.id, messageId: message.id, eventSequence: event.sequence, textSha256: hash(message.text) };
    eventAbort.abort(); await streamTask; streamTask = undefined;
    stage = 'single-logical-single-segment-admission';
    utteranceKey = { utteranceId: randomUUID(), clientId: randomUUID(), agentId: snapshot.agent.id, serviceEpoch: snapshot.epoch };
    const receipt = val(await protocol.beginSpeechUtterance(transport, { ...utteranceKey, providerRef: selected.providerRef, bindingId: selected.bindingId,
      messageId: message.id, eventSequence: event.sequence, expectedFeatureRevision: configured.feature.configRevision, volume: 0 }));
    assert.equal(receipt.segmentCount, 1); assert.equal(guard.stats.nativeDelegations, 0);
    const key = { ...utteranceKey, utteranceBindingId: receipt.utteranceBindingId, segmentIndex: 0, requestId: `${utteranceKey.utteranceId}-part-0` };
    val(await protocol.reserveSpeechSegment(transport, key));
    stage = 'one-audio-GET-one-native-POST';
    file = await open(partial, 'wx', 0o600); await writeAll(file, wavHeader(0), 0);
    const read = val(await protocol.consumeSpeechAudio(transport, key, receipt, async (header, audio, signal) => {
      report.audioHeader = header;
      assert.deepEqual(header.format, LIVE_SCOPE.format);
      for await (const pcm of audio) {
        signal.throwIfAborted(); assert.equal(pcm.byteLength % 2, 0);
        if (report.receivedPcmBytes + pcm.byteLength > LIVE_SCOPE.maxAcceptedPcmBytes) { nativeAbort.abort('approved-PCM-budget'); throw new Error('approved-PCM-budget'); }
        report.firstPcmAt ??= Date.now(); report.pcmChunks++; pcmHash.update(pcm);
        await writeAll(file, pcm, 44 + report.receivedPcmBytes); report.receivedPcmBytes += pcm.byteLength;
      }
      consumerComplete = true;
    }, nativeAbort.signal));
    report.audioEofAt = Date.now(); assert.equal(consumerComplete, true); assert.equal(read.receivedBytes, report.receivedPcmBytes);
    stage = 'one-terminal-status-verification';
    const status = val(await protocol.getSpeechUtterance(transport, utteranceKey, nativeAbort.signal));
    report.terminalStatus = status;
    const terminal = status.currentSegment?.terminal;
    assert.ok(isSpeechVerifiedTerminal(terminal)); assert.equal(terminal.producedBytes, report.receivedPcmBytes);
    assert.equal(terminal.drainedBytes, report.receivedPcmBytes); assert.equal(terminal.producedFrames * 2, report.receivedPcmBytes);
    assert.equal(status.outcome, 'completed'); assert.equal(status.cleanup, 'settled');
    assert.equal(guard.stats.nativeDelegations, 1); assert.equal(guard.stats.nativeAttempts, 1); assert.equal(guard.stats.audioGets, 1); assert.equal(guard.stats.refusedEgress, 0);
    assert.match(guard.stats.native.contentType ?? '', /^text\/event-stream(?:\s*;|$)/i);
    report.generationVerified = true; report.pcmSha256 = pcmHash.digest('hex');
    report.durationByDeclaredCodecSeconds = report.receivedPcmBytes / 2 / 24000;
    clearTimeout(timer); timer = undefined;
    await writeAll(file, wavHeader(report.receivedPcmBytes), 0); await file.sync(); await file.close(); file = undefined;
    report.artifact = { path: partial, complete: false, label: 'Not promoted until terminal, cleanup and frozen hashes all pass', bytes: report.receivedPcmBytes + 44 };
    report.status = 'generation-verified-awaiting-cleanup'; exit = 0;
  } catch (error) {
    report.status = 'failed-or-unknown-no-retry'; report.failure = { stage, type: error?.name ?? 'Error', code: error?.error?.code ?? null };
    if (file) {
      try { await writeAll(file, wavHeader(report.receivedPcmBytes), 0); await file.sync(); await file.close(); file = undefined;
        report.artifact = { path: partial, complete: false, label: 'PARTIAL: no successful generation claim', acceptedPcmBytes: report.receivedPcmBytes }; } catch { report.partialArtifactUnconfirmed = true; }
    }
  } finally {
    clearTimeout(timer); nativeAbort.abort('probe-finished'); eventAbort.abort();
    if (streamTask) await streamTask.catch(() => {});
    if (file) await file.close().catch(() => {});
    if (service && utteranceKey && protocol) {
      try { report.cleanup.remote = val(await protocol.cancelSpeechUtterance(transport, utteranceKey, AbortSignal.timeout(20000))); assert.equal(report.cleanup.remote.cleanup, 'settled'); }
      catch { report.cleanup.remote = 'unknown'; exit = 1; }
    }
    core?.close();
    if (service) {
      try { await within(service.close(), 20000, 'service-cleanup-unconfirmed'); report.cleanup.service = 'closed'; }
      catch { report.cleanup.service = 'unconfirmed'; exit = 1; forceExitAfterReport = true; }
    }
    // Keep the egress fence armed until process termination if any raw cleanup is unconfirmed.
    if (!forceExitAfterReport) globalThis.fetch = originalFetch;
    report.egress = guard.stats;
    try { report.listedSourceHashesAfter = await listedSourceHashes(); assert.deepEqual(report.listedSourceHashesAfter, report.listedSourceHashesBefore); report.listedSourceHashesUnchanged = true; }
    catch { report.listedSourceHashesUnchanged = false; exit = 1; }
    if (exit === 0 && report.generationVerified) {
      try {
        // Exact checked absolute paths: promote only after generation, cleanup and frozen-input checks pass.
        assert.equal(path.resolve(partial), path.join(directory, 'test.partial.wav'));
        assert.equal(path.resolve(complete), path.join(directory, 'test.wav'));
        await rename(partial, complete);
        report.artifact = { path: complete, complete: true, bytes: report.receivedPcmBytes + 44, wavSha256: hash(await readFile(complete)) };
        report.status = 'generation-verified-no-playback';
      } catch { report.status = 'artifact-promotion-unconfirmed'; exit = 1; }
    } else {
      report.status = 'failed-or-unknown-no-retry';
      if (report.artifact) report.artifact.complete = false;
    }
    report.processTerminationRequired = forceExitAfterReport;
    report.actualExit = exit;
    const reportWritten = await persistLiveReport(path.join(directory, 'report.json'), report);
    if (!reportWritten) {
      exit = 1;
      if (report.artifact?.complete) {
        assert.equal(path.resolve(complete), path.join(directory, 'test.wav')); assert.equal(path.resolve(partial), path.join(directory, 'test.partial.wav'));
        try { await rename(complete, partial); report.artifact = { path: partial, complete: false, label: 'PARTIAL/UNCONFIRMED: report persistence failed' }; }
        catch { report.artifact = { path: complete, complete: false, label: 'UNCONFIRMED: report and artifact rollback failed; do not deliver as complete' }; }
      }
      console.error(JSON.stringify({ ...safeLiveFailure(attemptFacts), reportWriteFailed: true, processTerminationRequired: forceExitAfterReport }));
    }
    console.log(JSON.stringify({ status: reportWritten ? report.status : 'attempt-failed-or-unknown-no-retry', actualExit: exit, reportWritten, report: path.join(directory, 'report.json'), generationVerified: report.generationVerified,
      nativePosts: report.egress.nativeDelegations, pcmBytes: report.receivedPcmBytes, cleanup: report.cleanup, artifact: report.artifact }, null, 2));
    process.exitCode = exit;
    if (forceExitAfterReport) process.exit(1); // Report remains unknown; terminate only this owned one-shot process/socket set.
  }
}

async function main() {
  const scriptSha256 = hash(await readFile(self));
  if (process.argv.length === 3 && process.argv[2] === '--describe') {
    console.log(JSON.stringify({ status: 'proposal-only-not-authorized-not-run', scope: LIVE_SCOPE, scopeSha256: LIVE_SCOPE_SHA256, scriptSha256, attemptMarker: ATTEMPT_PATH,
      requiredApproval: 'A new explicit user approval for this exact scope and reviewed script, conveyed by Parent. Prior ASR approval is invalid.' }, null, 2)); return;
  }
  const approval = validateLiveApproval(process.argv.slice(2), process.env, scriptSha256);
  assert.ok(process.execArgv.some(value => value === 'tsx' || value === '--import=tsx'), 'Use node --import tsx for the actual product TypeScript modules');
  await runApproved(approval);
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  try { await main(); } catch (error) {
    if (error.attemptMarkerReserved) attemptFacts.claimed = true;
    console.error(JSON.stringify({ ...safeLiveFailure(attemptFacts, error.code === 'EEXIST'), type: error.name }));
    process.exitCode = attemptFacts.claimed ? 1 : 2;
    if (attemptFacts.claimed) process.exit(1); // A post-marker setup/report exception is unknown; close only this owned process, never retry.
  }
}
