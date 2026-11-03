import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(import.meta.url),
  exe = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const out = path.join(root, '.cache/bubble-replica-native');
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
const report = { status: 'running', checks: [], errors: [], profile: 'bubble-' + Date.now() };
let app;
const value = (r, label) => {
  assert.ok(r.ok, label + ': ' + r.error?.code);
  return r.value;
};
try {
  app = await _electron.launch({
    executablePath: exe,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), '--demo-acceptance=' + report.profile],
    env,
    timeout: 30000,
  });
  app.context().on('page', (p) => p.on('pageerror', (e) => report.errors.push(String(e))));
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/pet/index.html')), { timeout: 25000 })
    .toBe(true);
  const pet = app.windows().find((p) => p.url().includes('/pet/index.html'));
  await pet.waitForLoadState('domcontentloaded');
  await pet.emulateMedia({ reducedMotion: 'no-preference' });
  const settings = app.windows().find((p) => p.url().includes('/console/index.html'));
  assert.ok(settings);
  await pet.evaluate(() => window.petSettings.open());
  await expect
    .poll(
      async () => {
        const s = await pet.evaluate(() => window.petApplication.getSnapshot());
        return s.ok && s.value.agent.state === 'ready';
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const security = async () =>
    value(await settings.evaluate(() => window.petConsole.getSecurity()), 'security');
  const initial = await security();
  assert.equal(initial.pending.length, 0);
  assert.ok(initial.plugins.every((p) => p.preset === 'allow'));
  report.presets = initial.plugins.map((p) => ({ id: p.owner.pluginId, preset: p.preset }));
  const speech = value(
    await settings.evaluate(() => window.petSpeechOutput.getSnapshot()),
    'speech',
  );
  await settings.evaluate((request) => window.petSpeechOutput.saveSettings(request), {
    expectedRevision: speech.revision,
    enabled: false,
    provider: speech.settings.provider,
    voice: speech.settings.voice,
    rate: speech.settings.rate,
    volume: speech.settings.volume,
  });
  for (let i = 0; i < 8; i++) {
    const s = value(await pet.evaluate(() => window.petApplication.getSnapshot()), 'application');
    if (!s.dialog) break;
    assert.ok(!s.dialog.choices.some((c) => c.id === 'allow'));
    const c = s.dialog.choices.find((c) => ['later', 'skip', 'deny'].includes(c.id));
    if (!c) break;
    await pet.evaluate((r) => window.petApplication.answer(r), {
      id: s.dialog.id,
      step: s.dialog.step,
      choice: c.id,
    });
  }
  const avatar = pet.getByTestId('pet-avatar');
  await avatar.focus();
  report.avatarFocus = await avatar.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
  });
  assert.equal(report.avatarFocus.outlineStyle, 'none');
  report.checks.push('selected pet has no rectangular focus outline');
  const pickTheme = async (mode) => {
    await settings.getByRole('button', { name: '开始', exact: true }).click();
    await settings.getByTestId('theme-mode-' + mode).click();
    await expect
      .poll(
        async () =>
          value(await pet.evaluate(() => window.petPresentation.getSnapshot()), 'theme').theme
            ?.appearance,
      )
      .toBe(mode);
  };
  await pickTheme('dark');
  await avatar.hover();
  await pet.getByTestId('pet-chat').click();
  await expect(pet.getByTestId('pet-composer')).toBeVisible();
  const frame = pet.getByTestId('pet-composer');
  report.popup = [];
  for (const delay of [0, 80, 240]) {
    if (delay) await pet.waitForTimeout(delay);
    report.popup.push(
      await frame.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          transform: s.transform,
          animation: s.animationName,
          duration: s.animationDuration,
        };
      }),
    );
  }
  const dimensions = async () => ({
    wrapper: await pet.locator('.pet-root__compose').boundingBox(),
    frame: await frame.boundingBox(),
    field: await pet.locator('.pet-bubble__compose').boundingBox(),
    send: await pet.getByTestId('pet-composer-send').boundingBox(),
  });
  report.darkGeometry = await dimensions();
  assert.ok(Math.abs(report.darkGeometry.wrapper.width - 252) < 1);
  assert.ok(Math.abs(report.darkGeometry.wrapper.height - 71) < 1);
  assert.ok(Math.abs(report.darkGeometry.frame.width - 246) < 1);
  assert.ok(Math.abs(report.darkGeometry.frame.height - 60) < 1);
  assert.ok(Math.abs(report.darkGeometry.field.width - 196) < 1);
  assert.ok(Math.abs(report.darkGeometry.field.height - 36) < 1);
  assert.ok(Math.abs(report.darkGeometry.send.width - 44) < 1);
  await pet
    .locator('.pet-root__compose')
    .screenshot({ path: path.join(out, 'composer-dark.png'), omitBackground: true });
  await pet.screenshot({ path: path.join(out, 'pet-dark.png'), omitBackground: true });
  await pickTheme('light');
  await pet.waitForTimeout(100);
  report.lightGeometry = await dimensions();
  assert.equal(report.lightGeometry.wrapper.width, report.darkGeometry.wrapper.width);
  assert.equal(report.lightGeometry.wrapper.height, report.darkGeometry.wrapper.height);
  await pet
    .locator('.pet-root__compose')
    .screenshot({ path: path.join(out, 'composer-light.png'), omitBackground: true });
  report.checks.push('252x71 dark reference geometry and matching light composer');
  const input = pet.getByTestId('pet-composer-input');
  await input.fill('同一份草稿');
  await input.evaluate((el) => {
    el.dataset.qaOriginal = 'true';
  });
  await pet.getByTestId('pet-composer-expand').click();
  await expect(pet.getByTestId('pet-composer-expand')).toHaveAttribute('aria-expanded', 'true');
  assert.equal(await input.getAttribute('data-qa-original'), 'true');
  await expect(input).toHaveValue('同一份草稿');
  await pet.getByTestId('pet-composer-expand').click();
  await expect(input).toHaveValue('同一份草稿');
  await input.press('Shift+Enter');
  await expect(pet.getByTestId('pet-composer-expand')).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toHaveValue('同一份草稿' + String.fromCharCode(10));
  await pet.getByTestId('pet-composer-close').click();
  report.closing = await pet.locator('.pet-root__compose').evaluate((el) => ({
    inert: el.inert,
    hidden: el.getAttribute('aria-hidden'),
    closing: el.dataset.closing,
  }));
  assert.equal(report.closing.inert, true);
  assert.equal(report.closing.closing, 'true');
  await pet.waitForTimeout(230);
  await expect(frame).toHaveCount(0);
  report.checks.push('single textarea expansion, ShiftEnter and immediate inert closing');
  await pickTheme('dark');
  await avatar.hover();
  await pet.getByTestId('pet-chat').click();
  await input.fill('你好，测试一下逐字气泡');
  await input.press('Enter');
  const bubble = pet.getByTestId('pet-bubble');
  await expect(bubble).toBeVisible();
  await expect
    .poll(
      async () => {
        const h = value(await pet.evaluate(() => window.petApplication.getSnapshot()), 'history');
        return h.history.findLast((r) => r.kind === 'pet')?.text ?? null;
      },
      { timeout: 10000 },
    )
    .not.toBe(null);
  const history = value(await pet.evaluate(() => window.petApplication.getSnapshot()), 'history');
  const reply = history.history.findLast((r) => r.kind === 'pet')?.text;
  assert.ok(reply);
  const labelledReply = '脚本演示｜' + reply;
  await expect(pet.locator('.pet-bubble__line')).toHaveAttribute('aria-label', labelledReply);
  report.reveal = [];
  for (const delay of [0, 100, 250]) {
    if (delay) await pet.waitForTimeout(delay);
    report.reveal.push(await pet.locator('.pet-bubble__text').innerText());
  }
  assert.ok(
    report.reveal.every((t) => labelledReply.startsWith(t)),
    'Samples must belong to the reply, not a thinking notice',
  );
  assert.ok(
    report.reveal.some((t) => t.length > 0 && t.length < labelledReply.length),
    'Native typewriter must reveal a real prefix',
  );
  assert.ok(
    report.reveal.at(-1).length > report.reveal[0].length,
    'Real reply must advance on screen',
  );
  await expect(pet.locator('.pet-bubble__text')).toHaveText(labelledReply, { timeout: 10000 });
  await pet.screenshot({ path: path.join(out, 'reply-dark.png'), omitBackground: true });
  await pet.getByTestId('pet-bubble-dismiss').click();
  await pet.waitForTimeout(230);
  await expect(bubble).toHaveCount(0);
  report.checks.push('real host reply reveals progressively and closes');
  await pet.evaluate(() => window.petApplication.startGuide());
  await expect(pet.getByTestId('pet-dialog')).toBeVisible();
  await pet.waitForTimeout(350);
  await pet.screenshot({ path: path.join(out, 'choices-dark.png'), omitBackground: true });
  const completeDialog = await pet.getByTestId('pet-dialog-text').getAttribute('aria-label');
  await expect(pet.getByTestId('pet-dialog-text').locator('span')).toHaveText(completeDialog, {
    timeout: 10000,
  });
  await pet.screenshot({ path: path.join(out, 'choices-dark-complete.png'), omitBackground: true });
  await pickTheme('light');
  await pet.waitForTimeout(100);
  await pet.screenshot({ path: path.join(out, 'choices-light.png'), omitBackground: true });
  await pickTheme('dark');
  await pet.getByTestId('pet-dialog-dismiss').click();
  await pet.waitForTimeout(220);
  await pet.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pet.getByTestId('pet-stage')).toHaveAttribute('data-reduced-motion', 'true');
  await pet.evaluate(() => window.petApplication.startGuide());
  await expect(pet.getByTestId('pet-dialog')).toBeVisible();
  const reduced = await pet.getByTestId('pet-dialog-text').evaluate((el) => ({
    text: el.querySelector('span')?.textContent,
    label: el.getAttribute('aria-label'),
  }));
  assert.equal(reduced.text, reduced.label);
  report.reducedMotion = reduced;
  report.checks.push('ordinary choices retain real actions; reduced motion presents full text');
  assert.equal((await security()).pending.length, 0);
  assert.equal(report.errors.length, 0);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = String(e);
  if (app) {
    const pet = app.windows().find((p) => p.url().includes('/pet/index.html'));
    if (pet) {
      report.dom = await pet
        .locator('body')
        .innerText()
        .catch(() => null);
      await pet
        .screenshot({ path: path.join(out, 'failure.png'), omitBackground: true, timeout: 5000 })
        .catch(() => {});
    }
  }
  throw e;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
