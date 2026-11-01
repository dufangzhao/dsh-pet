/* global window */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'qa/minimal-settings-preview/screenshots');
const report = {
  scope: 'standalone voice input preview, no device or backend access',
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
  await page.addInitScript(() => {
    window.__voiceMicRequests = 0;
    window.navigator.mediaDevices.getUserMedia = () => {
      window.__voiceMicRequests++;
      return Promise.reject(new Error('Preview must not record'));
    };
  });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) report.requests.push(r.url());
  });
  await page.goto(pathToFileURL(path.join(root, 'qa/minimal-settings-preview/index.html')).href);
  await page.locator('[data-nav=voice]').click();
  const voice = page.locator('#page-voice');
  await expect(voice).not.toContainText('收音方式');
  await expect(voice).not.toContainText('按住时才打开麦克风');
  await expect(voice).not.toContainText('松开');
  await expect(page.locator('[data-pref=afterSpeech]')).toHaveCount(0);
  await expect(page.locator('option[value=silent]')).toHaveCount(0);
  await expect(page.locator('[data-nav=plugins]')).toHaveText('插件');
  await expect(page.locator('#voice-record-button')).toBeDisabled();
  for (const width of [1200, 1142, 880]) {
    await page.setViewportSize({ width, height: width === 880 ? 760 : width === 1142 ? 804 : 900 });
    const escaped = await voice.evaluate((el) => {
      const b = window.document.getElementById('settings-content').getBoundingClientRect();
      return Array.from(el.querySelectorAll('input,select,textarea,button,meter'))
        .filter((e) => e.checkVisibility())
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.left < b.left - 1 || r.right > b.right + 1);
        })
        .map((e) => e.id);
    });
    assert.deepEqual(escaped, []);
    await page.screenshot({ path: path.join(out, 'voice-plugin-' + width + '.png') });
  }
  await expect(page.locator('#voice-engine-select option')).toHaveCount(4);
  await expect(page.locator('#voice-service-start')).toBeDisabled();
  await page.locator('#voice-model-download').click();
  await expect(page.locator('#voice-model-progress')).toBeVisible();
  await page.clock.runFor(900);
  await expect(page.locator('#voice-model-state')).toHaveText('已下载（预览）');
  await page.locator('#voice-service-start').click();
  await expect(page.locator('#voice-service-state')).toHaveText('运行预览');
  const recording = () => expect(voice).toHaveAttribute('data-recording', 'true');
  const idle = () => expect(voice).toHaveAttribute('data-recording', 'false');
  await page.keyboard.down('AltLeft');
  await recording();
  await page.clock.fastForward(50);
  await page.keyboard.up('AltLeft');
  await recording();
  await page.keyboard.down('AltLeft');
  await idle();
  await page.keyboard.up('AltLeft');
  await idle();
  await page.keyboard.down('AltLeft');
  await recording();
  await page.clock.fastForward(350);
  await page.keyboard.up('AltLeft');
  await idle();
  await page.keyboard.down('AltLeft');
  await page.keyboard.down('AltLeft');
  await recording();
  await page.clock.fastForward(350);
  await page.keyboard.up('AltLeft');
  await idle();
  report.checks.push(
    'both fixed key gestures work simultaneously; repeat keydown does not start or end twice',
  );
  await page.locator('#voice-key-change').click();
  await expect(page.locator('#voice-key-dialog')).toBeVisible();
  await expect(page.locator('#voice-key-capture')).toBeFocused();
  await page.keyboard.press('ControlRight');
  await expect(page.locator('#voice-key-candidate')).toHaveText('右 Ctrl');
  await page.locator('#voice-key-save').click();
  await expect(page.locator('#voice-hotkey-value')).toHaveText('右 Ctrl');
  await page.locator('#voice-key-change').click();
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('Escape');
  await expect(page.locator('#voice-hotkey-value')).toHaveText('右 Ctrl');
  await expect(page.locator('#voice-key-change')).toBeFocused();
  await page.keyboard.press('AltLeft');
  await idle();
  await page.keyboard.down('ControlRight');
  await page.clock.fastForward(350);
  await page.keyboard.up('ControlRight');
  await idle();
  await page.keyboard.press('ControlRight');
  await recording();
  await page.locator('#voice-record-cancel').click();
  await idle();
  await page.locator('#voice-key-change').click();
  await page.keyboard.press('KeyB');
  await page.locator('#voice-key-save').click();
  await page.locator('#voice-transcript').focus();
  await page.keyboard.press('KeyB');
  await idle();
  await page.locator('#voice-record-button').click();
  await recording();
  await page.locator('#voice-record-button').click();
  await idle();
  await expect(page.locator('#voice-transcript')).toHaveValue('');
  report.checks.push(
    'key change/save/cancel focus; old key inactive; editable fields ignored; no fabricated transcript',
  );
  await page.locator('[data-nav=plugins]').click();
  const plugin = page.locator('[data-plugin-id=voice-input]');
  await expect(plugin).toContainText('系统内置');
  await expect(plugin.getByRole('button', { name: '卸载', exact: true })).toHaveCount(0);
  await page.locator('#voice-plugin-toggle').click();
  await expect(page.locator('#voice-plugin-state')).toHaveText('已关闭');
  await plugin.getByRole('button', { name: '设置', exact: true }).click();
  await expect(voice).toBeVisible();
  await expect(page.locator('[data-pref=voiceEnabled]')).not.toBeChecked();
  await expect(page.locator('#voice-record-button')).toBeDisabled();
  await page.locator('[data-pref=voiceEnabled]').check();
  await page.locator('#voice-service-start').click();
  await page.keyboard.press('KeyB');
  await recording();
  await page.locator('[data-pref=voiceEnabled]').uncheck();
  await idle();
  await page.locator('[data-pref=voiceEnabled]').check();
  await expect(page.locator('#voice-service-state')).toHaveText('已停止');
  assert.equal(await page.evaluate(() => window.__voiceMicRequests), 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.requests, []);
  assert.deepEqual(
    await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length]),
    [0, 0],
  );
  await page.locator('#voice-engine-select').selectOption('whisper');
  await expect(page.locator('#voice-model-name')).toHaveText('Whisper small INT8');
  await expect(page.locator('#voice-model-size')).toHaveText('358 MB');
  await expect(page.locator('#voice-model-state')).toHaveText('未下载');
  await page.locator('#voice-model-download').click();
  await page.clock.runFor(900);
  await expect(page.locator('#voice-model-state')).toHaveText('已下载（预览）');
  await page.screenshot({ path: path.join(out, 'voice-whisper.png') });
  await page.locator('#voice-engine-select').selectOption('system');
  await expect(page.locator('#voice-local-settings')).toBeHidden();
  await expect(page.locator('#voice-system-settings')).toBeVisible();
  await expect(page.locator('#voice-model-download')).toBeHidden();
  await page.screenshot({ path: path.join(out, 'voice-system.png') });
  await page.locator('#voice-engine-select').selectOption('api');
  await expect(page.locator('#voice-api-settings')).toBeVisible();
  await page.locator('#voice-service-start').click();
  await expect(page.locator('#voice-api-status')).toHaveText('请填写有效的接口地址');
  await page.locator('#voice-api-url').fill('https://asr.example.test/v1');
  await page.locator('#voice-service-start').click();
  await expect(page.locator('#voice-api-status')).toHaveText('请填写转写模型名称');
  await page.locator('#voice-api-model').fill('demo-transcription');
  await page.locator('#voice-api-key').fill('DEMO_ASR_KEY');
  await page.locator('#voice-api-key-toggle').click();
  await expect(page.locator('#voice-api-key')).toHaveAttribute('type', 'text');
  await page.locator('#voice-api-key-toggle').click();
  await expect(page.locator('#voice-api-key')).toHaveAttribute('type', 'password');
  await page.locator('#voice-service-start').click();
  await expect(page.locator('#voice-service-state')).toHaveText('接口配置预览');
  await page.locator('#voice-api-key').fill('DEMO_CHANGED_KEY');
  await expect(page.locator('#voice-service-state')).toHaveText('已停止');
  await page.locator('#voice-microphone-select').selectOption('headset');
  await expect(page.locator('#voice-microphone-select')).toHaveValue('headset');
  await expect(page.locator('#voice-microphone-state')).toHaveText('未收音');
  await page.screenshot({ path: path.join(out, 'voice-api.png') });
  await page.locator('#voice-engine-select').selectOption('funasr');
  await expect(page.locator('#voice-model-name')).toHaveText('SenseVoiceSmall INT8');
  await expect(page.locator('#voice-model-state')).toHaveText('已下载（预览）');
  await page.locator('#voice-engine-select').selectOption('api');
  await expect(page.locator('#voice-api-url')).toHaveValue('https://asr.example.test/v1');
  for (const width of [1200, 880]) {
    await page.setViewportSize({ width, height: width === 880 ? 760 : 900 });
    const overflow = await page
      .locator('#settings-content')
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: path.join(out, 'voice-api-' + width + '.png') });
  }
  assert.equal(await page.evaluate(() => window.__voiceMicRequests), 0);
  assert.deepEqual(report.requests, []);
  assert.deepEqual(report.errors, []);
  report.checks.push(
    'four ASR engines, two fixed local models, download-preview/cache separation, Windows no-download, API validation/key/draft retention, microphone choices, and no device/network access',
  );
  report.checks.push(
    'one built-in plugin shares the enable setting; disabling cancels preview; no microphone/network/storage access',
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'voice-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
