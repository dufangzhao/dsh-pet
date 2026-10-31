/* global window, document */
import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const out = path.join(root, 'qa/minimal-settings-native');
await fs.mkdir(out, { recursive: true });
const report = {
  scope:
    'Actual Electron settings, isolated profile, local preferences/theme/pet effects; no online model or microphone calls',
  pages: [],
  cases: [],
  approvals: [],
  pageErrors: [],
};
let app, page, pet;
const unwrap = (result) => {
  assert.ok(result?.ok, JSON.stringify(result?.error));
  return result.value;
};
const snapshot = async () => unwrap(await page.evaluate(() => window.petApplication.getSnapshot()));
async function settle(read, expected) {
  await expect
    .poll(
      async () => {
        const security = unwrap(await page.evaluate(() => window.petConsole.getSecurity()));
        if (security.pending[0]) {
          const pending = security.pending[0];
          assert.ok(pending.owner.pluginId.startsWith('pet.'), 'Unexpected owner');
          assert.ok(
            ['files', 'capability-use'].includes(pending.permission.kind),
            'Unexpected permission',
          );
          await expect(pet.getByTestId('pet-dialog')).toHaveAttribute('data-busy', 'false');
          await pet.getByTestId('pet-dialog-choice-allow').click();
          report.approvals.push({ owner: pending.owner.pluginId, kind: pending.permission.kind });
        }
        return read();
      },
      { timeout: 15000 },
    )
    .toEqual(expected);
}
const go = (label) =>
  page.getByTestId('settings-nav').getByRole('button', { name: label, exact: true }).click();
try {
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
  app = await _electron.launch({
    executablePath: path.join(
      path.dirname(require.resolve('electron/package.json')),
      'dist/electron.exe',
    ),
    args: [
      '--no-sandbox',
      path.join(root, 'apps/desktop/dist/main/index.mjs'),
      '--demo-acceptance=minimal-ui-' + Date.now(),
      '--show-settings',
    ],
    env,
    cwd: root,
    timeout: 30000,
  });
  await expect
    .poll(() => app.windows().filter((w) => w.url().includes('/console/')).length, {
      timeout: 30000,
    })
    .toBe(1);
  page = app.windows().find((w) => w.url().includes('/console/'));
  pet = app.windows().find((w) => w.url().includes('/pet/'));
  assert.ok(page && pet);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.waitForFunction(
    () => !!window.petApplication && !!window.petModels && !!window.petConsole,
  );
  const pages = [
    ['start', '开始'],
    ['persona', '人设'],
    ['appearance', '装扮'],
    ['conversation', '对话'],
    ['voice', '语音输入'],
    ['plugins', '扩展'],
    ['permissions', '权限与数据'],
    ['about', '关于'],
  ];
  for (const width of [1200, 880]) {
    await page.setViewportSize({ width, height: width === 1200 ? 900 : 760 });
    for (const [id, label] of pages) {
      await go(label);
      await expect(
        page
          .getByTestId('settings-main')
          .getByRole('heading', { name: label, exact: true })
          .first(),
      ).toBeVisible();
      await page.getByTestId('settings-main').evaluate((el) => {
        el.scrollTop = 0;
      });
      const overflow = await page
        .getByTestId('settings-main')
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, id + ' horizontal overflow at ' + width);
      await page.screenshot({ path: path.join(out, id + '-' + width + '.png') });
      report.pages.push({ id, width, overflow });
    }
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  await go('人设');
  await page.getByLabel('它的名字', { exact: true }).fill('界面验收小蓝');
  await page.getByRole('button', { name: '保存名字', exact: true }).click();
  await settle(async () => (await snapshot()).profile?.data.petName, '界面验收小蓝');
  report.cases.push('persona name saves through the original profile owner');
  await go('装扮');
  await page.getByTestId('pref-figure-round').click();
  await settle(async () => (await snapshot()).profile?.data.figure, 'round');
  report.cases.push('appearance selection saves through the original profile owner');
  await go('开始');
  await expect(page.getByTestId('start-theme')).toBeVisible();
  await expect(page.locator('#start-pet-card input[role=switch]')).toHaveCount(0);
  await page.getByTestId('theme-mode-dark').check();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.getByTestId('theme-mode-light').check();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('light');
  await page.reload();
  await page.waitForFunction(() => !!window.petApplication);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('light');
  await expect.poll(async () => (await snapshot()).profile?.data.petName).toBe('界面验收小蓝');
  await expect.poll(async () => (await snapshot()).profile?.data.figure).toBe('round');
  report.cases.push(
    'theme mode and saved profile survive reloading the exact trusted settings URL',
  );
  await expect(page.getByTestId('pet-hide')).toBeEnabled();
  await page.getByTestId('pet-hide').click();
  await settle(async () => (await snapshot()).desktop?.shown, false);
  await page.getByTestId('pet-show').click();
  await settle(async () => (await snapshot()).desktop?.shown, true);
  report.cases.push('wide preview hide and show use the real desktop window owner');
  const before = (await snapshot()).cursor;
  await page.getByTestId('pet-poke').click();
  await settle(
    async () =>
      (await snapshot()).history.some((item) => item.cursor > before && item.reaction === 'poke'),
    true,
  );
  report.cases.push('clicking the actual avatar still writes a real pet interaction');
  await page.locator('#start-pet-card').screenshot({ path: path.join(out, 'start-pet-wide.png') });
  await page
    .getByTestId('start-theme')
    .screenshot({ path: path.join(out, 'start-interface-theme.png') });
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
}
