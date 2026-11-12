// S5 Web preparation: run only by Parent after frozen-product authorization. No desktop/player.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startNullAudio } from '../fixtures/companion-speech-output/software-audio.mjs';
import { startControlledSpeechMagpie } from '../fixtures/companion-speech-output/controlled-magpie.mjs';
import { startControlledMagpie } from '../fixtures/companion-voice-input/controlled-magpie.mjs';
import { installCaptureObservers, readCaptureObservations } from '../fixtures/companion-voice-input/evidence/native-observers.mjs';

assert.deepEqual(process.argv.slice(2), ['--run-frozen']);
const root = fileURLToPath(new URL('../..', import.meta.url));
const tools = process.env.PET_SPEECH_PULSE_TOOLS; assert.ok(tools, 'Private null-only Pulse tools required');
const chrome = process.env.PET_SPEECH_BROWSER_EXE ?? path.join(root, '.companion-data/tooling/browser/chromium-full-156-mirror-q6zv9a9g/chrome-linux64/chrome');
assert.ok(path.resolve(chrome).startsWith(path.join(root, '.companion-data/tooling/browser') + path.sep));
const wav = path.join(root, 'qa/fixtures/companion-voice-input/synthetic-tone-16k.wav');
const id = randomUUID().slice(0, 8), token = randomUUID() + randomUUID();
const evidence = path.join(root, 'qa/fixtures/companion-speech-output/evidence');
const report = { id, status: 'running', scope: 'production-standalone-Web-ready-TTS-zero-initiation-text-ASR-review-send',
  checks: [], screenshots: [], observations: {}, cleanup: {},
  limits: ['Synthetic fake input device and owned controlled ASR/TTS peers; no external model or physical speaker.',
    'Exact-origin microphone grant is a declared user-authorized precondition; manual browser permission UI is not tested.',
    'An actual ASR AudioContext/worklet is expected and is not a TTS player. AudioBufferSource and HTML media playback are counted separately.',
    'No desktop/Pet/native or extra reasoning/notice/multisay acceptance is performed by this probe.'] };
let stage = 'preflight', exit = 1, audio, display, service, browser, context, page, asrPeer, ttsPeer, browserPid;
async function within(work, label, ms = 30000) {
  let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms); })]); }
  finally { clearTimeout(timer); }
}
const val = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
async function closedLoopbackEndpoint(baseUrl) {
  const url = new URL(baseUrl); assert.equal(url.hostname, '127.0.0.1');
  await new Promise((resolve, reject) => {
    let refused = false, failure;
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    socket.once('error', error => { if (error.code === 'ECONNREFUSED') refused = true; else failure = error; });
    socket.once('connect', () => { failure = new Error('Closed owned peer still accepts connections'); socket.destroy(); });
    socket.setTimeout(1000, () => { failure = new Error('Owned peer closure unconfirmed'); socket.destroy(); });
    socket.once('close', () => refused && !failure ? resolve() : reject(failure ?? new Error('Connection refusal was not observed')));
  });
}
async function tree(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await tree(file)); else if (entry.isFile()) result.push(file);
  }
  return result;
}
async function hashes() {
  const files = ['qa/probes/companion-speech-output-web.mjs', 'qa/fixtures/companion-desktop/display.mjs',
    'qa/fixtures/companion-speech-output/software-audio.mjs', 'qa/fixtures/companion-speech-output/null-only-alsa.conf',
    'qa/fixtures/companion-speech-output/controlled-magpie.mjs', 'qa/fixtures/companion-speech-output/synthetic-pcm.mjs',
    'qa/fixtures/companion-voice-input/controlled-magpie.mjs', 'qa/fixtures/companion-voice-input/evidence/native-observers.mjs',
    'qa/fixtures/companion-voice-input/synthetic-tone-16k.wav', path.relative(root, chrome),
    path.relative(root, path.join(tools, 'provenance.json')), path.relative(root, path.join(tools, 'root/usr/bin/pulseaudio')),
    path.relative(root, path.join(tools, 'root/usr/bin/pactl')), 'pnpm-lock.yaml'];
  for (const directory of ['apps/companion-service/src', 'apps/companion-service/dist', 'packages/contracts/src',
    'packages/companion-runtime/src', 'packages/host-kernel/src', path.relative(root, path.join(tools, 'root/usr/lib')),
    ...['text-client', 'shared-speech', 'tts-magpie', 'shared-voice', 'asr-magpie', 'audio-capture', 'harness-cortico', 'state-sqlite'].flatMap(name => [`plugins/${name}/src`, `plugins/${name}/dist`])]) files.push(...await tree(directory));
  for (const name of ['text-client', 'shared-speech', 'tts-magpie', 'shared-voice', 'asr-magpie', 'audio-capture', 'harness-cortico', 'state-sqlite']) files.push(`plugins/${name}/plugin.json`, `plugins/${name}/package.json`);
  const result = {};
  for (const file of [...new Set(files)].sort()) { const hash = createHash('sha256'); for await (const bytes of createReadStream(path.join(root, file))) hash.update(bytes); result[file] = hash.digest('hex'); }
  return result;
}
function isolate(base, home) { return { ...base, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data') }; }
async function startService() {
  const data = await mkdtemp(path.join(os.tmpdir(), 'speech-web-data-')), home = await mkdtemp(path.join(os.tmpdir(), 'speech-web-service-home-'));
  const env = isolate(process.env, home);
  for (const name of Object.keys(env)) if (/^COMPANION_|^DSH_|API_KEY|TOKEN/.test(name)) delete env[name];
  Object.assign(env, { COMPANION_TOKEN: token, COMPANION_DATA_DIR: data, COMPANION_PORT: '0', COMPANION_HOST: '127.0.0.1', COMPANION_MODE: 'scripted', COMPANION_NAME: 'S5 Web Synthetic QA' });
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'apps/companion-service/dist/main.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'exit'), ready = Promise.withResolvers(); let log = '';
  child.stdout.on('data', bytes => { log = (log + bytes).slice(-4000); const match = /Companion text service: (http:\/\/127\.0\.0\.1:\d+)/.exec(log); if (match) ready.resolve(match[1]); });
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-4000); });
  child.once('error', error => ready.reject(error)); child.once('exit', code => ready.reject(new Error(`owned service startup exit ${code}`)));
  service = { child, ended, url: null }; service.url = await within(ready.promise, 'production service startup');
  report.observations.service = { url: service.url, pid: child.pid, dataRoot: data, childHome: home, mode: 'scripted', entry: 'apps/companion-service/dist/main.mjs' };
}
async function api(route, body) {
  const response = await fetch(service.url + route, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${route} ${response.status}`); return val(await response.json());
}
const users = snapshot => snapshot.messages.filter(item => item.role === 'user');
async function assertNewUser(before, expectedText) {
  await expect.poll(async () => users(await api('/api/snapshot')).length - before.length, { timeout: 15000 }).toBe(1);
  const after = users(await api('/api/snapshot')); const known = new Set(before.map(item => item.id));
  const added = after.filter(item => !known.has(item.id)); assert.equal(added.length, 1); assert.equal(added[0].text, expectedText);
  return { id: added[0].id, inputId: added[0].inputId, text: added[0].text };
}
function installNoSpeechPlayerObserver() {
  const qa = window.__speechWebQA = { bufferSourcesCreated: 0, bufferSourceStartAttempts: 0, bufferSourceStarts: 0, htmlMediaPlayCalls: 0 };
  // Native base prototypes keep this independent of the M4 AudioContext observer's installation order.
  const create = window.BaseAudioContext.prototype.createBufferSource;
  window.BaseAudioContext.prototype.createBufferSource = function (...args) { const node = create.apply(this, args); qa.bufferSourcesCreated++; return node; };
  const start = window.AudioBufferSourceNode.prototype.start;
  window.AudioBufferSourceNode.prototype.start = function (...args) { qa.bufferSourceStartAttempts++; const result = start.apply(this, args); qa.bufferSourceStarts++; return result; };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) { qa.htmlMediaPlayCalls++; return play.apply(this, args); };
}
async function noTts() {
  const observed = await page.evaluate(() => window.__speechWebQA);
  assert.equal(observed.bufferSourcesCreated, 0); assert.equal(observed.bufferSourceStartAttempts, 0);
  assert.equal(observed.bufferSourceStarts, 0); assert.equal(observed.htmlMediaPlayCalls, 0);
  assert.equal(report.observations.pageSpeechRequestCount, 0); assert.equal(report.observations.externalRequestCount, 0);
  assert.equal(ttsPeer.snapshot.requestCount, 0); assert.equal(ttsPeer.snapshot.catalogCount, 0); assert.equal(ttsPeer.snapshot.rejectedCount, 0);
  return observed;
}
async function shot(label) { const filename = path.join(evidence, `${id}-web-${label}.png`); await page.screenshot({ path: filename }); report.screenshots.push(path.relative(root, filename)); }
try {
  await mkdir(evidence, { recursive: true }); report.hashesBefore = await hashes();
  await writeFile(path.join(evidence, `${id}-web-before.json`), JSON.stringify({ id, hashes: report.hashesBefore }, null, 2));
  stage = 'verified-private-null-output'; audio = await startNullAudio(tools); report.observations.nullOutput = audio.proof;
  display = await startDisplay(root); await startService();
  ttsPeer = await startControlledSpeechMagpie({ expectedUserAgent: 'dsh-pet-speech/1', expectedAuthorization: 'Bearer magpie-dsh-pet', voice: 'Mia' });
  asrPeer = await startControlledMagpie({ expectedAuthorization: 'Bearer magpie-dsh-pet' });
  stage = 'configure-ready-TTS-without-desktop';
  const speech = await api('/api/speech'); const tts = speech.providers.find(item => item.providerRef === speech.feature.providerRef); assert.ok(tts);
  const configuredSpeech = await api('/api/speech/provider', { providerRef: tts.providerRef, expectedRevision: tts.configRevision,
    settings: { baseUrl: ttsPeer.baseUrl, modelRef: 'xiaomi/mimo-v2.5-tts', authMode: 'local-client-id', protocol: 'mimo-native-pcm16-sse', voice: 'Mia' } });
  const readyTts = configuredSpeech.providers.find(item => item.providerRef === configuredSpeech.feature.providerRef);
  assert.equal(configuredSpeech.feature.source, 'ready'); assert.ok(readyTts?.bindingId); assert.equal(readyTts.source, 'ready'); assert.equal(readyTts.readiness, 'configured');
  report.observations.configuredTts = { feature: configuredSpeech.feature, providerRef: readyTts.providerRef, bindingId: readyTts.bindingId, settings: readyTts.settings, readiness: readyTts.readiness };
  const voice = await api('/api/voice'); const asr = voice.providers.find(item => item.providerRef === voice.feature.providerRef); assert.ok(asr);
  const configuredVoice = await api('/api/voice/provider', { providerRef: asr.providerRef, expectedRevision: asr.configRevision,
    settings: { baseUrl: asrPeer.baseUrl, modelRef: 'xiaomi/mimo-v2.5-asr', authMode: 'local-client-id', protocol: 'mimo-native' } });
  await api('/api/voice/settings', { expectedRevision: configuredVoice.feature.configRevision, providerRef: configuredVoice.feature.providerRef, finishMode: 'review' });
  const initial = await api('/api/snapshot'); report.observations.agentId = initial.agent.id;
  stage = 'actual-production-Web-and-explicit-origin-grant';
  const home = await mkdtemp(path.join(os.tmpdir(), 'speech-web-browser-home-'));
  const routing = Object.fromEntries(['PULSE_SERVER', 'PULSE_SINK', 'PULSE_CLIENTCONFIG', 'PULSE_RUNTIME_PATH', 'XDG_RUNTIME_DIR', 'ALSA_CONFIG_PATH'].map(key => [key, audio.env[key]]));
  const env = isolate({ ...display.env, ...routing, LD_LIBRARY_PATH: [audio.env.LD_LIBRARY_PATH, display.env.LD_LIBRARY_PATH].join(':') }, home);
  browser = await chromium.launch({ executablePath: chrome, env, chromiumSandbox: false, ignoreDefaultArgs: ['--mute-audio'], args: ['--no-sandbox', '--disable-dev-shm-usage', '--alsa-output-device=null',
    '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  const cdp = await browser.newBrowserCDPSession();
  const processInfo = await cdp.send('SystemInfo.getProcessInfo'); browserPid = processInfo.processInfo.find(item => item.type === 'browser')?.id;
  assert.ok(Number.isSafeInteger(browserPid) && browserPid > 0); await cdp.detach();
  report.observations.browser = { version: browser.version(), executable: path.relative(root, chrome), pid: browserPid, childHome: home,
    ignoredDefaultArgs: ['--mute-audio'], output: 'explicit private Pulse/null-only ALSA, not a global mute substitute',
    microphonePermission: 'explicit exact-origin grant; not a manual permission prompt test' };
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(['microphone'], { origin: service.url });
  report.observations.pageSpeechRequests = []; report.observations.externalRequestAttempts = [];
  report.observations.pageSpeechRequestCount = 0; report.observations.externalRequestCount = 0;
  context.on('request', request => {
    const target = new URL(request.url());
    if (/^\/api\/speech(?:\/|$)/.test(target.pathname)) { report.observations.pageSpeechRequestCount++; if (report.observations.pageSpeechRequests.length < 16) report.observations.pageSpeechRequests.push({ method: request.method(), path: target.pathname, resourceType: request.resourceType() }); }
  });
  await context.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (target.origin !== service.url) { report.observations.externalRequestCount++; if (report.observations.externalRequestAttempts.length < 16) report.observations.externalRequestAttempts.push({ origin: target.origin, path: target.pathname }); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  page = await context.newPage(); await page.addInitScript(installCaptureObservers); await page.addInitScript(installNoSpeechPlayerObserver);
  await page.goto(service.url, { waitUntil: 'domcontentloaded' }); assert.equal(await page.evaluate(() => window.isSecureContext), true);
  await page.locator('#tc-token').fill(token); await page.locator('#tc-token').press('Enter'); await page.locator('.tc-chat').waitFor();
  assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state), 'granted');
  stage = 'ordinary-Web-text-same-Agent-zero-TTS';
  const text = `S5文字回归-${id}`, beforeText = users(await api('/api/snapshot'));
  await page.locator('#tc-input').fill(text); await page.locator('.tc-send').click();
  report.observations.typedMessage = await assertNewUser(beforeText, text);
  await expect.poll(async () => (await api('/api/snapshot')).messages.filter(item => item.role === 'assistant').length).toBeGreaterThan(0);
  await expect(page.locator('.tc-msg--assistant').filter({ hasText: text })).toHaveCount(1);
  report.observations.textReplyVisibleAt = Date.now();
  assert.equal((await api('/api/snapshot')).agent.id, initial.agent.id); await noTts();
  report.checks.push('actual-ready-TTS-provider-standalone-Web-text-roundtrip-same-Agent-zero-speech-fetch-or-player');
  await shot('typed-zero-TTS');
  stage = 'actual-synthetic-ASR-review-no-auto-send';
  const draft = `S5未发送草稿-${id}`; await page.locator('#tc-input').fill(draft);
  const beforeReview = users(await api('/api/snapshot'));
  await expect(page.getByTestId('voice-hint')).toContainText('结束后先预览');
  await page.getByTestId('voice-start').click(); await expect(page.getByTestId('voice-state')).toHaveText('正在录音', { timeout: 15000 });
  await expect.poll(async () => (await page.evaluate(readCaptureObservations)).frames.length, { timeout: 15000 }).toBeGreaterThan(3);
  const ownedInputs = await audio.ownedInputs(browserPid); assert.ok(ownedInputs.length > 0); report.observations.ownedAsrNullInputs = ownedInputs;
  await page.getByTestId('voice-finish').click(); const asrAudio = await within(asrPeer.firstAudio, 'controlled ASR request');
  await expect(page.getByTestId('voice-preview')).toHaveValue('受控测试转录', { timeout: 15000 });
  assert.equal(users(await api('/api/snapshot')).length, beforeReview.length); await expect(page.locator('#tc-input')).toHaveValue(draft);
  const capture = await page.evaluate(readCaptureObservations); report.observations.capture = capture; report.observations.asrAudio = asrAudio;
  assert.ok(capture.tracks.length > 0 && capture.tracks.every(value => value === 'ended'));
  assert.ok(capture.contexts.length > 0 && capture.contexts.every(value => value === 'closed'));
  assert.ok(capture.events.some(event => event.kind === 'context-created' && event.rate === 16000));
  assert.ok(capture.events.some(event => event.kind === 'worklet-module-loaded'));
  assert.equal(capture.frames.reduce((sum, count) => sum + count, 0), asrAudio.samples);
  await noTts(); report.checks.push('actual-Web-ASR-getUserMedia-worklet-controlled-provider-review-releases-device-zero-message-or-TTS');
  await shot('ASR-review-zero-TTS');
  stage = 'explicit-ASR-preview-send-same-Agent'; const reviewed = `受控语音输入，确认发送-${id}`;
  await page.getByTestId('voice-preview').fill(reviewed); assert.equal(users(await api('/api/snapshot')).length, beforeReview.length);
  await page.getByTestId('voice-send').click(); report.observations.reviewMessage = await assertNewUser(beforeReview, reviewed);
  await expect(page.locator('#tc-input')).toHaveValue(draft); assert.equal((await api('/api/snapshot')).agent.id, initial.agent.id);
  await expect(page.locator('.tc-msg--assistant').filter({ hasText: reviewed })).toHaveCount(1);
  report.observations.reviewReplyVisibleAt = Date.now();
  assert.equal(asrPeer.snapshot.audioCount, 1); report.observations.noTtsPlayer = await noTts();
  const finalSpeech = await api('/api/speech'); const finalTts = finalSpeech.providers.find(item => item.providerRef === readyTts.providerRef);
  assert.equal(finalTts?.bindingId, readyTts.bindingId); assert.equal(finalTts?.readiness, 'configured');
  report.checks.push('actual-Web-ASR-explicit-review-send-once-same-Agent-TTS-still-ready-zero-page-speech-or-playback');
  report.observations.asrPeer = asrPeer.snapshot; report.observations.ttsPeer = ttsPeer.snapshot;
  await shot('review-sent-zero-TTS'); report.observations.finalPlayerCheck = await noTts(); report.observations.finalPlayerCheckAt = Date.now(); report.status = 'passed'; exit = 0;
} catch (error) {
  report.status = 'failed'; report.failure = { stage, detail: error.message.replaceAll(token, '[redacted]').slice(0, 1400) };
  if (page && !page.isClosed()) {
    try { report.observations.failureCapture = await page.evaluate(readCaptureObservations); report.observations.failurePlayer = await page.evaluate(() => window.__speechWebQA); await shot('failure'); } catch (diagnostic) { report.observationFailure = diagnostic.name; }
  }
} finally {
  if (page && !page.isClosed()) {
    try { const cancel = page.getByTestId('voice-cancel'); if (await cancel.count()) await cancel.click(); } catch { report.cleanup.cancel = 'unconfirmed'; exit = 1; }
  }
  if (browser) {
    try { await within(browser.close(), 'owned browser close'); report.cleanup.browser = 'closed'; }
    catch { try { if (browserPid) process.kill(browserPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') report.cleanup.browserKill = error.code ?? error.name; } report.cleanup.browser = 'forced-unconfirmed'; exit = 1; }
  }
  if (audio) {
    try { await expect.poll(async () => (await audio.query('sink-inputs')).length, { timeout: 5000 }).toBe(0); report.cleanup.sinkInputsAfterBrowser = 0; }
    catch { report.cleanup.sinkInputsAfterBrowser = 'unconfirmed'; exit = 1; }
  }
  if (service) {
    service.child.kill('SIGTERM');
    try { const [code, signal] = await within(service.ended, 'owned service close'); report.cleanup.service = { code, signal }; if (code !== 0) exit = 1; }
    catch { service.child.kill('SIGKILL'); await service.ended; report.cleanup.service = 'forced-unconfirmed'; exit = 1; }
  }
  for (const [name, peer] of [['asr', asrPeer], ['tts', ttsPeer]]) if (peer) {
    try {
      await peer.close();
      const snapshot = peer.snapshot;
      if (name === 'tts') {
        assert.equal(snapshot.listening, false);
        assert.equal(snapshot.openSockets, 0);
        assert.equal(snapshot.pendingHandlers, 0);
      }
      // The M4 ASR fixture exposes no listener/handler counters; verify its actual close and endpoint.
      await closedLoopbackEndpoint(peer.baseUrl);
      report.cleanup[name] = { closed: true, connectionRejected: true, snapshot };
    } catch (error) { report.cleanup[name] = { closed: false, error: error.name }; exit = 1; }
  }
  if (ttsPeer && (ttsPeer.snapshot.requestCount !== 0 || ttsPeer.snapshot.catalogCount !== 0 || ttsPeer.snapshot.rejectedCount !== 0)) { report.cleanup.unexpectedTtsActivity = true; exit = 1; }
  if (report.observations.pageSpeechRequestCount || report.observations.externalRequestCount) { report.cleanup.unexpectedPageRequest = true; exit = 1; }
  if (display) { try { await display.stop(); report.cleanup.display = 'closed'; } catch { report.cleanup.display = 'unconfirmed'; exit = 1; } }
  if (audio) { try { report.cleanup.audio = await audio.close(); } catch { report.cleanup.audio = 'unconfirmed'; exit = 1; } }
  try { report.hashesAfter = await hashes(); assert.deepEqual(report.hashesAfter, report.hashesBefore); report.hashesUnchanged = true; }
  catch (error) { report.hashesUnchanged = false; report.hashFailure = error.message.slice(0, 200); exit = 1; }
  if (exit !== 0 && report.status === 'passed') report.status = 'failed-cleanup-or-freeze';
  report.actualExit = exit; const filename = path.join(evidence, `${id}-web.json`); await writeFile(filename, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ id, status: report.status, actualExit: exit, report: path.relative(root, filename), checks: report.checks, failure: report.failure, cleanup: report.cleanup, screenshots: report.screenshots }, null, 2));
  process.exitCode = exit;
}
