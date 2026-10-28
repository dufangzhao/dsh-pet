import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url),
  executablePath = path.join(
    path.dirname(require.resolve('electron/package.json')),
    'dist/electron.exe',
  );
const profileId = new Date().toISOString().replace(/[:.]/g, '-');
const audioFile = path.join(root, '.cache/asr-models/sensevoice-small-int8/test_wavs/zh.wav');
const env = {};
for (const name of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
])
  if (process.env[name]) env[name] = process.env[name];
const report = {
  status: 'running',
  at: new Date().toISOString(),
  sandboxOverride: true,
  fakeAudioDevice: true,
  checks: [],
  errors: [],
  screenshots: [],
};
let app, page, pet;
const state = async () => {
  const result = await page.evaluate(() => window.petDemo.getSnapshot());
  assert.equal(result.ok, true);
  return result.value;
};
const wait = async (predicate, timeout = 15000) => {
  await expect
    .poll(
      async () => {
        const value = await state();
        if (value.phase === 'error') throw new Error(JSON.stringify(value.error));
        return predicate(value);
      },
      { timeout },
    )
    .toBe(true);
  return state();
};
const endedTracks = () =>
  page.evaluate(() =>
    window.__demoQATracks
      .flatMap((stream) => stream.getTracks().map((track) => track.readyState))
      .every((value) => value === 'ended'),
  );
const launch = async () => {
  app = await _electron.launch({
    executablePath,
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=' + audioFile,
      path.join(root, 'apps/desktop'),
      '--demo-acceptance=' + profileId,
      '--show-settings',
    ],
    env,
    timeout: 20000,
  });
  pet = await app.firstWindow();
  await pet.waitForURL('**/pet/index.html');
  page = app.windows().find((window) => window.url().includes('/console/'));
  if (!page) page = await app.waitForEvent('window', { timeout: 15000 });
  await page.waitForURL('**/console/index.html');
  for (const owned of [pet, page])
    owned.on('pageerror', (error) => report.errors.push(error.message));
  await expect(page.getByTestId('nav-start')).toBeVisible();
  await page.evaluate(() => {
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__demoQATracks = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await get(constraints);
      window.__demoQATracks.push(stream);
      return stream;
    };
  });
};
const preset = async (pluginId, value) => {
  const plugin = (await state()).plugins.find((item) => item.pluginId === pluginId);
  const result = await page.evaluate((request) => window.petConsole.setPermissionPreset(request), {
    owner: plugin.owner,
    preset: value,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.operationError, null);
};
const capture = async (owned, name, omitBackground = false) => {
  const folder = path.join(root, 'qa/screenshots/demo');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, name + '.png');
  await owned.screenshot({ path: file, omitBackground });
  report.screenshots.push(path.relative(root, file).split(path.sep).join('/'));
};
try {
  await launch();
  const initial = await state();
  assert.equal(initial.settings.modelId, null);
  assert.equal(initial.plugins.length, 5);
  assert.equal(initial.models.filter((item) => item.cached).length, 2);
  report.checks.push('real-app-starts-five-plugins-two-cached-models-and-fixed-bridge');
  await page.getByTestId('nav-voice').click();
  const model = page.getByTestId('asr-model-sensevoice-small-int8');
  await expect(model).not.toBeChecked();
  await model.click();
  await expect.poll(async () => (await state()).settings.modelId).toBe('sensevoice-small-int8');
  report.checks.push('first-model-choice-is-explicit-and-persists-through-real-config');
  await page.getByTestId('nav-start').click();
  await page.getByTestId('demo-prep-open').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const checkboxes = await dialog.getByRole('checkbox').all();
  assert.ok(checkboxes.length >= 5);
  for (const box of checkboxes) {
    await expect(box).not.toBeChecked();
    if (await box.isEnabled()) await box.check();
  }
  await page.getByTestId('demo-prep-run').click();
  await wait((value) => value.canSend && value.canRecord);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  report.checks.push('reviewed-source-and-explicit-local-preset-enable-real-functions');
  await page.getByTestId('demo-input').fill('你好，这是本地演示');
  await page.getByTestId('demo-send').click();
  const typed = await wait((value) => value.phase === 'idle' && value.messages.length === 2);
  await expect(page.getByText(typed.messages.at(-1).text, { exact: true })).toBeVisible();
  assert.ok(typed.messages.at(-1).text.includes('脚本，不是 AI'));
  assert.equal(typed.transcript, '');
  await expect(pet.locator('.pet-bubble__text')).toContainText('脚本演示');
  report.checks.push('real-text-message-scripted-reply-and-live-pet-bubble');
  const binary = await page.evaluate(async () => {
    const ticket = await window.petDemo.beginRecording();
    if (!ticket.ok) return ticket;
    const ready = await window.petDemo.captureReady({
      token: ticket.value.token,
      sampleRate: 16000,
    });
    if (!ready.ok) return ready;
    const samples = new Float32Array(1600);
    samples.fill(0.1);
    const sent = await window.petDemo.pushAudio(
      { token: ticket.value.token, sequence: 0 },
      new Uint8Array(samples.buffer),
    );
    const invalid = new Float32Array([NaN]);
    const refused = await window.petDemo.pushAudio(
      { token: ticket.value.token, sequence: 1 },
      new Uint8Array(invalid.buffer),
    );
    await window.petDemo.cancel();
    return { ok: sent.ok && !refused.ok && refused.error.code === 'audio-format' };
  });
  assert.equal(binary.ok, true);
  report.checks.push('owned-binary-pcm-roundtrip-and-invalid-sample-rejection');
  await page.getByTestId('demo-record').click();
  await wait((value) => value.phase === 'recording');
  await expect(pet.getByTestId('pet-stage')).toHaveAttribute('data-state', 'listening');
  await capture(pet, 'pet-listening', true);
  await page.waitForTimeout(6200);
  assert.equal((await state()).phase, 'recording');
  await page.getByTestId('demo-record-end').click();
  const voice = await wait((value) => value.phase === 'idle' && value.messages.length === 4);
  assert.ok(voice.transcript.trim());
  assert.equal(voice.messages.at(-1).mode, 'demo');
  await expect.poll(endedTracks).toBe(true);
  report.voice = { characters: [...voice.transcript].length, replyMode: voice.settings.replyMode };
  report.checks.push('getusermedia-worklet-normalized-f32-native-asr-reply-and-track-release');
  const outside = await page.evaluate(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'allowed';
    } catch (error) {
      return error.name;
    }
  });
  assert.notEqual(outside, 'allowed');
  report.checks.push('browser-microphone-denied-without-live-capture-lease');
  await page.getByTestId('demo-record').click();
  await wait((value) => value.phase === 'recording');
  await pet.getByTestId('pet-stop').click();
  await wait((value) => value.phase === 'idle');
  await expect.poll(endedTracks).toBe(true);
  assert.equal((await state()).messages.length, 4);
  report.checks.push('pet-stop-cancels-actual-recording-and-releases-tracks');
  await preset('pet.voice-chat', 'ask');
  await preset('pet.asr-local', 'ask');
  await page.getByTestId('demo-record').click();
  await expect(page.locator('.console-notice button')).toBeVisible();
  await page.locator('.console-notice button').click();
  let approvals = 0;
  const approvalLimit = performance.now() + 40000;
  while ((await state()).phase !== 'recording') {
    const value = await state();
    if (value.phase === 'error')
      throw new Error('Approval capture failed: ' + JSON.stringify(value.error));
    if (performance.now() > approvalLimit) throw new Error('Approval flow timed out');
    const security = await page.evaluate(() => window.petConsole.getSecurity());
    assert.equal(security.ok, true);
    if (security.value.pending.length) {
      const prompt = security.value.pending[0];
      await page.getByTestId('approval-allow-' + prompt.requestId).click();
      approvals++;
    } else await page.waitForTimeout(20);
  }
  await expect(page.getByTestId('demo-record-cancel')).toBeVisible();
  await page.getByTestId('demo-record-cancel').click();
  await wait((value) => value.phase === 'idle');
  await expect.poll(endedTracks).toBe(true);
  assert.equal((await state()).messages.length, 4);
  assert.ok(approvals >= 5);
  report.approvals = approvals;
  report.checks.push('ask-approvals-across-navigation-preserve-single-capture-and-global-cancel');
  await preset('pet.voice-chat', 'local');
  await preset('pet.asr-local', 'local');
  await page.getByTestId('nav-start').click();
  await page.getByTestId('demo-record').click();
  const automatic = await wait((value) => value.phase === 'recording');
  await wait((value) => value.phase === 'idle' && value.messages.length === 6, 28000);
  await expect.poll(endedTracks).toBe(true);
  report.automaticStopMs = Date.now() - automatic.recordingStartedAt;
  assert.ok(report.automaticStopMs < 24000);
  report.checks.push('twenty-second-limit-ends-once-recognizes-and-releases-hardware');
  await page.getByTestId('nav-models').click();
  if ((await state()).keyAvailable) {
    await page.getByTestId('demo-key-input').fill('fixture-demo-not-a-real-provider-key');
    await page.getByTestId('demo-key-save').click();
    await expect.poll(async () => (await state()).keyConfigured).toBe(true);
    const config = await page.evaluate(async () => {
      const state = (await window.petDemo.getSnapshot()).value;
      return window.petConsole.inspectConfig(
        state.plugins.find((item) => item.pluginId === 'pet.llm-provider').owner,
      );
    });
    assert.equal(JSON.stringify(config).includes('fixture-demo-not-a-real-provider-key'), false);
    await page.getByTestId('demo-key-remove').click();
    await expect.poll(async () => (await state()).keyConfigured).toBe(false);
    report.checks.push('real-encrypted-key-presence-and-removal-without-any-provider-call');
  }
  await page.getByTestId('nav-start').click();
  const completed = await state();
  await page.getByTestId('demo-input').scrollIntoViewIfNeeded();
  await capture(page, 'demo-conversation');
  await capture(pet, 'pet-reply', true);
  report.messagesBeforeRestart = completed.messages.length;
  const savedIds = completed.messages.map((item) => item.id);
  await app.close();
  app = undefined;
  await launch();
  const reopened = await state();
  assert.deepEqual(
    reopened.messages.map((item) => item.id),
    savedIds,
  );
  assert.equal(reopened.settings.modelId, 'sensevoice-small-int8');
  assert.equal(
    reopened.plugins.every((item) => !item.trusted),
    true,
  );
  report.checks.push('history-and-model-survive-restart-while-source-trust-remains-session-only');
  await page.getByTestId('demo-clear').click();
  await page.getByTestId('demo-clear-confirm').click();
  await expect.poll(async () => (await state()).messages.length).toBe(0);
  report.checks.push('explicit-clear-removes-real-persisted-history');
  report.status = report.errors.length ? 'failed' : 'passed';
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
  if (page)
    try {
      report.failurePage = await page.getByRole('main').innerText();
      report.diagnostics = await state();
      report.trace = await app.evaluate(() => globalThis.petDemoAcceptance?.events);
    } catch {}
} finally {
  if (app) await app.close().catch(() => {});
  await fs.writeFile(
    path.join(root, 'qa/demo-ui-results.json'),
    JSON.stringify(report, null, 2) + String.fromCharCode(10),
  );
  console.log(JSON.stringify(report));
}
