/* global window */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'qa/minimal-settings-preview/screenshots');
const report = {
  scope: 'local plugin-owned settings navigation, no runtime integration',
  checks: [],
  errors: [],
  requests: [],
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    reducedMotion: 'reduce',
  });
  await page.clock.install({ time: new Date('2026-11-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-01T00:00:01Z'));
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) report.requests.push(r.url());
  });
  await page.goto(pathToFileURL(path.join(root, 'qa/minimal-settings-preview/index.html')).href);
  const voiceNav = page.locator('[data-nav=voice]');
  const voicePage = page.locator('#page-voice');
  const toggle = page.locator('#voice-plugin-toggle');
  await expect(page.locator('[data-nav=permissions]')).toHaveCount(0);
  await expect(page.locator('#page-permissions')).toHaveCount(0);
  await expect(voiceNav).toBeVisible();
  await voiceNav.click();
  await page.locator('[data-pref=voiceEnabled]').uncheck();
  await expect(voiceNav).toBeVisible();
  await page.locator('[data-nav=plugins]').click();
  await expect(page.locator('#voice-plugin-state')).toHaveText('已启用');
  await expect(page.locator('article[data-plugin-id=voice-input]')).toHaveAttribute(
    'data-plugin-state',
    'active',
  );
  await toggle.click();
  await expect(voiceNav).toBeHidden();
  await expect(page.locator('#voice-plugin-state')).toHaveText('已停用');
  await expect(page.locator('[data-plugin-id=voice-input] [data-goto=voice]')).toBeDisabled();
  await page.locator('[data-nav=conversation]').click();
  await expect(page.locator('[data-preview-action=conversation-record-start]')).toBeDisabled();
  await page.locator('[data-nav=plugins]').click();
  await toggle.click();
  await expect(voiceNav).toBeVisible();
  await expect(voiceNav).toHaveCount(1);
  await voiceNav.click();
  await expect(page.locator('[data-pref=voiceEnabled]')).not.toBeChecked();
  report.checks.push(
    'plugin lifecycle adds/removes its page; feature off keeps settings accessible; re-enable preserves feature configuration',
  );
  await page.locator('[data-pref=voiceEnabled]').check();
  await page.locator('#voice-engine-select').selectOption('api');
  await page.locator('#voice-api-url').fill('https://asr.example.test/v1');
  await page.locator('#voice-api-model').fill('saved-draft');
  await page.locator('#voice-service-start').click();
  await page.locator('#voice-record-button').click();
  await expect(voicePage).toHaveAttribute('data-recording', 'true');
  await toggle.evaluate((button) => button.click());
  await expect(voicePage).toBeHidden();
  await expect(page.locator('#page-plugins')).toBeVisible();
  await expect(page.locator('[data-nav=plugins]')).toHaveAttribute('aria-current', 'page');
  await expect(voicePage).toHaveAttribute('data-recording', 'false');
  await page.screenshot({ path: path.join(out, 'plugin-pages-disabled.png') });
  await toggle.click();
  await voiceNav.click();
  await expect(page.locator('#voice-api-model')).toHaveValue('saved-draft');
  await expect(page.locator('#voice-service-state')).toHaveText('已停止');
  await page.locator('#voice-engine-select').selectOption('whisper');
  await page.locator('#voice-model-download').click();
  await page.clock.runFor(200);
  await toggle.evaluate((button) => button.click());
  await page.clock.runFor(2000);
  await toggle.click();
  await voiceNav.click();
  await expect(page.locator('#voice-model-state')).toHaveText('未下载');
  await page.screenshot({ path: path.join(out, 'plugin-pages-enabled.png') });
  report.checks.push(
    'removing current page falls back to plugins; recording and pending download previews stop; ordinary drafts survive',
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.requests, []);
  assert.deepEqual(
    await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length]),
    [0, 0],
  );
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = String(e);
  throw e;
} finally {
  await fs.writeFile(path.join(out, 'plugin-pages-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
