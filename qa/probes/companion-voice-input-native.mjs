// Production synthetic-device acceptance. Parent freezes/builds/authorizes before --run-frozen.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startControlledMagpie } from '../fixtures/companion-voice-input/controlled-magpie.mjs';
import { installCaptureObservers, readCaptureObservations } from '../fixtures/companion-voice-input/evidence/native-observers.mjs';
import { runTargetedNative } from '../fixtures/companion-voice-input/evidence/targeted-cases.mjs';

const webOnly = process.argv.includes('--web-only');
const targetedOnly = process.argv.includes('--targeted-only');
assert.ok(!(webOnly && targetedOnly));
assert.deepEqual(process.argv.slice(2), targetedOnly ? ['--run-frozen', '--targeted-only'] : webOnly ? ['--run-frozen', '--web-only'] : ['--run-frozen']);
const root = fileURLToPath(new URL('../..', import.meta.url));
const evidence = path.join(root, 'qa/fixtures/companion-voice-input/evidence');
const id = randomUUID().slice(0, 8);
const reportPath = path.join(evidence, `${id}-native.json`);
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const browserExe = process.env.PET_VOICE_BROWSER_EXE ?? path.join(root, '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell');
assert.ok(path.resolve(browserExe).startsWith(path.join(root, '.companion-data/tooling/browser') + path.sep), 'Use only a parent-prepared private browser executable');
const wav = path.join(root, 'qa/fixtures/companion-voice-input/synthetic-tone-16k.wav');
const report = { id, status: 'running', scope: 'production-linux-electron-and-web-synthetic-voice', checks: [], observations: {}, screenshots: [], cleanup: {}, limits: ['Synthetic tone and controlled loopback ASR only; no physical microphone/real Magpie/recognition-quality evidence.', 'No automatic media-consent flag, Electron permission override, fake bridge, fake hook or product modification. Standalone Web uses parent-authorized origin-scoped pre-granted context.'] };
let stage = 'preflight', exit = 1, display, app, browser, desktop, web, service;
const peers = [], services = [];
const token = randomUUID() + randomUUID();
async function tree(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await tree(name));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}
async function hashes() {
  const dirs = ['apps/companion-service/dist', 'apps/companion-service/src', 'apps/desktop/dist',
    'packages/companion-runtime/src', 'packages/host-kernel/src', 'packages/contracts/src', 'packages/plugin-sdk/src',
    ...['asr-magpie', 'shared-voice', 'audio-capture', 'text-client', 'state-sqlite', 'harness-cortico', 'cloud-exec', 'model-connection-magpie', 'companion-client'].flatMap(name => [`plugins/${name}/src`, `plugins/${name}/dist`])];
  const files = ['qa/probes/companion-voice-input-native.mjs', 'qa/fixtures/companion-voice-input/evidence/native-observers.mjs', 'qa/fixtures/companion-voice-input/evidence/targeted-cases.mjs',
    'qa/fixtures/companion-desktop/display.mjs', 'qa/fixtures/companion-voice-input/controlled-magpie.mjs',
    'qa/fixtures/companion-voice-input/synthetic-tone-16k.wav', 'apps/desktop/src/main/builtin-admission.json',
    '.companion-data/tooling/desktop/electron-45/electron', path.relative(root, browserExe)];
  for (const directory of dirs) files.push(...await tree(directory));
  return Object.fromEntries(await Promise.all([...new Set(files)].sort().map(async name => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(root, name))) hash.update(chunk);
    return [name, hash.digest('hex')];
  })));
}
async function bounded(promise, label, ms = 30000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms); })]); }
  finally { clearTimeout(timer); }
}
function value(result) { assert.equal(result.ok, true, `actual call failed: ${result.error?.code}`); return result.value; }
async function api(route, body, instance = service) {
  const response = await fetch(instance.url + route, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const envelope = await response.json(); assert.equal(response.status < 400, true, `${route}: ${response.status}`); return value(envelope);
}
async function startProductionService(name = 'Synthetic Voice QA') {
  const data = await mkdtemp(path.join(os.tmpdir(), 'voice-native-service-data-'));
  const home = await mkdtemp(path.join(os.tmpdir(), 'voice-native-service-home-'));
  const env = isolatedEnv(process.env, home);
  for (const name of Object.keys(env)) if (/^COMPANION_|^DSH_|API_KEY|TOKEN/.test(name)) delete env[name];
  Object.assign(env, { COMPANION_DATA_DIR: data, COMPANION_TOKEN: token, COMPANION_PORT: '0', COMPANION_HOST: '127.0.0.1', COMPANION_MODE: 'scripted', COMPANION_NAME: name });
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'apps/companion-service/dist/main.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'exit'); let output = '';
  const started = Promise.withResolvers();
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-6000); const match = output.match(/Companion text service: (http:\/\/127\.0\.0\.1:\d+)/); if (match) started.resolve(match[1]); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-6000); });
  child.once('exit', code => started.reject(new Error(`production service startup exit ${code}: ${output.replaceAll(token, '[redacted]')}`)));
  const instance = { child, ended, url: null, data, home, output: () => output.replaceAll(token, '[redacted]') };
  services.push(instance);
  instance.url = await bounded(started.promise, 'production service startup');
  report.services ??= [];
  report.services.push({ url: instance.url, dataRoot: data, childHome: home, pid: child.pid, entry: 'apps/companion-service/dist/main.mjs', dependencyMode: 'production build external workspace package exports via tsx' });
  return instance;
}
function isolatedEnv(base, home) { return { ...base, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data') }; }
const dstate = async () => value(await desktop.evaluate(() => window.petVoice.getState()));
const cstate = async () => value(await desktop.evaluate(() => window.petCompanion.getState()));
const observe = async page => page.evaluate(readCaptureObservations);
async function shot(page, label) { const name = `${id}-${label}.png`; await page.screenshot({ path: path.join(evidence, name) }); report.screenshots.push(`qa/fixtures/companion-voice-input/evidence/${name}`); }
async function newPeer(hold = false, result = 'final') { const peer = await startControlledMagpie({ expectedAuthorization: 'Bearer magpie-dsh-pet', hold, result }); peers.push(peer); return peer; }
async function configure(peer) {
  const view = await api('/api/voice'); const provider = view.providers.find(item => item.providerRef === view.feature.providerRef); assert.ok(provider);
  return api('/api/voice/provider', { providerRef: provider.providerRef, expectedRevision: provider.configRevision,
    settings: { baseUrl: peer.baseUrl, modelRef: 'xiaomi/mimo-v2.5-asr', authMode: 'local-client-id', protocol: 'mimo-native' } });
}
async function connectedDesktop(instance = service, ready = true) {
  const previousConnectionId = (await cstate()).connectionId;
  await desktop.getByTestId('start-address').fill(instance.url);
  await desktop.getByTestId('start-ask-token').click(); await desktop.getByTestId('start-token').fill(token); await desktop.getByTestId('start-connect').click();
  await expect.poll(async () => {
    const current = await cstate();
    return current.phase === 'live' && current.connectionId !== previousConnectionId && current.connectionId !== null && current.snapshot !== null && current.baseUrl === instance.url;
  }, { timeout: 30000 }).toBe(true);
  await desktop.getByTestId('nav-conversation').click(); if (ready) await expect(desktop.getByTestId('voice-start')).toBeEnabled();
}
async function idleDesktop() {
  await expect.poll(async () => (await dstate()).cleanup, { timeout: 15000 }).toBe('settled');
  await expect.poll(async () => (await dstate()).captureId, { timeout: 15000 }).toBe(null);
  const observed = await observe(desktop); assert.ok(observed.tracks.every(state => state === 'ended')); assert.ok(observed.contexts.every(state => state === 'closed'));
}
async function catalogSelection(page, peer, label) {
  const model = page.getByTestId('voice-settings-model');
  await model.fill(''); await page.getByTestId('voice-settings-save').click();
  await expect.poll(async () => (await api('/api/voice')).providers.find(provider => provider.providerRef === 'pet.asr-magpie/magpie')?.settings.modelRef).toBe('');
  await expect(page.getByTestId('voice-settings-read-catalog')).toBeEnabled();
  await page.getByTestId('voice-settings-read-catalog').click();
  await expect(page.getByTestId('voice-settings-catalog')).toContainText('读到 2 个 ASR 候选');
  const picker = page.getByTestId('voice-settings-candidate');
  await expect(picker.locator('option[value="example/whisper-asr"]')).toBeDisabled();
  assert.equal(await picker.locator('option').filter({ hasText: 'tts' }).count(), 0);
  await picker.selectOption('xiaomi/mimo-v2.5-asr'); await expect(model).toHaveValue('xiaomi/mimo-v2.5-asr');
  assert.equal((await api('/api/voice')).providers.find(provider => provider.providerRef === 'pet.asr-magpie/magpie')?.settings.modelRef, '', 'candidate selection changes only the actual UI draft');
  await shot(page, `${label}-catalog-selected`);
  await page.getByTestId('voice-settings-save').click();
  await expect.poll(async () => (await api('/api/voice')).providers.find(provider => provider.providerRef === 'pet.asr-magpie/magpie')?.settings.modelRef).toBe('xiaomi/mimo-v2.5-asr');
  await expect(page.getByTestId('voice-settings-notice')).toHaveText('已保存。');
  assert.equal(peer.snapshot.catalogCount, 1); assert.equal(peer.snapshot.audioCount, 0);
  report.observations[`${label}Catalog`] = peer.snapshot;
  report.checks.push(`production-${label}-saved-empty-model-catalog-selection-is-draft-until-explicit-save`);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
}
async function recording(page) {
  const beforeFrames = (await observe(page)).frames.length;
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-state')).toHaveText('正在录音', { timeout: 15000 });
  await expect.poll(async () => (await observe(page)).frames.length - beforeFrames, { timeout: 15000 }).toBeGreaterThan(3);
}
try {
  await mkdir(evidence, { recursive: true });
  report.hashesBefore = await hashes();
  await writeFile(path.join(evidence, `${id}-before.json`), JSON.stringify({ id, at: new Date().toISOString(), hashes: report.hashesBefore }, null, 2));
  display = await startDisplay(root); report.display = display.env.DISPLAY;
  stage = 'production-service-start'; service = await startProductionService();
  const initial = await api('/api/snapshot'); report.agentId = initial.agent.id;
  const beforeWebUsers = webOnly ? 0 : 1;
  if (!webOnly) {
  const peer = await newPeer(); await configure(peer);
  const home = await mkdtemp(path.join(os.tmpdir(), 'voice-native-electron-home-'));
  stage = 'production-electron-start';
  app = await _electron.launch({ executablePath: electron, env: isolatedEnv(display.env, home), args: ['--no-sandbox', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, path.join(root, 'apps/desktop'), `--demo-acceptance=voice-${id}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter(page => page.url().startsWith('file:')).length, { timeout: 30000 }).toBe(2);
  desktop = app.windows().find(page => page.url().endsWith('/console/index.html')); assert.ok(desktop);
  report.runtime = await app.evaluate(({ BrowserWindow }) => ({ electron: process.versions.electron, platform: process.platform, arch: process.arch,
    windows: BrowserWindow.getAllWindows().map(win => ({ url: win.webContents.getURL(), contextIsolation: win.webContents.getLastWebPreferences().contextIsolation, nodeIntegration: win.webContents.getLastWebPreferences().nodeIntegration })) }));
  await desktop.evaluate(installCaptureObservers);
  await desktop.evaluate(() => { window.__voiceStates = []; window.petVoice.onChanged(async () => { const state = await window.petVoice.getState(); if (state.ok) window.__voiceStates.push({ at: Date.now(), ...state.value }); }); });
  stage = 'main-permission-denied-without-lease';
  const denied = await desktop.evaluate(async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); return 'allowed'; } catch (error) { return error.name; } });
  assert.equal(denied, 'NotAllowedError'); report.observations.permissionWithoutLease = denied;
  const security = value(await desktop.evaluate(() => window.petConsole.getSecurity()));
  report.observations.captureSourceSecurity = security.plugins.filter(plugin => plugin.owner.pluginId === 'pet.audio-capture');
  report.checks.push('actual-Main-denies-getUserMedia-without-live-lease');
  stage = 'desktop-trust-and-enable-real-source';
  if (security.plugins.find(plugin => plugin.owner.pluginId === 'pet.audio-capture')?.state !== 'active') {
    await desktop.getByTestId('nav-plugins').click(); await desktop.getByTestId('plugins-permissions').click();
    await desktop.getByTestId('trust-pet.audio-capture').click(); await desktop.getByTestId('trust-confirm').click();
    await expect.poll(async () => value(await desktop.evaluate(() => window.petConsole.getSecurity())).plugins.find(plugin => plugin.owner.pluginId === 'pet.audio-capture')?.trusted).toBe(true);
    await desktop.getByTestId('nav-plugins').click(); await desktop.getByTestId('plugin-toggle-pet.audio-capture').click();
    await expect.poll(async () => value(await desktop.evaluate(() => window.petConsole.getSnapshot())).plugins.find(plugin => plugin.owner.pluginId === 'pet.audio-capture')?.state).toBe('active');
    await desktop.getByTestId('nav-start').click();
    report.checks.push('real-product-source-trust-confirmation-and-enable-controls');
  }
  stage = 'desktop-connect'; await connectedDesktop();
  assert.equal((await cstate()).snapshot.agent.id, initial.agent.id);
  const source = value(await desktop.evaluate(() => window.petConsole.getSnapshot()));
  assert.equal(source.plugins.find(item => item.owner.pluginId === 'pet.audio-capture')?.state, 'active');
  assert.ok(!source.plugins.some(item => ['pet.voice-chat', 'pet.agent-cortico', 'pet.asr-local'].includes(item.owner.pluginId) && item.state === 'active'));
  assert.equal(await desktop.evaluate(() => Object.isFrozen(window.petVoice)), true);
  if (targetedOnly) {
    report.scope = 'production-linux-native-targeted-consumer-regressions-only';
    await runTargetedNative({ page: desktop, app, report, id, api, newPeer, configure,
      reconnect: async () => { await desktop.getByTestId('nav-start').click(); await connectedDesktop(); },
      recording, idle: idleDesktop, voiceState: dstate, companionState: cstate, observe, shot,
      stage: value => { stage = value; } });
  } else {
  stage = 'desktop-production-catalog';
  await desktop.getByTestId('nav-start').click(); await desktop.getByTestId('voice-open').click();
  await catalogSelection(desktop, peer, 'desktop');
  await desktop.getByTestId('nav-conversation').click(); await expect(desktop.getByTestId('voice-start')).toBeEnabled();
  await desktop.getByTestId('conversation-input').fill('保留的合成草稿');
  await expect(desktop.getByTestId('voice-hint')).toContainText(/最多录\s*20\s*秒，到时自动结束并发送/);
  stage = 'desktop-real-capture-finish'; await recording(desktop);
  const recordingState = await dstate(); assert.equal(recordingState.phase, 'recording'); assert.ok(recordingState.samples > 0);
  report.observations.desktopRecording = recordingState; await shot(desktop, 'desktop-recording');
  await desktop.getByTestId('voice-finish').click();
  const audio = await bounded(peer.firstAudio, 'desktop actual ASR request', 15000);
  report.observations.desktopAudio = audio;
  await expect.poll(async () => (await api('/api/snapshot')).messages.filter(message => message.role === 'user').length, { timeout: 15000 }).toBe(1);
  const after = await api('/api/snapshot'); assert.equal(after.agent.id, initial.agent.id); assert.equal(after.messages.filter(message => message.role === 'user' && message.text === '受控测试转录').length, 1); assert.equal(peer.snapshot.audioCount, 1);
  await expect(desktop.getByTestId('conversation-input')).toHaveValue('保留的合成草稿'); await idleDesktop();
  report.observations.desktopFinished = await observe(desktop);
  const finishObs = report.observations.desktopFinished;
  const tail = finishObs.frames.find(samples => samples > 0 && samples < 1600); assert.ok(tail, 'actual non-full worklet tail must exist');
  assert.equal(audio.samples, finishObs.frames.reduce((sum, count) => sum + count, 0), 'actual provider audio must include every emitted worklet frame and tail');
  report.checks.push('production-Electron-getUserMedia-worklet-Main-binary-ACK-release-ASR-same-Agent-once-with-tail-and-draft');
  await shot(desktop, 'desktop-finished');
  stage = 'desktop-recording-cancel'; await recording(desktop); await desktop.getByTestId('voice-cancel').click(); await idleDesktop();
  assert.equal(peer.snapshot.audioCount, 1); assert.equal((await api('/api/snapshot')).messages.filter(message => message.role === 'user').length, 1);
  report.checks.push('production-Electron-recording-cancel-releases-tracks-context-and-Main-with-zero-ASR-message');
  stage = 'desktop-ASR-pending-cancel';
  const held = await newPeer(true); await configure(held);
  // Reconnect through the real form to render the new provider revision and binding.
  await desktop.getByTestId('nav-start').click(); await connectedDesktop();
  await recording(desktop); await desktop.getByTestId('voice-finish').click(); await bounded(held.firstAudio, 'held desktop ASR');
  await expect(desktop.getByTestId('voice-state')).toHaveText('正在转写…'); await desktop.getByTestId('voice-cancel').click();
  await idleDesktop(); held.release();
  await expect.poll(() => held.snapshot.abortedResponses).toBe(1);
  assert.equal((await api('/api/snapshot')).messages.filter(message => message.role === 'user').length, 1);
  report.checks.push('production-Electron-ASR-pending-cancel-aborts-real-peer-and-suppresses-late-result');
  stage = 'desktop-source-withdrawal';
  const retiringPeer = await newPeer(); await configure(retiringPeer);
  await desktop.getByTestId('nav-start').click(); await connectedDesktop();
  await recording(desktop); const withdrawnId = (await dstate()).captureId;
  await desktop.getByTestId('nav-plugins').click(); await desktop.getByTestId('plugins-permissions').click();
  await desktop.getByTestId('trust-pet.audio-capture').click(); await desktop.getByTestId('trust-confirm').click();
  await idleDesktop(); assert.equal(retiringPeer.snapshot.audioCount, 0);
  report.observations.withdrawnCaptureId = withdrawnId;
  assert.equal((await api('/api/snapshot')).messages.filter(message => message.role === 'user').length, 1);
  report.checks.push('actual-source-trust-withdrawal-notifies-renderer-stops-tracks-context-and-Main-lease-without-ASR');
  // Restore only through the same real trust and source lifecycle controls.
  stage = 'desktop-source-restore';
  await expect.poll(async () => value(await desktop.evaluate(() => window.petConsole.getSecurity())).plugins.find(plugin => plugin.owner.pluginId === 'pet.audio-capture')?.trusted).toBe(false);
  await desktop.getByTestId('trust-pet.audio-capture').click(); await desktop.getByTestId('trust-confirm').click();
  await expect.poll(async () => value(await desktop.evaluate(() => window.petConsole.getSecurity())).plugins.find(plugin => plugin.owner.pluginId === 'pet.audio-capture')?.trusted).toBe(true);
  await desktop.getByTestId('nav-plugins').click();
  const sourceToggle = desktop.getByTestId('plugin-toggle-pet.audio-capture');
  // The product preserves desiredActive across trust revocation. Explicitly reset that desire, then enable.
  if (await sourceToggle.isChecked()) {
    await sourceToggle.click(); await desktop.getByTestId('plugin-action-confirm').click();
    await expect(sourceToggle).not.toBeChecked();
  }
  await sourceToggle.click();
  await expect.poll(async () => value(await desktop.evaluate(() => window.petConsole.getSnapshot())).plugins.find(plugin => plugin.owner.pluginId === 'pet.audio-capture')?.state).toBe('active');
  stage = 'desktop-connection-retarget';
  const second = await startProductionService('Synthetic Target B'); const secondInitial = await api('/api/snapshot', undefined, second);
  assert.notEqual(secondInitial.agent.id, initial.agent.id);
  await desktop.getByTestId('nav-start').click(); await connectedDesktop();
  await recording(desktop); const oldConnection = (await cstate()).connectionId;
  await desktop.getByTestId('nav-start').click(); await connectedDesktop(second, false);
  await idleDesktop(); assert.notEqual((await cstate()).connectionId, oldConnection);
  assert.equal((await cstate()).snapshot.agent.id, secondInitial.agent.id);
  assert.equal(retiringPeer.snapshot.audioCount, 0);
  assert.equal((await api('/api/snapshot')).messages.filter(message => message.role === 'user').length, 1);
  assert.equal((await api('/api/snapshot', undefined, second)).messages.filter(message => message.role === 'user').length, 0);
  report.checks.push('actual-connection-retarget-stops-old-tracks-and-lease-with-no-new-Agent-message');
  }
  }
  if (!targetedOnly) {
  stage = 'web-production-permission';
  const webPeer = await newPeer(); await configure(webPeer);
  const webHome = await mkdtemp(path.join(os.tmpdir(), 'voice-native-browser-home-'));
  browser = await chromium.launch({ executablePath: browserExe, env: isolatedEnv(display.env, webHome), chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  report.browserRuntime = { version: browser.version(), executable: path.relative(root, browserExe), flags: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=<QA synthetic-tone-16k.wav>'] };
  const deniedContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await deniedContext.grantPermissions([], { origin: new URL(service.url).origin });
  web = await deniedContext.newPage(); await web.addInitScript(installCaptureObservers);
  const connectWeb = async page => { await page.goto(service.url); await page.locator('#tc-token').fill(token); await page.locator('#tc-token').press('Enter'); await page.locator('.tc-chat').waitFor(); };
  await connectWeb(web);
  report.observations.webDeniedPermission = await web.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state);
  await expect(web.getByTestId('voice-start')).toBeEnabled(); await web.getByTestId('voice-start').click();
  await expect(web.getByTestId('voice-error')).toBeVisible({ timeout: 15000 });
  report.observations.webDenied = await observe(web);
  const deniedName = report.observations.webDenied.events.find(event => event.kind === 'getUserMedia-denied')?.name;
  assert.ok(['NotAllowedError', 'NotSupportedError'].includes(deniedName), `unexpected real browser denial ${deniedName}`);
  assert.equal(report.observations.webDeniedPermission, 'denied');
  if (deniedName === 'NotAllowedError') {
    await expect(web.getByTestId('voice-error')).toContainText('没有获得麦克风权限');
    report.checks.push('production-web-secure-loopback-browser-permission-denial-and-no-ASR');
  } else {
    report.limits.push('Explicitly denied headless-shell context returns NotSupportedError before track creation; this does not validate permission-denied product wording.');
  }
  assert.equal(await web.evaluate(() => window.isSecureContext), true);
  assert.equal(webPeer.snapshot.audioCount, 0);
  await shot(web, 'web-consent-denied'); await deniedContext.close();
  // Parent explicitly authorizes origin-scoped pre-granted Web context as a user-authorized prerequisite.
  const grantedContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await grantedContext.grantPermissions(['microphone'], { origin: new URL(service.url).origin });
  web = await grantedContext.newPage(); await web.addInitScript(installCaptureObservers); await connectWeb(web);
  report.observations.webGrantedPermission = await web.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state);
  assert.equal(report.observations.webGrantedPermission, 'granted');
  stage = 'web-production-catalog';
  await web.getByTestId('open-voice-settings').click(); await catalogSelection(web, webPeer, 'Web');
  report.observations.webUploads = [];
  web.on('request', request => {
    if (request.method() !== 'POST' || !/\/api\/voice\/captures\/[^/]+\/audio$/.test(new URL(request.url()).pathname)) return;
    const headers = request.headers();
    report.observations.webUploads.push({ method: request.method(), contentType: headers['content-type'], samples: headers['x-pet-voice-samples'], bytes: request.postDataBuffer()?.byteLength, ownershipHeaderPresence: ['x-pet-voice-client', 'x-pet-voice-agent', 'x-pet-voice-epoch'].every(name => typeof headers[name] === 'string') });
  });
  stage = 'web-real-capture-roundtrip'; await web.locator('#tc-input').fill('Web保留的合成草稿');
  await recording(web); await shot(web, 'web-recording'); await web.getByTestId('voice-finish').click();
  const webAudio = await bounded(webPeer.firstAudio, 'Web actual native ASR');
  await expect.poll(async () => (await api('/api/snapshot')).messages.filter(message => message.role === 'user').length).toBe(beforeWebUsers + 1);
  await expect(web.locator('#tc-input')).toHaveValue('Web保留的合成草稿');
  const webObserved = await observe(web); report.observations.webFinished = webObserved; report.observations.webAudio = webAudio;
  assert.ok(webObserved.tracks.length > 0 && webObserved.tracks.every(state => state === 'ended'));
  assert.ok(webObserved.contexts.every(state => state === 'closed'));
  assert.equal(webAudio.samples, webObserved.frames.reduce((sum, count) => sum + count, 0));
  assert.equal(report.observations.webUploads.length, 1);
  assert.equal(report.observations.webUploads[0].contentType, 'application/octet-stream');
  assert.equal(Number(report.observations.webUploads[0].samples), webAudio.samples);
  assert.equal(report.observations.webUploads[0].bytes, webAudio.samples * 4);
  assert.equal(report.observations.webUploads[0].ownershipHeaderPresence, true);
  assert.equal((await api('/api/snapshot')).agent.id, initial.agent.id); assert.equal(webPeer.snapshot.audioCount, 1);
  report.checks.push('production-Web-real-getUserMedia-worklet-full-HTTP-capture-ASR-same-Agent-once-and-draft');
  stage = 'web-recording-cancel'; await recording(web); await web.getByTestId('voice-cancel').click();
  await expect(web.getByTestId('voice-start')).toBeEnabled();
  assert.ok((await observe(web)).tracks.every(state => state === 'ended')); assert.equal(webPeer.snapshot.audioCount, 1);
  assert.equal((await api('/api/snapshot')).messages.filter(message => message.role === 'user').length, beforeWebUsers + 1);
  report.checks.push('production-Web-recording-cancel-no-ASR-or-message');
  report.limits.push('Web granted context uses explicitly authorized origin-scoped browser permission; browser manual prompt UI is not validated.');
  await shot(web, 'web-finished');
  }
  report.status = 'checkpoint-passed'; exit = 0;
} catch (error) {
  report.status = 'failed'; report.failure = { stage, name: error.name, detail: error.message.replaceAll(token, '[redacted]').slice(0, 1600) };
  if (web && !web.isClosed()) {
    try { report.observations.webFailure = await observe(web); report.observations.webFailureUI = await web.getByTestId('voice-input').innerText(); await shot(web, 'web-failure'); } catch (failure) { report.webObservationFailure = failure.name; }
  }
  if (desktop && !desktop.isClosed()) {
    try { report.observations.desktopFailure = await observe(desktop); report.observations.mainFailure = await dstate(); await shot(desktop, 'desktop-failure'); if (await desktop.getByTestId('voice-input').count()) report.observations.voiceUI = await desktop.getByTestId('voice-input').innerText(); } catch (failure) { report.observationFailure = failure.name; }
  }
} finally {
  if (desktop && !desktop.isClosed()) {
    try { await desktop.evaluate(() => window.__voiceNativeQA?.releaseDelivery?.()); report.observations.mainStates = await desktop.evaluate(() => window.__voiceStates); const cancel = desktop.getByTestId('voice-cancel'); if (await cancel.count()) await cancel.click(); await idleDesktop(); report.cleanup.capture = 'tracks-ended-contexts-closed-Main-settled'; } catch (error) { report.cleanup.capture = error.message.slice(0, 300); }
  }
  if (app) { try { await bounded(app.close(), 'Electron close'); report.cleanup.electron = 'closed'; } catch (error) { app.process().kill('SIGKILL'); report.cleanup.electron = error.message; exit = 1; } }
  if (browser) { try { await bounded(browser.close(), 'browser close'); report.cleanup.browser = 'closed'; } catch (error) { report.cleanup.browser = error.message; exit = 1; } }
  report.cleanup.services = [];
  for (const instance of services) {
    try { instance.child.kill('SIGTERM'); const [code, signal] = await bounded(instance.ended, 'service close'); report.cleanup.services.push({ url: instance.url, code, signal }); if (code !== 0) exit = 1; }
    catch (error) { instance.child.kill('SIGKILL'); await instance.ended; report.cleanup.services.push({ url: instance.url, error: error.message }); exit = 1; }
  }
  report.serviceLogs = services.map(instance => instance.output());
  for (const peer of peers) { try { await peer.close(); } catch (error) { report.cleanup.peerError = error.message; exit = 1; } }
  report.cleanup.peers = peers.map(peer => peer.snapshot);
  if (display) { try { await bounded(display.stop(), 'owned Xvfb close'); report.cleanup.display = 'closed'; } catch (error) { report.cleanup.display = error.message; exit = 1; } }
  try { report.hashesAfter = await hashes(); assert.deepEqual(report.hashesAfter, report.hashesBefore, 'frozen runner/product hashes changed'); report.hashesUnchanged = true; } catch (error) { report.hashesUnchanged = false; report.hashFailure = error.message.slice(0, 300); exit = 1; }
  report.actualExit = exit; await writeFile(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ report: path.relative(root, reportPath), id, status: report.status, stage, checks: report.checks, failure: report.failure, actualExit: exit, cleanup: report.cleanup, screenshots: report.screenshots }, null, 2)); process.exitCode = exit;
}
