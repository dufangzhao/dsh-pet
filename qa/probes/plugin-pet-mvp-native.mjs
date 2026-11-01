import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(import.meta.url),
  exe = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const out = path.join(root, '.cache/mvp-native');
await fs.mkdir(out, { recursive: true });
const env = {};
for (const key of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
])
  if (process.env[key]) env[key] = process.env[key];
const report = { status: 'running', checks: [], errors: [], profile: 'mvp-' + Date.now() };
let app;
try {
  app = await _electron.launch({
    executablePath: exe,
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=' +
        path.join(root, '.cache/asr-models/sensevoice-small-int8/test_wavs/en.wav'),
      path.join(root, 'apps/desktop'),
      '--demo-acceptance=' + report.profile,
    ],
    env,
    timeout: 30000,
  });
  app.context().on('page', (page) => page.on('pageerror', (e) => report.errors.push(String(e))));
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/pet/index.html')), { timeout: 25000 })
    .toBe(true);
  const pet = app.windows().find((p) => p.url().includes('/pet/index.html'));
  await pet.waitForLoadState('domcontentloaded');
  await pet.waitForTimeout(1500);
  const settings = app.windows().find((p) => p.url().includes('/console/index.html'));
  assert.ok(settings, 'Hidden shared capture window must exist');
  report.windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      url: w.webContents.getURL(),
      visible: w.isVisible(),
      id: w.webContents.id,
    })),
  );
  const state = await pet.evaluate(() => window.petApplication.getSnapshot());
  report.application = {
    ok: state.ok,
    error: state.ok ? state.value.error : state.error,
    agent: state.ok ? state.value.agent : null,
    pages: state.ok ? state.value.pages.map((p) => ({ id: p.id, title: p.title })) : [],
    profile: state.ok
      ? { revision: state.value.profile?.revision, name: state.value.profile?.data.petName }
      : null,
  };
  assert.ok(state.ok);
  assert.equal(state.value.agent.state, 'ready');
  report.voice = await pet.evaluate(() => window.petVoiceInput.getSnapshot());
  report.speech = await pet.evaluate(() => window.petSpeechOutput.getSnapshot());
  report.presentation = await pet.evaluate(() => window.petPresentation.getSnapshot());
  await pet.screenshot({ path: path.join(out, 'pet-start.png'), omitBackground: true });
  await pet.evaluate(() => window.petSettings.open());
  await settings.waitForTimeout(200);
  await settings.screenshot({ path: path.join(out, 'settings-start.png') });
  for (let i = 0; i < 8; i++) {
    const current = await pet.evaluate(() => window.petApplication.getSnapshot());
    if (!current.ok || !current.value.dialog) break;
    const d = current.value.dialog;
    const choice = d.choices.find((c) => c.id === 'deny' || c.id === 'later' || c.id === 'skip');
    if (!choice) break;
    await pet.evaluate((req) => window.petApplication.answer(req), {
      id: d.id,
      step: d.step,
      choice: choice.id,
    });
    await pet.waitForTimeout(100);
  }
  await pet.getByTestId('pet-avatar').hover();
  await expect(pet.getByTestId('pet-tools')).toBeVisible();
  await pet.getByTestId('pet-chat').click();
  await expect(pet.getByTestId('pet-composer-input')).toBeVisible();
  const size = await pet.getByTestId('pet-composer-input').boundingBox();
  assert.ok(size.height <= 60, 'Composer is not compact');
  await pet.getByTestId('pet-composer-input').fill('你好，桌宠');
  await pet.screenshot({ path: path.join(out, 'pet-composer.png'), omitBackground: true });
  await pet.getByTestId('pet-composer-input').press('Enter');
  await pet.waitForTimeout(1800);
  await pet.screenshot({ path: path.join(out, 'pet-reply.png'), omitBackground: true });
  report.history = await pet.evaluate(() => window.petApplication.getSnapshot());
  report.checks.push(
    'native windows/frozen bridges',
    'active Core/plugin pages',
    'hover chat/mic and compact composer',
    'typing through actual application history',
  );
  async function settle(predicate, label, timeout = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const state = await pet.evaluate(() => window.petApplication.getSnapshot());
      const d = state.ok ? state.value.dialog : null;
      if (d && d.choices.some((c) => c.id === 'allow')) {
        const button = pet.getByTestId('pet-dialog-choice-allow');
        if (await button.isVisible()) await button.click();
      }
      if (await predicate()) return;
      await pet.waitForTimeout(150);
    }
    throw new Error('Native acceptance timeout: ' + label);
  }
  await pet.evaluate(() => {
    window.__mvpAudio = { bytes: 0, starts: 0, ends: 0 };
    window.petSpeechOutput.onAudio((event, payload) => {
      if (event.kind === 'start') window.__mvpAudio.starts++;
      if (event.kind === 'chunk') window.__mvpAudio.bytes += payload.byteLength;
      if (event.kind === 'end') window.__mvpAudio.ends++;
    });
  });
  await settle(async () => {
    const s = await pet.evaluate(() => window.petSpeechOutput.getSnapshot());
    return s.ok && s.value.phase === 'idle';
  }, 'first typed response speech');
  const nativePlugins = await settings.evaluate(() => window.petConsole.getSnapshot());
  assert.ok(nativePlugins.ok);
  for (const id of ['pet.voice-chat', 'pet.asr-local', 'pet.talk-key']) {
    const row = nativePlugins.value.plugins.find((p) => p.owner.pluginId === id);
    if (row && row.state !== 'active') {
      const enabled = await settings.evaluate(
        (request) => window.petConsole.runPluginAction(request),
        { owner: row.owner, action: 'enable' },
      );
      assert.ok(
        enabled.ok && !enabled.value.operationError,
        'Explicit enable ' +
          id +
          ': ' +
          (enabled.error?.code || enabled.value?.operationError?.code),
      );
    }
  }
  await settings.evaluate(() => {
    window.__mvpVoiceStart = { done: false };
    void window.petVoiceInput.start().then((result) => {
      window.__mvpVoiceStart = { done: true, result };
    });
  });
  await settle(() => settings.evaluate(() => window.__mvpVoiceStart.done), 'voice service start');
  const started = await settings.evaluate(() => window.__mvpVoiceStart.result);
  const voiceStartedAt = Date.now();
  assert.ok(started.ok, 'Voice start: ' + started.error?.code);
  await settings.getByRole('button', { name: '语音输入', exact: true }).click();
  const auto = settings.getByTestId('demo-auto-send');
  if (!(await auto.isChecked())) await auto.check();
  await expect
    .poll(async () => {
      const s = await pet.evaluate(() => window.petDemo.getSnapshot());
      return s.ok && s.value.settings.autoSend;
    })
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('/console/index.html'))
      .close(),
  );
  await pet.getByTestId('pet-avatar').hover();
  await pet.getByTestId('pet-mic').click();
  await settle(async () => {
    const s = await pet.evaluate(() => window.petDemo.getSnapshot());
    return s.ok && s.value.phase === 'recording';
  }, 'public WAV capture');
  await pet.waitForTimeout(8500);
  await pet.getByTestId('pet-mic').click();
  await settle(
    async () => {
      const s = await pet.evaluate(() => window.petApplication.getSnapshot());
      return (
        s.ok &&
        s.value.history.some((row) => row.kind === 'user' && row.via === 'voice') &&
        s.value.history.at(-1)?.kind === 'pet'
      );
    },
    'ASR conversation reply',
    60000,
  );
  await settle(
    async () => {
      const s = await pet.evaluate(() => window.petSpeechOutput.getSnapshot());
      const a = await pet.evaluate(() => window.__mvpAudio);
      return s.ok && s.value.phase === 'idle' && a.bytes > 0 && a.ends > 0;
    },
    'real speech playback receipt',
    60000,
  );
  const listenerWait = 32000 - (Date.now() - voiceStartedAt);
  if (listenerWait > 0) await pet.waitForTimeout(listenerWait);
  const liveKey = await pet.evaluate(() => window.petVoiceInput.getSnapshot());
  assert.ok(liveKey.ok && liveKey.value.talkKeyActive, 'Owner-scoped native key listener expired');
  report.keyAfter30Seconds = liveKey.value.talkKeyActive;
  report.audio = await pet.evaluate(() => window.__mvpAudio);
  report.voiceAfter = await pet.evaluate(() => window.petVoiceInput.getSnapshot());
  report.history = await pet.evaluate(() => window.petApplication.getSnapshot());
  report.checks.push(
    'public WAV -> single hidden capture owner -> SenseVoice -> unified conversation -> actual system PCM/WebAudio receipt',
  );
  await pet.evaluate(() => window.petSettings.open());
  await settings.getByRole('button', { name: '开始', exact: true }).click();
  await settings.getByTestId('theme-mode-dark').click();
  await expect
    .poll(async () => {
      const s = await pet.evaluate(() => window.petPresentation.getSnapshot());
      return s.ok ? s.value.theme?.appearance : null;
    })
    .toBe('dark');
  report.themeAfter = await pet.evaluate(() => window.petPresentation.getSnapshot());
  await pet.evaluate(() => {
    window.__mvpSpeechChanges = 0;
    window.petSpeechOutput.onChanged(() => {
      window.__mvpSpeechChanges++;
    });
  });
  const speechState = await settings.evaluate(() => window.petSpeechOutput.getSnapshot());
  assert.ok(speechState.ok);
  const s = speechState.value.settings;
  const stopped = await settings.evaluate(
    (request) => window.petSpeechOutput.saveSettings(request),
    {
      expectedRevision: speechState.value.revision,
      enabled: false,
      provider: s.provider,
      voice: s.voice,
      rate: s.rate,
      volume: s.volume,
    },
  );
  assert.ok(stopped.ok);
  await pet.waitForTimeout(700);
  const changes = await pet.evaluate(() => window.__mvpSpeechChanges);
  assert.ok(changes < 8, 'Speech disable notification loop: ' + changes);
  report.speechDisableChanges = changes;
  const stateBefore = await settings.evaluate(() => window.petConsole.getSnapshot());
  assert.ok(stateBefore.ok);
  const voicePlugin = stateBefore.value.plugins.find(
    (row) => row.owner.pluginId === 'pet.voice-chat',
  );
  assert.ok(voicePlugin);
  const disabled = await settings.evaluate(
    (request) => window.petConsole.runPluginAction(request),
    { owner: voicePlugin.owner, action: 'disable' },
  );
  assert.ok(disabled.ok && !disabled.value.operationError);
  await expect
    .poll(async () => {
      const s = await pet.evaluate(() => window.petApplication.getSnapshot());
      return s.ok && s.value.pages.some((row) => row.owner.pluginId === 'pet.voice-chat');
    })
    .toBe(false);
  report.checks.push(
    'theme actual settings selection -> Pet projection',
    'speech disable is responsive and bounded',
    'voice plugin disable retracts its contributed page',
  );
  await pet.screenshot({ path: path.join(out, 'pet-voice-finished.png'), omitBackground: true });
  await settings.screenshot({ path: path.join(out, 'settings-mvp.png') });

  const appArgs = [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=' +
      path.join(root, '.cache/asr-models/sensevoice-small-int8/test_wavs/en.wav'),
    path.join(root, 'apps/desktop'),
    '--demo-acceptance=' + report.profile,
  ];
  await app.close();
  app = null;
  app = await _electron.launch({ executablePath: exe, args: appArgs, env, timeout: 30000 });
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/pet/index.html')), { timeout: 25000 })
    .toBe(true);
  const restartedPet = app.windows().find((p) => p.url().includes('/pet/index.html'));
  await restartedPet.waitForLoadState('domcontentloaded');
  await expect
    .poll(
      async () => {
        const s = await restartedPet.evaluate(() => window.petApplication.getSnapshot());
        return (
          s.ok &&
          s.value.profile?.data.speechEnabled === false &&
          !s.value.pages.some((p) => p.owner.pluginId === 'pet.voice-chat')
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () => {
        const s = await restartedPet.evaluate(() => window.petPresentation.getSnapshot());
        return s.ok ? s.value.theme?.appearance : null;
      },
      { timeout: 10000 },
    )
    .toBe('dark');
  report.restart = {
    application: await restartedPet.evaluate(() => window.petApplication.getSnapshot()),
    speech: await restartedPet.evaluate(() => window.petSpeechOutput.getSnapshot()),
  };
  report.checks.push(
    'restart retains voice module disable, speech preference, theme and history without replay',
  );

  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = String(e);
  if (app) {
    for (const page of app.windows()) {
      if (page.url().includes('/pet/index.html')) {
        report.failureVoice = await page
          .evaluate(() => window.petVoiceInput?.getSnapshot())
          .catch(() => null);
        report.failureApplication = await page
          .evaluate(() => window.petApplication?.getSnapshot())
          .catch(() => null);
      }
      if (page.url().includes('/console/index.html'))
        report.failurePlugins = await page
          .evaluate(() => window.petConsole?.getSnapshot())
          .catch(() => null);
    }
  }
  throw e;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
