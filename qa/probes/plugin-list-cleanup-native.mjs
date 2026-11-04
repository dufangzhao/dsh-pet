import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const exe = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const out = path.join(root, '.cache/plugin-list-cleanup-native');
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
]) {
  if (process.env[key]) env[key] = process.env[key];
}
const report = {
  status: 'running',
  checks: [],
  screenshots: [],
  errors: [],
  profile: 'plugin-list-' + Date.now(),
};
let app;
let page;
const value = (result) => {
  assert.ok(result.ok, result.error?.code);
  return result.value;
};
try {
  app = await _electron.launch({
    executablePath: exe,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), '--demo-acceptance=' + report.profile],
    env,
    timeout: 30000,
  });
  const watch = (target) => target.on('pageerror', (error) => report.errors.push(String(error)));
  app.context().on('page', watch);
  app.windows().forEach(watch);
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/pet/index.html')), { timeout: 25000 })
    .toBe(true);
  const pet = app.windows().find((p) => p.url().includes('/pet/index.html'));
  assert.ok(pet);
  await pet.waitForLoadState('domcontentloaded');
  value(await pet.evaluate(() => window.petSettings.open()));
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/console/index.html')))
    .toBe(true);
  page = app.windows().find((p) => p.url().includes('/console/index.html'));
  assert.ok(page);
  await page.bringToFront();
  page.setDefaultTimeout(10000);
  const snapshot = async () => value(await page.evaluate(() => window.petConsole.getSnapshot()));
  const plugin = async (id) =>
    (await snapshot()).plugins.find((entry) => entry.owner.pluginId === id);
  const card = (id) => page.locator('[data-plugin-id="' + id + '"]');
  const primary = (id) => card(id).locator('.plugin-card__open');
  const showList = async () => {
    await page.getByRole('button', { name: '插件', exact: true }).click();
    await expect(page.locator('.plugin-card').first()).toBeVisible();
  };
  const capture = async (name) => {
    const notices = page.getByRole('button', { name: /^关闭提示：/ });
    while (await notices.count()) await notices.first().click();
    await page.locator('.page__title').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, name + '.png') });
    report.screenshots.push(name + '.png');
  };
  await showList();
  // Startup enables local ASR after the console's initial snapshot. Read the
  // settled target through the existing refresh control before comparing it.
  await expect
    .poll(async () => (await plugin('pet.asr-local'))?.desiredActive, { timeout: 25000 })
    .toBe(true);
  await page.getByTestId('console-refresh').click();
  await expect(page.getByTestId('console-refresh')).toBeEnabled();
  report.initialPlugins = (await snapshot()).plugins.map(
    ({ owner, state, desiredActive, protected: protectedPlugin }) => ({
      id: owner.pluginId,
      state,
      desiredActive,
      protected: protectedPlugin,
    }),
  );
  report.lifecycleCoverage = {
    observedStates: [...new Set(report.initialPlugins.map((entry) => entry.state))],
    protectedCount: report.initialPlugins.filter((entry) => entry.protected).length,
  };
  for (const entry of report.initialPlugins) {
    await expect(card(entry.id).getByRole('switch')).toHaveCount(1);
    await expect(card(entry.id).getByRole('switch')).toBeChecked({ checked: entry.desiredActive });
    if (entry.protected) {
      await expect(card(entry.id).getByRole('switch')).toBeDisabled();
      await expect(card(entry.id).getByRole('button', { name: /删除|卸载/ })).toHaveCount(0);
    }
  }
  assert.ok(!(await page.locator('body').innerText()).includes('声明的权限'));
  assert.ok(!(await page.locator('body').innerText()).includes('随应用提供，可单独启用或停用'));
  await expect(page.locator('[data-testid^="plugin-config-"]')).toHaveCount(0);
  report.checks.push(
    'All installed switches match authoritative desiredActive; removed copy/config buttons are absent.',
  );

  const toneId = 'pet.builtin-speech';
  const switcher = card(toneId).getByRole('switch');
  await expect(switcher).toBeChecked();
  await switcher.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(switcher).toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await plugin(toneId)).desiredActive, true);
  await expect(switcher).toBeFocused();
  await switcher.press('Space');
  await page.getByRole('dialog').getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(switcher).not.toBeChecked();
  await expect
    .poll(async () => {
      const entry = await plugin(toneId);
      return { state: entry.state, desiredActive: entry.desiredActive };
    })
    .toEqual({ state: 'disabled', desiredActive: false });
  await switcher.press('Space');
  await expect(switcher).toBeChecked();
  await expect
    .poll(async () => {
      const entry = await plugin(toneId);
      return { state: entry.state, desiredActive: entry.desiredActive };
    })
    .toEqual({ state: 'active', desiredActive: true });
  await expect(page.locator('.plugin-card').first()).toBeVisible();
  report.checks.push(
    'Cancel keeps the real enabled target and restores focus; keyboard switch disable/enable reaches actual disabled/active host state without navigation.',
  );

  const voiceId = 'pet.voice-chat';
  // A card's otherwise-empty corner must activate its stretched native button.
  await card(voiceId).click({ position: { x: 12, y: 12 } });
  await expect(page.getByRole('region', { name: '语音输入', exact: true })).toBeVisible();
  await expect(page.locator('.plugin-card')).toHaveCount(0);
  await showList();
  await primary(voiceId).focus();
  await primary(voiceId).press('Space');
  await expect(page.getByRole('region', { name: '语音输入', exact: true })).toBeVisible();
  await showList();
  const localId = 'pet.asr-local';
  await primary(localId).focus();
  await page.keyboard.press('Tab');
  await expect(card(localId).getByRole('switch')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(primary(localId)).toBeFocused();
  await primary(localId).press('Enter');
  await expect(page.getByRole('heading', { name: '本地语音识别', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '配置项', exact: true })).toBeVisible();
  await expect(page.getByTestId('config-form')).toBeVisible();
  report.checks.push(
    'Card whitespace and Space open the owned settings page; Tab order and Enter open the existing schema form without a separate config button.',
  );
  await showList();

  const legacyId = 'pet.chat';
  const remove = card(legacyId).getByRole('button', { name: /删除|卸载/ });
  assert.equal((await remove.innerText()).trim(), '', 'Uninstall is icon-only');
  assert.ok(await remove.getAttribute('aria-label'), 'Uninstall has an accessible name');
  await remove.focus();
  await remove.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(card(legacyId)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '确认卸载', exact: true }).click();
  await expect(card(legacyId)).toHaveCount(0);
  assert.equal(await plugin(legacyId), undefined);
  report.checks.push(
    'Accessible icon-only uninstall reaches the actual host removal path and never opens configuration.',
  );

  const chooseMode = async (mode) => {
    await page
      .getByRole('navigation', { name: '设置页导航' })
      .getByRole('button', { name: '开始', exact: true })
      .click();
    await page.getByTestId('theme-mode-' + mode).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await showList();
  };
  const colors = () =>
    page
      .locator('.plugin-card')
      .first()
      .evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        color: getComputedStyle(element).color,
      }));
  await chooseMode('light');
  report.light = await colors();
  await capture('plugins-light');
  await chooseMode('dark');
  report.dark = await colors();
  assert.notDeepEqual(report.light, report.dark);
  await capture('plugins-dark');
  await page
    .getByRole('navigation', { name: '设置页导航' })
    .getByRole('button', { name: '开始', exact: true })
    .click();
  await page.getByTestId('theme-studio').locator('summary').click();
  await page.getByTestId('theme-scheme-name').fill('插件验收配色');
  await page.getByTestId('theme-copy').click();
  await page.getByTestId('theme-token-sheet-hex').fill('#283747');
  await page.getByTestId('theme-save').click();
  await showList();
  await expect.poll(async () => (await colors()).background).toBe('rgb(40, 55, 71)');
  report.custom = await colors();
  await capture('plugins-custom');
  await page.reload();
  await showList();
  await expect.poll(async () => (await colors()).background).toBe('rgb(40, 55, 71)');
  report.checks.push(
    'Light/dark palettes differ; an actual saved custom card-surface color survives navigation and reload through the existing theme store.',
  );

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((target) =>
      target.webContents.getURL().includes('/console/index.html'),
    );
    if (!window) throw new Error('Missing console window');
    window.setSize(880, 600);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(880);
  report.viewport = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.plugin-card')];
    const outside = [];
    for (const card of cards) {
      const bounds = card.getBoundingClientRect();
      for (const control of card.querySelectorAll('button, input')) {
        const child = control.getBoundingClientRect();
        if (child.width && (child.left < bounds.left - 1 || child.right > bounds.right + 1)) {
          outside.push(control.getAttribute('aria-label') ?? control.textContent);
        }
      }
    }
    return {
      width: innerWidth,
      height: innerHeight,
      scroll: document.documentElement.scrollWidth,
      outside,
    };
  });
  assert.ok(report.viewport.scroll <= report.viewport.width);
  assert.deepEqual(report.viewport.outside, []);
  report.motion = await card('pet.voice-chat')
    .locator('.switch > i')
    .evaluate((element) => ({
      trackTransition: getComputedStyle(element).transitionDuration,
      trackAnimation: getComputedStyle(element).animationName,
      thumbTransition: getComputedStyle(element, '::after').transitionDuration,
      thumbAnimation: getComputedStyle(element, '::after').animationName,
    }));
  assert.deepEqual(report.motion, {
    trackTransition: '0s',
    trackAnimation: 'none',
    thumbTransition: '0s',
    thumbAnimation: 'none',
  });
  await capture('plugins-compact');
  await primary('pet.voice-chat').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  report.focus = await primary('pet.voice-chat').evaluate((element) => ({
    focused: element.matches(':focus-visible'),
    outline: getComputedStyle(element, '::after').outlineStyle,
  }));
  assert.equal(report.focus.focused, true);
  assert.equal(report.focus.outline, 'solid');
  await primary('pet.voice-chat').press('Space');
  await expect(page.getByRole('region', { name: '语音输入', exact: true })).toBeVisible();
  report.checks.push(
    'At the native 880x600 minimum window, cards and controls remain contained, keyboard navigation remains usable, and reduced-motion mode is respected.',
  );
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  if (page) {
    report.dom = await page
      .locator('body')
      .innerText()
      .catch(() => null);
    await page.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 }).catch(() => {});
  }
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
