/* global window */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'qa/minimal-settings-preview/screenshots');
const report = {
  scope: 'standalone persona HTML preview only',
  checks: [],
  pageErrors: [],
  remoteRequests: [],
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    window.__personaAudioContexts = 0;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        window.__personaAudioContexts++;
      }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.remoteRequests.push(request.url());
  });
  await page.goto(pathToFileURL(path.join(root, 'qa/minimal-settings-preview/index.html')).href);
  await page.locator('[data-nav=persona]').click();
  const habits = page.getByRole('tab', { name: '习惯设置', exact: true });
  const templates = page.getByRole('tab', { name: '人格模板', exact: true });
  await expect(habits).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#persona-habits')).toBeVisible();
  await expect(page.locator('#persona-templates')).toBeHidden();
  await expect(page.locator('[data-persona-custom=wake]')).toBeHidden();
  await page.locator('#persona-wake').selectOption('custom');
  await expect(page.locator('[data-persona-custom=wake]')).toBeVisible();
  await page.locator('[data-pref=wakePat]').check();
  await page.locator('#persona-self').selectOption('custom');
  await expect(page.locator('[data-persona-custom=self] input')).toHaveCount(11);
  const hover = page.locator('[data-pref-group=hover]');
  for (const value of ['roam', 'theme', 'sound', 'dress'])
    await hover.locator('input[value=' + value + ']').check();
  await expect(hover.locator('input[value=hide]')).toBeDisabled();
  await hover.locator('input[value=dress]').uncheck();
  await expect(hover.locator('input[value=hide]')).toBeEnabled();
  report.checks.push('custom behavior controls and six-button hover limit');
  await habits.focus();
  await page.keyboard.press('ArrowRight');
  await expect(templates).toBeFocused();
  await expect(templates).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#persona-habits')).toBeHidden();
  const prompt = page.locator('#persona-prompt');
  const edited = '这是未保存的本地人格草稿。';
  await prompt.fill(edited);
  await habits.click();
  await expect(page.locator('[data-pref=wakePat]')).toBeChecked();
  await templates.click();
  await expect(prompt).toHaveValue(edited);
  await page.locator('#persona-template-select').selectOption('warm');
  await expect(prompt).not.toHaveValue(edited);
  await prompt.fill('温柔模板的独立草稿');
  await page.locator('#persona-template-select').selectOption('default');
  await expect(prompt).toHaveValue(edited);
  await page.locator('[data-persona-action=copy]').click();
  await expect(prompt).toHaveValue(edited);
  await expect(page.locator('#persona-template-select option')).toHaveCount(5);
  await page.locator('[data-persona-action=new]').click();
  await expect(prompt).toHaveValue('');
  await prompt.fill('新的模板草稿');
  await page.locator('[data-persona-action=save]').click();
  await expect(page.locator('#persona-draft-state')).toHaveText('本次预览草稿已保留');
  await page.locator('#persona-template-select').selectOption('warm');
  await expect(prompt).toHaveValue('温柔模板的独立草稿');
  await page.locator('[data-persona-action=reset]').click();
  await expect(prompt).not.toHaveValue('温柔模板的独立草稿');
  report.checks.push(
    'top tabs preserve drafts; each template draft is independent; copy/new/reset stay local',
  );
  await habits.click();
  const sound = page.locator('#persona-sound-card');
  await expect(sound.locator('#persona-voice')).toHaveValue('builtin');
  await expect(page.locator('#persona-templates #persona-voice')).toHaveCount(0);
  await expect(page.locator('#persona-pitch-level')).toBeDisabled();
  await page.locator('[data-pref=soundEnabled]').uncheck();
  await expect(page.locator('[data-pref=soundTalk]')).toBeDisabled();
  await expect(page.locator('#persona-voice')).toBeDisabled();
  await expect(page.locator('[data-persona-action=preview-sound]')).toBeDisabled();
  assert.equal(await page.evaluate(() => window.__personaAudioContexts), 0);
  await page.locator('[data-pref=soundEnabled]').check();
  await page.locator('[data-pref=speechEnabled]').check();
  await expect(page.locator('#persona-pitch-level')).toBeEnabled();
  await page.locator('#persona-pitch-level').selectOption('high');
  await expect(page.locator('#persona-pitch')).toHaveValue('500');
  await page.locator('#persona-pitch').fill('450');
  await expect(page.locator('#persona-pitch-level')).toHaveValue('custom');
  await page.locator('[data-persona-action=preview-sound]').click();
  await expect.poll(() => page.evaluate(() => window.__personaAudioContexts)).toBe(1);
  await expect(page.locator('[data-persona-action=preview-sound]')).toBeEnabled();
  report.checks.push(
    'default speaking sound belongs to sound; master/talk/speech dependencies; sound only on explicit click',
  );
  for (const width of [1200, 880, 1142]) {
    await page.setViewportSize({ width, height: width === 880 ? 760 : width === 1142 ? 804 : 900 });
    for (const [tab, id] of [
      [habits, 'habits'],
      [templates, 'templates'],
    ]) {
      await tab.click();
      await page.locator('#settings-content').evaluate((el) => {
        el.scrollTop = 0;
      });
      const geometry = await page.evaluate(() => {
        const host = window.document.getElementById('settings-content'),
          box = host.getBoundingClientRect();
        return {
          overflow: host.scrollWidth > host.clientWidth,
          escaped: Array.from(host.querySelectorAll('input,select,textarea,button'))
            .filter((el) => el.checkVisibility())
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1);
            })
            .map((el) => el.id || el.textContent),
        };
      });
      assert.equal(geometry.overflow, false, id + ' overflow ' + width);
      assert.deepEqual(geometry.escaped, [], id + ' escaped controls ' + width);
      await page.screenshot({ path: path.join(out, 'persona-' + id + '-' + width + '.png') });
    }
  }
  await page.setViewportSize({ width: 1200, height: 1200 });
  await habits.click();
  await page
    .locator('#persona-sound-card')
    .screenshot({ path: path.join(out, 'persona-sound.png') });
  const ids = await page.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length]),
    [0, 0],
  );
  assert.deepEqual(report.remoteRequests, []);
  assert.deepEqual(report.pageErrors, []);
  await page.reload();
  await page.locator('[data-nav=persona]').click();
  await templates.click();
  await expect(page.locator('#persona-template-select option')).toHaveCount(4);
  await expect(prompt).not.toHaveValue(edited);
  report.checks.push(
    'both panels fit wide/narrow widths; no duplicate IDs, storage, remote requests, app calls or microphone use',
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'persona-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
