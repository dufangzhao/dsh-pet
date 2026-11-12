// Preparation only until Parent authorizes the frozen production build and software output route.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';
import { expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startNullAudio } from '../fixtures/companion-speech-output/software-audio.mjs';
import { startControlledSpeechMagpie } from '../fixtures/companion-speech-output/controlled-magpie.mjs';
import { installSpeechObservers, readSpeechObservations } from '../fixtures/companion-speech-output/player-observers.mjs';

assert.deepEqual(process.argv.slice(2), ['--run-frozen'], 'Parent build/freeze/output-route authorization is required');
const root = fileURLToPath(new URL('../..', import.meta.url));
const tooling = process.env.PET_SPEECH_PULSE_TOOLS;
assert.ok(tooling, 'Verified private null-only Pulse tools required; no default-device execution');
const runId = randomUUID().slice(0, 8), token = randomUUID() + randomUUID();
const evidence = path.join(root, 'qa/fixtures/companion-speech-output/evidence');
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const report = { runId, scope: 'production-service-Main-preload-Pet-software-null-output', status: 'running', checks: [], screenshots: [], observations: {}, cleanup: {},
  limits: ['Synthetic peer/software null output only; no live TTS, physical hearing or quality claim.',
    'Core/work/ASR continuity requires a separate controlled-Core probe; it is not claimed by this scripted native runner.',
    'Scripted Harness emits formal say replies; reasoning/notice exclusions need separate controlled-Core event cases.',
    'Standalone Web TTS-zero/text-ASR checks, strict multi-say within 120ms, and prior-version profile migration require separate cases; this runner does not claim them.',
    'IPC chunk bounds, scheduled-node bounds and schedule-before-next-chunk are observed. Internal consume-ACK invocation timing/whole-process resident memory are not public bridge counters.'] };
let stage = 'guard', exit = 1, audio, display, app, appEnded, consolePage, pet, first, active;
const services = [], peers = [];
async function within(work, label, ms = 30000) {
  let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms); })]); }
  finally { clearTimeout(timer); }
}
function val(result) { assert.equal(result.ok, true, result.error?.code); return result.value; }
async function tree(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await tree(file)); else if (entry.isFile()) result.push(file);
  }
  return result;
}
async function hashes() {
  const names = ['qa/probes/companion-speech-output-native.mjs', 'qa/fixtures/companion-desktop/display.mjs',
    'qa/fixtures/companion-speech-output/controlled-magpie.mjs', 'qa/fixtures/companion-speech-output/synthetic-pcm.mjs',
    'qa/fixtures/companion-speech-output/player-observers.mjs', 'qa/fixtures/companion-speech-output/software-audio.mjs',
    'qa/fixtures/companion-speech-output/null-only-alsa.conf', 'apps/desktop/src/main/builtin-admission.json',
    '.companion-data/tooling/desktop/electron-45/electron', 'plugins/profile/build.mjs', path.relative(root, path.join(tooling, 'provenance.json')), path.relative(root, path.join(tooling, 'root/usr/bin/pulseaudio')),
    path.relative(root, path.join(tooling, 'root/usr/bin/pactl'))];
  for (const directory of ['apps/companion-service/src', 'apps/companion-service/dist', 'apps/desktop/src', 'apps/desktop/dist',
    'packages/contracts/src', 'packages/companion-runtime/src', 'packages/host-kernel/src',
    path.relative(root, path.join(tooling, 'root/usr/lib')),
    ...['profile', 'speech-output', 'shared-speech', 'tts-magpie', 'harness-cortico', 'state-sqlite', 'text-client', 'companion-client'].flatMap(name => [`plugins/${name}/src`, `plugins/${name}/dist`])]) names.push(...await tree(directory));
  for (const name of ['profile', 'speech-output', 'shared-speech', 'tts-magpie', 'harness-cortico', 'state-sqlite', 'text-client', 'companion-client']) names.push(`plugins/${name}/plugin.json`, `plugins/${name}/package.json`);
  const result = {};
  for (const name of [...new Set(names)].sort()) {
    const hash = createHash('sha256'); for await (const bytes of createReadStream(path.join(root, name))) hash.update(bytes); result[name] = hash.digest('hex');
  }
  return result;
}
async function api(route, body, service = active) {
  const response = await fetch(service.url + route, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const result = await response.json(); assert.ok(response.ok, `${route} ${response.status}`); return val(result);
}
async function service(name) {
  const data = await mkdtemp(path.join(os.tmpdir(), 'speech-native-data-'));
  const home = await mkdtemp(path.join(os.tmpdir(), 'speech-native-server-home-'));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data') };
  for (const key of Object.keys(env)) if (/^COMPANION_|^DSH_|API_KEY|TOKEN/.test(key)) delete env[key];
  Object.assign(env, { COMPANION_TOKEN: token, COMPANION_DATA_DIR: data, COMPANION_PORT: '0', COMPANION_HOST: '127.0.0.1', COMPANION_MODE: 'scripted', COMPANION_NAME: name });
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'apps/companion-service/dist/main.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'exit'), started = Promise.withResolvers(); let log = '';
  child.stdout.on('data', bytes => { log = (log + bytes).slice(-4000); const match = /Companion text service: (http:\/\/127\.0\.0\.1:\d+)/.exec(log); if (match) started.resolve(match[1]); });
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-4000); });
  child.once('error', error => started.reject(error)); child.once('exit', code => started.reject(new Error(`owned service startup exit ${code}`)));
  const owned = { child, ended, data, home, url: null }; services.push(owned);
  owned.url = await within(started.promise, 'production service startup');
  report.observations.origins ??= []; report.observations.origins.push({ url: owned.url, pid: child.pid, mode: 'scripted', dataRoot: data, childHome: home, entry: 'apps/companion-service/dist/main.mjs' });
  return owned;
}
const state = async () => val(await consolePage.evaluate(() => window.petSharedSpeech.getState()));
const companion = async () => val(await consolePage.evaluate(() => window.petCompanion.getState()));
const observe = async page => {
  const observed = await page.evaluate(readSpeechObservations);
  if (observed.truncated) { report.qaLogTruncated = { droppedEvents: observed.droppedEvents }; throw new Error('QA observation log truncated; no absence/ordering pass is allowed'); }
  return observed;
};
async function shot(label, page = consolePage) { const file = path.join(evidence, `${runId}-${label}.png`); await page.screenshot({ path: file }); report.screenshots.push(path.relative(root, file)); }
async function peer(options = {}) { const value = await startControlledSpeechMagpie({ expectedUserAgent: 'dsh-pet-speech/1', expectedAuthorization: 'Bearer magpie-dsh-pet', voice: 'Mia', ...options }); peers.push(value); return value; }
async function connect(owned) {
  const old = (await companion()).connectionId;
  await consolePage.getByTestId('nav-start').click(); await consolePage.getByTestId('start-address').fill(owned.url);
  await consolePage.getByTestId('start-ask-token').click(); await consolePage.getByTestId('start-token').fill(token); await consolePage.getByTestId('start-connect').click();
  await expect.poll(async () => { const current = await companion(); return current.phase === 'live' && current.connectionId !== old && current.baseUrl === owned.url && !!current.snapshot; }, { timeout: 30000 }).toBe(true);
  active = owned;
}
async function source(enabled) {
  if (enabled) {
    const security = val(await consolePage.evaluate(() => window.petConsole.getSecurity()));
    if (!security.plugins.find(item => item.owner.pluginId === 'pet.speech-output')?.trusted) {
      await consolePage.getByTestId('nav-plugins').click(); await consolePage.getByTestId('plugins-permissions').click();
      await consolePage.getByTestId('trust-pet.speech-output').click(); await consolePage.getByTestId('trust-confirm').click();
      await expect.poll(async () => val(await consolePage.evaluate(() => window.petConsole.getSecurity())).plugins.find(item => item.owner.pluginId === 'pet.speech-output')?.trusted).toBe(true);
    }
  }
  await consolePage.getByTestId('nav-plugins').click(); const toggle = consolePage.getByTestId('plugin-toggle-pet.speech-output');
  if (await toggle.isChecked() !== enabled) { await toggle.click(); if (!enabled) await consolePage.getByTestId('plugin-action-confirm').click(); }
  await expect.poll(async () => (await state()).source, { timeout: 30000 }).toBe(enabled ? 'ready' : 'disabled');
}
async function configure(value) {
  await consolePage.getByTestId('nav-persona').click();
  // Initial/read-error form has no test id on this real button; both branches share its accessible name.
  await consolePage.locator('#shared-speech-settings').getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(consolePage.getByTestId('shared-speech-base-url')).toBeEnabled();
  await consolePage.getByTestId('shared-speech-base-url').fill(value.baseUrl);
  await consolePage.getByTestId('shared-speech-model').fill('xiaomi/mimo-v2.5-tts');
  await consolePage.getByTestId('shared-speech-auth').selectOption('local-client-id'); await consolePage.getByTestId('shared-speech-voice').selectOption('Mia');
  const beforeSave = await state(); const connectionId = (await companion()).connectionId; assert.ok(connectionId);
  const eventOffset = (await observe(consolePage)).events.length; const clickedAt = Date.now();
  await consolePage.getByTestId('shared-speech-save').click();
  let saved;
  await expect.poll(async () => {
    const view = val(await consolePage.evaluate(input => window.petSharedSpeech.readSpeech(input), { connectionId }));
    const selected = view.providers.find(item => item.providerRef === view.feature.providerRef);
    const matches = selected?.providerRef === 'pet.tts-magpie/magpie' && selected.settings.baseUrl === value.baseUrl &&
      selected.settings.modelRef === 'xiaomi/mimo-v2.5-tts' && selected.settings.voice === 'Mia' && selected.settings.authMode === 'local-client-id' &&
      typeof selected.bindingId === 'string' && selected.bindingId.length > 0;
    if (matches) saved = { providerRef: selected.providerRef, bindingId: selected.bindingId, providerConfigRevision: selected.configRevision,
      featureConfigRevision: view.feature.configRevision, baseUrl: selected.settings.baseUrl };
    return matches;
  }, { timeout: 30000 }).toBe(true);
  let ended, observedBaselines = [];
  await expect.poll(async () => {
    const current = await state();
    observedBaselines = (await observe(consolePage)).events.slice(eventOffset).filter(event => event.kind === 'speech-state' && event.state.phase === 'baselining');
    const ready = current.connectionId === connectionId && current.source === 'ready' && current.current === null &&
      ['idle', 'terminal'].includes(current.phase) && current.localCleanup === 'settled' && !current.generating && !current.playing &&
      current.appliedBinding?.providerRef === saved.providerRef && current.appliedBinding?.bindingId === saved.bindingId;
    if (ready) ended = current; return ready;
  }, { timeout: 30000 }).toBe(true);
  report.observations.configurationBaselines ??= [];
  report.observations.configurationBaselines.push({ clickedAt, confirmedAt: Date.now(), targetConnectionId: connectionId, beforeSave, saved, ended, baselinePhaseObserved: observedBaselines.length > 0,
    observedBaselines, evidence: 'actual-readSpeech-saved-selection-equals-Main-appliedBinding-on-current-connection-stable-phase; no revision-count inference' });
}
async function formal(text) {
  const before = new Set((await api('/api/snapshot')).messages.map(item => item.id));
  const speechBefore = await state(); const submittedAt = Date.now();
  await consolePage.getByTestId('nav-conversation').click(); await consolePage.getByTestId('conversation-input').fill(text); await consolePage.getByTestId('conversation-send').click();
  await expect.poll(async () => (await api('/api/snapshot')).messages.filter(item => item.role === 'assistant' && !before.has(item.id)).length, { timeout: 15000 }).toBeGreaterThan(0);
  const messages = (await api('/api/snapshot')).messages.filter(item => item.role === 'assistant' && !before.has(item.id));
  report.observations.formalSubmissions ??= [];
  report.observations.formalSubmissions.push({ submittedAt, canonicalObservedAt: Date.now(), speechBefore, inputSha256: createHash('sha256').update(text).digest('hex'),
    messages: messages.map(item => ({ id: item.id, createdAt: item.createdAt, textSha256: createHash('sha256').update(item.text).digest('hex') })) });
  return messages;
}
async function settled(outcome, messageId) {
  await expect.poll(async () => { const current = await state(); return current.localCleanup === 'settled' && current.current === null && (!outcome || current.outcome === outcome) && (!messageId || current.messageId === messageId); }, { timeout: 90000 }).toBe(true);
  const observed = await observe(pet); assert.equal(observed.activeNodes, 0); assert.ok(observed.contexts.every(item => item.closed));
  assert.equal((await observe(consolePage)).contexts.length, 0);
}
async function stop() { await consolePage.getByTestId('nav-persona').click(); await consolePage.getByTestId('shared-speech-stop').click(); await settled('cancelled'); }
async function proveRouting() {
  const inputs = await audio.ownedInputs(app.process().pid); assert.ok(inputs.length > 0, 'actual owned Pulse sink-input required');
  report.observations.ownedSinkInputs ??= []; report.observations.ownedSinkInputs.push(...inputs);
}
async function seedLong() {
  for (const [index, count] of [2048, 2048, 2048, 1400].entries()) {
    const memory = await api('/api/memory'); const key = `qa-speech-${index}`; const fact = memory.facts.find(item => item.key === key);
    await api('/api/facts', { commandId: randomUUID(), expectedMemoryRevision: memory.revision, expectedFactRevision: fact?.revision ?? 0,
      key, value: String.fromCharCode(65 + index).repeat(count) });
  }
}
function verifySegments(message, requests) {
  assert.ok(message.text.length > 4000 && message.text.length <= 8000); assert.ok(requests.length > 1 && requests.length <= 4);
  let offset = 0;
  for (const request of requests) {
    const part = message.text.slice(offset, offset + request.textUnits);
    assert.equal(createHash('sha256').update(part).digest('hex'), request.textSha256);
    assert.ok(request.textCodePoints <= 4000); offset += request.textUnits;
  }
  assert.equal(offset, message.text.length);
}
try {
  await mkdir(evidence, { recursive: true }); report.hashesBefore = await hashes();
  await writeFile(path.join(evidence, `${runId}-before.json`), JSON.stringify({ runId, hashes: report.hashesBefore }, null, 2));
  stage = 'preflight-built-profile-platform';
  const profileManifest = JSON.parse(await readFile(path.join(root, 'plugins/profile/plugin.json'), 'utf8'));
  report.observations.profileManifest = { id: profileManifest.id, platforms: profileManifest.platforms };
  assert.ok(profileManifest.platforms.includes(`${process.platform}-${process.arch}`), 'Actual generated profile manifest must support this platform before any instance starts');
  stage = 'verify-null-only-output'; audio = await startNullAudio(tooling); report.observations.nullOutput = audio.proof;
  display = await startDisplay(root); first = await service('Speech Native Synthetic QA'); active = first;
  const home = await mkdtemp(path.join(os.tmpdir(), 'speech-native-electron-home-'));
  const routing = Object.fromEntries(['PULSE_SERVER', 'PULSE_SINK', 'PULSE_CLIENTCONFIG', 'PULSE_RUNTIME_PATH', 'XDG_RUNTIME_DIR', 'ALSA_CONFIG_PATH'].map(key => [key, audio.env[key]]));
  const env = { ...display.env, ...routing, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'),
    LD_LIBRARY_PATH: [audio.env.LD_LIBRARY_PATH, display.env.LD_LIBRARY_PATH].join(':') };
  stage = 'production-Electron'; app = await _electron.launch({ executablePath: electron, env,
    args: ['--no-sandbox', '--alsa-output-device=null', path.join(root, 'apps/desktop'), `--demo-acceptance=speech-${runId}`, '--show-settings'], timeout: 30000 });
  appEnded = once(app.process(), 'exit');
  await expect.poll(() => app.windows().filter(page => page.url().startsWith('file:')).length, { timeout: 30000 }).toBe(2);
  consolePage = app.windows().find(page => page.url().endsWith('/console/index.html')); pet = app.windows().find(page => page.url().endsWith('/pet/index.html')); assert.ok(consolePage && pet);
  await consolePage.evaluate(installSpeechObservers); await pet.evaluate(installSpeechObservers);
  await connect(first);
  stage = 'default-off-legacy-true';
  // Configure the real remote host while the local optional source remains off: zero calls must not merely mean unconfigured.
  for (const id of ['pet.shared-speech', 'pet.tts-magpie']) await api(`/api/plugins/${id}`, { commandId: randomUUID(), enabled: true });
  const offPeer = await peer(); const offView = await api('/api/speech');
  const offProvider = offView.providers.find(item => item.providerRef === 'pet.tts-magpie/magpie'); assert.ok(offProvider);
  await api('/api/speech/provider', { providerRef: offProvider.providerRef, expectedRevision: offProvider.configRevision,
    settings: { baseUrl: offPeer.baseUrl, modelRef: 'xiaomi/mimo-v2.5-tts', authMode: 'local-client-id', protocol: 'mimo-native-pcm16-sse', voice: 'Mia' } });
  stage = 'actual-profile-active-and-legacy-presentation-read';
  const localSnapshot = val(await consolePage.evaluate(() => window.petConsole.getSnapshot()));
  report.observations.app = localSnapshot.app;
  const profileSource = localSnapshot.plugins.find(item => item.owner.pluginId === 'pet.profile');
  assert.ok(profileSource); assert.equal(profileSource.state, 'active', 'Real profile source must be admitted and active on this platform');
  report.observations.profileSource = profileSource;
  const presentationResult = await consolePage.evaluate(() => window.petLocalPresentation.getSnapshot());
  report.observations.legacyPresentation = presentationResult;
  assert.ok(presentationResult.ok && presentationResult.value.preferences, 'Actual profile preferences are required; never substitute guessed sound defaults');
  stage = 'legacy-presentation-true-save';
  const legacySaved = val(await consolePage.evaluate(input => window.petLocalPresentation.save(input), { expectedRevision: presentationResult.value.revision, patch: { speechEnabled: true } }));
  assert.equal(legacySaved.preferences.speechEnabled, true);
  report.observations.legacyTrueVerified = true;
  stage = 'default-off-formal-reply';
  assert.equal((await state()).source, 'disabled'); await formal(`speech-default-off-${runId}`);
  assert.equal((await observe(pet)).starts, 0); assert.equal(offPeer.snapshot.requestCount, 0);
  report.checks.push('actual-configured-provider-local-default-off-no-TTS-or-player');
  await source(true);
  await expect.poll(async () => { const local = await state(); return local.connectionId === (await companion()).connectionId && local.phase !== 'baselining' && local.current === null; }).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(offPeer.snapshot.requestCount, 0);
  const firstPeer = await peer({ holdTerminal: true, frames: 24000, fragments: [257, 1021] }); await configure(firstPeer);
  stage = 'auto-first-audio-before-terminal';
  const messages = await formal(`speech-future-${runId}`); assert.equal(messages.length, 1);
  await within(firstPeer.firstAudioWritten, 'first PCM');
  await expect.poll(async () => (await observe(pet)).starts, { timeout: 10000 }).toBeGreaterThan(0);
  await proveRouting(); assert.equal(firstPeer.snapshot.requests[0].terminalWritten, null);
  firstPeer.releaseTerminal(); await settled('completed'); assert.equal(firstPeer.snapshot.requestCount, 1);
  assert.equal((await state()).messageId, messages[0].id); await shot('first-completed');
  report.checks.push('actual-formal-auto-once-Pet-only-first-PCM-before-native-terminal-and-null-sink-input');
  stage = 'reconnect-no-history'; const count = firstPeer.snapshot.requestCount; await connect(first);
  await expect.poll(async () => { const local = await state(); return local.connectionId === (await companion()).connectionId && local.phase !== 'baselining' && local.current === null; }, { timeout: 15000 }).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(firstPeer.snapshot.requestCount, count); report.observations.historyReplayObservationMs = 500;
  report.checks.push('actual-reconnect-baseline-no-historical-request-with-bounded-observation-window');

  stage = 'long-audio-bounded-Pet-window'; console.log(JSON.stringify({ kind: 'qa-progress', stage, expectedPcmBytes: 2200006, expectedAudioSeconds: 1100003 / 24000 }));
  const longPeer = await peer({ frames: 1100003, pcmChunkBytes: 131073, fragments: [65536] }); await configure(longPeer);
  await formal(`speech-long-audio-${runId}`); await expect.poll(() => longPeer.snapshot.requestCount).toBe(1);
  await expect.poll(async () => (await state()).receivedFrames, { timeout: 10000 }).toBeGreaterThan(0); await proveRouting();
  await settled('completed'); const longObserved = await observe(pet);
  assert.ok(longObserved.peakNodes <= 6); assert.equal(longPeer.snapshot.requests[0].pcmBytesWritten, 2200006);
  for (const value of Object.values(longObserved.playbacks)) { assert.ok(value.maxChunkBytes <= 65536); assert.equal(value.sequenceErrors, 0); assert.equal(value.priorChunkNotScheduled, 0); }
  report.observations.longAudio = { peer: longPeer.snapshot, peakNodes: longObserved.peakNodes };
  report.checks.push('actual-over-2MiB-cumulative-PCM-bounded-six-nodes-and-64KiB-chunks');
  console.log(JSON.stringify({ kind: 'qa-progress', stage: 'long-audio-completed', peakNodes: longObserved.peakNodes, pcmBytes: longPeer.snapshot.requests[0].pcmBytesWritten }));

  stage = 'canonical-long-text-complete-segments'; await seedLong();
  const textPeer = await peer({ frames: 2400 }); await configure(textPeer);
  const oldPlaybacks = new Set(Object.keys((await observe(pet)).playbacks)); const longMessages = await formal('偏好');
  await expect.poll(() => textPeer.snapshot.requestCount).toBeGreaterThan(0);
  await settled('completed', longMessages[0].id); verifySegments(longMessages[0], textPeer.snapshot.requests);
  const newPlaybacks = Object.entries((await observe(pet)).playbacks).filter(([key]) => !oldPlaybacks.has(key)).map(([, value]) => value);
  const logicals = new Set(newPlaybacks.map(value => value.identity.utteranceId));
  assert.equal(logicals.size, 1); assert.equal(newPlaybacks.length, textPeer.snapshot.requestCount);
  const longStates = (await observe(consolePage)).events.filter(event => event.kind === 'speech-state' && event.state.messageId === longMessages[0].id);
  assert.ok(longStates.length > 0); assert.ok(longStates.every(event => event.state.queued === 0), 'segments must not occupy extra logical FIFO slots');
  report.observations.longText = { canonicalUnits: longMessages[0].text.length, textSha256: createHash('sha256').update(longMessages[0].text).digest('hex'), requests: textPeer.snapshot.requests,
    note: 'One logical identity is checked by message/utterance identities in audio events; terminal current is cleared.' };
  assert.ok(logicals.size <= 1); report.checks.push('actual-scripted-Harness-say-long-canonical-segment-SHA-contiguous-full-coverage');

  stage = 'whole-stop-segment-two'; const stopPeer = await peer({ holdTerminal: true, frames: 2400 }); await configure(stopPeer);
  await formal('偏好'); await expect.poll(() => stopPeer.snapshot.requestCount).toBe(1); stopPeer.releaseTerminal(1);
  await expect.poll(() => stopPeer.snapshot.requestCount, { timeout: 15000 }).toBe(2); assert.ok((await state()).segmentCount >= 3);
  const oldWhole = (await state()).current?.utteranceId; await stop(); stopPeer.releaseTerminal();
  assert.equal(stopPeer.snapshot.requestCount, 2); assert.equal((await state()).source, 'ready');
  await formal(`speech-after-stop-${runId}`); await expect.poll(() => stopPeer.snapshot.requestCount).toBe(3);
  assert.notEqual((await state()).current?.utteranceId, oldWhole); stopPeer.releaseTerminal(3); await settled('completed');
  report.checks.push('actual-whole-stop-segment-two-zero-third-old-call-future-new-reply-still-auto');

  stage = 'partial-failure-next-new-reply'; const failurePeer = await peer({ responseModes: ['length', 'stop'], frames: 2400 }); await configure(failurePeer);
  const failedMessages = await formal(`speech-partial-${runId}`); await settled('failed', failedMessages[0].id); assert.equal((await state()).outcome, 'failed');
  const recoveredMessages = await formal(`speech-after-failure-${runId}`); await settled('completed', recoveredMessages[0].id); assert.equal(failurePeer.snapshot.requestCount, 2);
  report.checks.push('actual-partial-terminal-never-completed-next-new-reply-admitted-same-binding');

  stage = 'disable-drain-no-future'; const disabledPeer = await peer({ holdTerminal: true }); await configure(disabledPeer);
  await formal(`speech-disable-${runId}`); await within(disabledPeer.firstAudioWritten, 'disable prefix'); await source(false); await settled();
  const disabledCount = disabledPeer.snapshot.requestCount; await formal(`speech-disabled-future-${runId}`);
  assert.equal(disabledPeer.snapshot.requestCount, disabledCount); report.checks.push('actual-source-disable-drains-and-fences-future-formal-replies');
  await source(true);
  stage = 'retarget-local-release-old-audio-fenced'; const oldPeer = await peer({ holdTerminal: true }); await configure(oldPeer);
  await formal(`speech-retarget-${runId}`); await within(oldPeer.firstAudioWritten, 'old target prefix');
  const oldPlayback = (await state()).current?.playbackId; assert.ok(oldPlayback);
  const second = await service('Speech Target B');
  await connect(second); await settled(); oldPeer.releaseTerminal();
  const retargetObserved = await observe(pet);
  const stopAt = retargetObserved.events.findLastIndex(event => event.kind === 'audio-event' && event.eventKind === 'stop' && event.playbackId === oldPlayback);
  assert.ok(stopAt >= 0); assert.ok(!retargetObserved.events.slice(stopAt + 1).some(event => event.kind === 'node-start' && event.playbackId === oldPlayback));
  assert.equal(oldPeer.snapshot.requestCount, 1);
  assert.equal((await api('/api/snapshot')).messages.length, 0); report.checks.push('actual-retarget-local-release-no-old-audio-or-message-on-new-Agent');
  stage = 'source-trust-withdrawal';
  for (const id of ['pet.shared-speech', 'pet.tts-magpie']) await api(`/api/plugins/${id}`, { commandId: randomUUID(), enabled: true });
  const revokedPeer = await peer({ holdTerminal: true }); await configure(revokedPeer);
  await formal(`speech-revoke-${runId}`); await within(revokedPeer.firstAudioWritten, 'withdrawal prefix');
  await consolePage.getByTestId('nav-plugins').click(); await consolePage.getByTestId('plugins-permissions').click();
  await consolePage.getByTestId('trust-pet.speech-output').click(); await consolePage.getByTestId('trust-confirm').click();
  await settled(); assert.equal((await state()).source, 'disabled'); revokedPeer.releaseTerminal();
  const revokedCount = revokedPeer.snapshot.requestCount; await formal(`speech-revoked-future-${runId}`); assert.equal(revokedPeer.snapshot.requestCount, revokedCount);
  report.checks.push('actual-source-trust-withdrawal-real-release-no-late-or-future-synthesis');
  report.observations.pet = await observe(pet); report.observations.console = await observe(consolePage);
  assert.equal(report.observations.pet.activeNodes, 0); assert.equal(report.observations.pet.errors.length, 0);
  for (const value of Object.values(report.observations.pet.playbacks)) {
    assert.ok(value.maxChunkBytes <= 65536);
    if (value.terminal && !value.stopped) { assert.equal(value.endedFrames, value.terminal.producedFrames); assert.equal(value.receivedFrames, value.terminal.producedFrames); }
  }
  report.observations.finalNull = await audio.verify(); await shot('final-Pet', pet);
  report.status = 'passed'; exit = 0;
} catch (error) {
  report.status = 'failed'; report.failure = { stage, detail: error.message.replaceAll(token, '[redacted]').slice(0, 1600), frames: error.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4) };
  if (consolePage && !consolePage.isClosed()) {
    try { report.observations.failureState = await state(); report.observations.failurePresentation = await consolePage.evaluate(() => window.petLocalPresentation.getSnapshot()); report.observations.failureSources = await consolePage.evaluate(() => window.petConsole.getSnapshot()); report.observations.failureConsole = await consolePage.evaluate(readSpeechObservations); if (pet && !pet.isClosed()) report.observations.failurePet = await pet.evaluate(readSpeechObservations); const speechCard = consolePage.locator('#shared-speech-settings'); if (await speechCard.count()) { const cardText = await speechCard.innerText({ timeout: 2000 }); report.observations.failureSpeechCard = { fieldErrorCandidates: await speechCard.locator('.field__error').allTextContents(), text: cardText.slice(0, 4000), truncated: cardText.length > 4000 }; await speechCard.screenshot({ path: path.join(evidence, `${runId}-failure-speech-card.png`) }); report.screenshots.push(`qa/fixtures/companion-speech-output/evidence/${runId}-failure-speech-card.png`); } await shot('failure'); } catch (diagnostic) { report.observationFailure = diagnostic.name; }
  }
}
finally {
  if (consolePage && !consolePage.isClosed()) {
    try { const current = await state(); if (current.connectionId) await consolePage.evaluate(input => window.petSharedSpeech.stop(input), { connectionId: current.connectionId }); await settled(); } catch (error) { report.cleanup.capture = error.message.slice(0, 200); exit = 1; }
  }
  if (app) {
    try { await within(app.close(), 'Electron close'); const [code, signal] = await within(appEnded, 'Electron exit'); report.cleanup.electron = { code, signal }; if (code !== 0) exit = 1; }
    catch (error) { app.process().kill('SIGKILL'); if (appEnded) await within(appEnded, 'forced Electron exit'); report.cleanup.electron = { failure: error.message, forced: true }; exit = 1; }
  }
  report.cleanup.services = [];
  for (const owned of services) { owned.child.kill('SIGTERM'); try { const [code, signal] = await within(owned.ended, 'service close'); report.cleanup.services.push({ code, signal }); if (code !== 0) exit = 1; } catch (error) { owned.child.kill('SIGKILL'); await owned.ended; report.cleanup.services.push({ error: error.message }); exit = 1; } }
  report.cleanup.peers = [];
  for (const value of peers) { try { report.cleanup.peers.push(await value.close()); } catch (error) { report.cleanup.peers.push({ error: error.message }); exit = 1; } }
  if (display) { try { await display.stop(); report.cleanup.display = 'closed'; } catch (error) { report.cleanup.display = error.message; exit = 1; } }
  if (audio) { try { report.cleanup.audio = await audio.close(); } catch (error) { report.cleanup.audio = error.message; exit = 1; } }
  try { report.hashesAfter = await hashes(); assert.deepEqual(report.hashesAfter, report.hashesBefore); report.hashesUnchanged = true; } catch (error) { report.hashesUnchanged = false; report.hashFailure = error.message.slice(0, 200); exit = 1; }
  report.actualExit = exit; const filename = path.join(evidence, `${runId}-native.json`); await writeFile(filename, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ runId, report: path.relative(root, filename), status: report.status, actualExit: exit, checks: report.checks, failure: report.failure, cleanup: report.cleanup }, null, 2)); process.exitCode = exit;
}
