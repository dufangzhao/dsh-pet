import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(import.meta.url),
  exe = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const out = path.join(root, '.cache/live-transcript-menu-native');
await fs.mkdir(out, { recursive: true });
const env = {};
for (const k of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
])
  if (process.env[k]) env[k] = process.env[k];
const report = { status: 'running', errors: [], checks: [], profile: 'live-menu-' + Date.now() };
let app;
const value = (r, label) => {
  assert.ok(r.ok, label + ': ' + r.error?.code);
  return r.value;
};
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
  app.context().on('page', (p) => p.on('pageerror', (e) => report.errors.push(String(e))));
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/pet/index.html')), { timeout: 25000 })
    .toBe(true);
  const pet = app.windows().find((p) => p.url().includes('/pet/index.html'));
  await pet.waitForLoadState('domcontentloaded');
  const settings = app.windows().find((p) => p.url().includes('/console/index.html'));
  assert.ok(settings);
  await pet.evaluate(() => window.petSettings.open());
  const state = async () =>
    value(await pet.evaluate(() => window.petApplication.getSnapshot()), 'app');
  const demo = async () => value(await pet.evaluate(() => window.petDemo.getSnapshot()), 'demo');
  const theme = async () =>
    value(await pet.evaluate(() => window.petPresentation.getSnapshot()), 'theme').theme
      ?.appearance;
  await expect.poll(async () => (await state()).agent.state, { timeout: 15000 }).toBe('ready');
  for (let i = 0; i < 8; i++) {
    const d = (await state()).dialog;
    if (!d) break;
    assert.ok(!d.choices.some((c) => c.id === 'allow'));
    const c = d.choices.find((c) => ['later', 'skip', 'deny'].includes(c.id));
    if (!c) break;
    value(
      await pet.evaluate((r) => window.petApplication.answer(r), {
        id: d.id,
        step: d.step,
        choice: c.id,
      }),
      'guide',
    );
  }
  const openMenu = async () => {
    await pet.getByTestId('pet-avatar').click({ button: 'right' });
    await expect(pet.getByTestId('pet-menu')).toBeVisible();
    await pet.waitForTimeout(280);
  };
  await openMenu();
  report.menuBox = await pet.getByTestId('pet-menu').boundingBox();
  assert.ok(Math.abs(report.menuBox.width - 216) < 1);
  assert.ok(Math.abs(report.menuBox.height - 165) < 1);
  if ((await theme()) !== 'dark') {
    await pet.getByTestId('pet-menu-theme').click();
    await expect.poll(theme).toBe('dark');
  }
  await pet
    .getByTestId('pet-menu')
    .screenshot({ path: path.join(out, 'menu-dark.png'), omitBackground: true });
  await pet.getByTestId('pet-menu-theme').click();
  await expect.poll(theme).toBe('light');
  await pet
    .getByTestId('pet-menu')
    .screenshot({ path: path.join(out, 'menu-light.png'), omitBackground: true });
  await pet.getByTestId('pet-menu-pause').click();
  await expect.poll(async () => (await demo()).paused).toBe(true);
  await expect(pet.getByTestId('pet-menu-pause')).toHaveAttribute('aria-label', '继续运行');
  await pet.getByTestId('pet-menu-pause').click();
  await expect.poll(async () => (await demo()).paused).toBe(false);
  const sound = (await state()).profile.data.soundEnabled;
  await pet.getByTestId('pet-menu-sound').click();
  await expect.poll(async () => (await state()).profile.data.soundEnabled).toBe(!sound);
  await expect(pet.getByTestId('pet-menu-sound')).toHaveAttribute('aria-pressed', String(!sound));
  await pet.getByTestId('pet-menu-sound').click();
  await expect.poll(async () => (await state()).profile.data.soundEnabled).toBe(sound);
  await pet.getByTestId('pet-menu-appearance').click();
  await expect(settings.getByRole('heading', { name: '装扮', exact: true })).toBeVisible();
  await openMenu();
  await pet.getByTestId('pet-menu-hide').click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('/pet/index.html'))
          .isVisible(),
      ),
    )
    .toBe(false);
  let a = value(await settings.evaluate(() => window.petApplication.getSnapshot()), 'profile');
  value(
    await settings.evaluate((r) => window.petApplication.saveProfile(r), {
      expectedRevision: a.profile.revision,
      data: { ...a.profile.data, visible: true },
    }),
    'restore visibility',
  );
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('/pet/index.html'))
          .isVisible(),
      ),
    )
    .toBe(true);
  await openMenu();
  await pet.getByTestId('pet-menu-chat').click();
  await expect(pet.getByTestId('pet-composer-input')).toBeVisible();
  await pet.getByTestId('pet-composer-input').press('Escape');
  await openMenu();
  if (!(await state()).profile.data.voiceEnabled) {
    await pet.getByTestId('pet-menu-voice').click();
    await expect
      .poll(async () => (await state()).profile.data.voiceEnabled, { timeout: 15000 })
      .toBe(true);
  } else {
    await pet.getByTestId('pet-menu-voice').click();
    await expect.poll(async () => (await state()).profile.data.voiceEnabled).toBe(false);
    await expect(pet.getByTestId('pet-menu-voice')).toHaveAttribute('aria-pressed','false');
    await pet.getByTestId('pet-menu-voice').click();
    await expect
      .poll(async () => (await state()).profile.data.voiceEnabled, { timeout: 15000 })
      .toBe(true);
  }
  await expect.poll(async () => (await demo()).canRecord, { timeout: 15000 }).toBe(true);
  await pet.keyboard.press('Escape');
  report.checks.push(
    '216x165 dark/light compact menu with real theme, pause, sound, visibility, appearance, chat and voice actions',
  );
  await settings.getByRole('button', { name: '语音输入', exact: true }).click();
  const auto = settings.getByTestId('demo-auto-send');
  if (!(await auto.isChecked())) await auto.check();
  a = await state();
  value(
    await settings.evaluate((r) => window.petApplication.saveProfile(r), {
      expectedRevision: a.profile.revision,
      data: { ...a.profile.data, statusBubble: false, saidBubble: false },
    }),
    'transcript independent switches',
  );
  await pet.getByTestId('pet-avatar').hover();
  await pet.getByTestId('pet-mic').click();
  await expect.poll(async () => (await demo()).phase, { timeout: 15000 }).toBe('recording');
  report.partials = [];
  const started = Date.now();
  while (Date.now() - started < 9000) {
    const s = await demo();
    assert.equal(s.phase, 'recording', 'ASR partial must not end capture');
    if (
      s.partialTranscript.trim() &&
      !report.partials.some((p) => p.text === s.partialTranscript)
    ) {
      report.partials.push({ at: Date.now() - started, text: s.partialTranscript });
    }
    const security = value(
      await settings.evaluate(() => window.petConsole.getSecurity()),
      'security',
    );
    assert.equal(security.pending.length, 0);
    await pet.waitForTimeout(150);
  }
  assert.ok(report.partials.length >= 2, 'Need multiple true intermediate hypotheses before stop');
  await expect(pet.getByTestId('pet-transcript')).toBeVisible();
  await expect
    .poll(async () => {
      const s = await demo();
      const raw = await pet
        .getByTestId('pet-transcript')
        .locator('.pet-bubble__line')
        .getAttribute('aria-label');
      return raw === s.partialTranscript.trim();
    })
    .toBe(true);
  await pet.screenshot({ path: path.join(out, 'live-transcript.png'), omitBackground: true });
  await pet.getByTestId('pet-mic').click();
  await expect.poll(async () => (await demo()).phase, { timeout: 30000 }).toBe('idle');
  const final = await demo();
  assert.ok(final.transcript.trim());
  await expect(pet.getByTestId('pet-transcript')).toBeVisible();
  await expect(pet.getByTestId('pet-transcript').locator('.pet-bubble__line')).toHaveAttribute(
    'aria-label',
    final.transcript.trim(),
  );
  await expect(pet.getByTestId('pet-transcript')).toContainText('识别结果');
  report.finalTranscript = final.transcript;
  const history = (await state()).history;
  assert.equal(history.filter((r) => r.kind === 'user' && r.via === 'voice').length, 1);
  assert.equal(history.filter((r) => r.kind === 'pet' && r.via === 'voice').length, 1);
  await pet.screenshot({ path: path.join(out, 'final-transcript.png'), omitBackground: true });
  report.checks.push(
    'real SenseVoice interim text before capture stop with recording phase preserved',
    'final transcript remains visible with both ordinary bubble switches off',
    'one voice input and one Core reply',
  );
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = String(e);
  if (app) {
    const p = app.windows().find((p) => p.url().includes('/pet/index.html'));
    if (p) {
      report.demo = await p.evaluate(() => window.petDemo.getSnapshot()).catch(() => null);
      report.dom = await p
        .locator('body')
        .innerText()
        .catch(() => null);
      await p
        .screenshot({ path: path.join(out, 'failure.png'), omitBackground: true, timeout: 5000 })
        .catch(() => {});
    }
  }
  throw e;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
