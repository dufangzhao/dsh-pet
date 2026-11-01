/* global window, document, KeyboardEvent */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  out = path.join(root, 'qa/minimal-settings-preview/screenshots');
const report = {
  scope: 'bubble and speech-provider local preview; no backend',
  checks: [],
  errors: [],
  requests: [],
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(() => {
    window.__speechProbe = { opens: 0, closes: 0, mic: 0 };
    class AudioPreview {
      constructor() {
        window.__speechProbe.opens++;
        this.currentTime = 0;
        this.destination = {};
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        window.__speechProbe.closes++;
        return Promise.resolve();
      }
      createOscillator() {
        return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
        };
      }
    }
    window.AudioContext = AudioPreview;
    navigator.mediaDevices.getUserMedia = () => {
      window.__speechProbe.mic++;
      throw new Error('No microphone in bubble preview');
    };
  });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) report.requests.push(r.url());
  });
  await page.goto(pathToFileURL(path.join(root, 'qa/minimal-settings-preview/index.html')).href);
  await page.locator('#open-bubble-preview').click();
  await expect(page.locator('#pet-bubble-dialog')).toBeVisible();
  await expect(page.locator('#bubble-content')).toContainText('陪着你');
  assert.equal(await page.evaluate(() => window.__speechProbe.opens), 0);
  async function geometry() {
    const g = await page.evaluate(() => {
      const s = document.getElementById('bubble-preview-scene').getBoundingClientRect(),
        b = document.getElementById('pet-bubble').getBoundingClientRect();
      return {
        s: { left: s.left, right: s.right, top: s.top, bottom: s.bottom },
        b: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      };
    });
    assert.ok(
      g.b.left >= g.s.left + 7 &&
        g.b.right <= g.s.right - 7 &&
        g.b.top >= g.s.top + 5 &&
        g.b.bottom <= g.s.bottom,
      g,
    );
  }
  for (const width of [1200, 880, 620]) {
    await page.setViewportSize({ width, height: width === 620 ? 700 : width === 880 ? 760 : 900 });
    for (const scene of ['reply', 'thinking', 'choices', 'input', 'error', 'long']) {
      await page.locator('#bubble-scene-select').selectOption(scene);
      for (const pos of ['center', 'left', 'right']) {
        await page.locator('#bubble-position-select').selectOption(pos);
        await geometry();
      }
      if (width !== 620)
        await page.screenshot({ path: path.join(out, 'bubble-' + scene + '-' + width + '.png') });
    }
  }
  report.checks.push(
    'six reusable bubble scenes and left/center/right anchors stay inside1200/880/620 previews; long text scrolls',
  );
  await page.locator('#bubble-scene-select').selectOption('typewriter');
  await expect(page.locator('#bubble-stop')).toBeVisible();
  await page.locator('#bubble-stop').click();
  await expect(page.locator('#bubble-content')).toContainText('明天再继续');
  await expect(page.locator('#bubble-stop')).toBeHidden();
  await page.locator('#bubble-scene-select').selectOption('choices');
  await page.locator('[data-bubble-choice="1"]').click();
  await expect(page.locator('#bubble-content')).toContainText('安静');
  await page.locator('#bubble-replay').click();
  await page.keyboard.press('1');
  await expect(page.locator('#bubble-content')).toContainText('慢慢说');
  await page.locator('#bubble-scene-select').selectOption('input');
  await expect(page.locator('#bubble-input')).toBeFocused();
  await page.locator('#bubble-input').fill('第一行');
  await page.locator('#bubble-input').press('Shift+Enter');
  await page.locator('#bubble-input').press('Enter');
  await expect(page.locator('#bubble-user-message')).toContainText('第一行');
  await page.locator('#bubble-replay').click();
  await page.locator('#bubble-input').fill('中文输入');
  await page.locator('#bubble-input').evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(page.locator('#bubble-input')).toHaveValue('中文输入');
  await page.locator('#bubble-send').click();
  await expect(page.locator('#bubble-user-message')).toHaveText('中文输入');
  await page.locator('#bubble-scene-theme').click();
  await expect(page.locator('#bubble-preview-scene')).toHaveClass(/is-dark/);
  await page.screenshot({ path: path.join(out, 'bubble-dark.png') });
  await page.locator('#bubble-dialog-close').click();
  await expect(page.locator('#open-bubble-preview')).toBeFocused();
  report.checks.push(
    'text reveal completion, mouse/digit choices, composer newline/IME/send, scene theme and focus return',
  );
  await page.locator('[data-nav=plugins]').click();
  await page.locator('#speech-plugin-toggle').click();
  await expect(page.locator('#speech-plugin-state')).toHaveText('已停用');
  await page.locator('[data-nav=persona]').click();
  await expect(page.locator('#persona-voice')).toBeDisabled();
  await expect(page.locator('[data-persona-action=preview-sound]')).toBeDisabled();
  await expect(page.locator('#speech-provider-state')).toHaveText('内置说话插件已停用');
  await expect(page.locator('#persona-voice')).toHaveValue('builtin');
  await page.locator('[data-nav=start]').click();
  await page.locator('#open-bubble-preview').click();
  await page.locator('#bubble-scene-select').selectOption('reply');
  await expect(page.locator('#bubble-content')).toContainText('陪着你');
  await expect(page.locator('#bubble-speak')).toBeDisabled();
  await page.locator('#bubble-dialog-close').click();
  await page.locator('[data-nav=plugins]').click();
  await page.locator('#speech-plugin-toggle').click();
  await page.locator('[data-nav=start]').click();
  await page.locator('#open-bubble-preview').click();
  await page.locator('#bubble-speak').click();
  await expect(page.locator('#bubble-speak')).toHaveText('停止声音');
  assert.equal(await page.evaluate(() => window.__speechProbe.opens), 1);
  await page.locator('#speech-plugin-toggle').evaluate((el) => el.click());
  await expect(page.locator('#bubble-speak')).toBeDisabled();
  await expect(page.locator('#bubble-content')).toContainText('陪着你');
  assert.equal(await page.evaluate(() => window.__speechProbe.closes), 1);
  await page.locator('#bubble-dialog-close').click();
  await page.locator('[data-nav=plugins]').click();
  await page.locator('#speech-plugin-toggle').click();
  await page.locator('[data-nav=start]').click();
  await page.locator('#open-bubble-preview').click();
  await page.locator('#bubble-scene-select').selectOption('error');
  await page.locator('[data-bubble-choice="0"]').click();
  await expect(page.locator('#page-plugins')).toBeVisible();
  assert.equal(await page.evaluate(() => window.__speechProbe.mic), 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.requests, []);
  assert.deepEqual(
    await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length]),
    [0, 0],
  );
  report.checks.push(
    'speech provider disable retains selection/text, blocks audition, cancels owned audio; error action stays in preview; no device/network/storage',
  );
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = String(e);
  throw e;
} finally {
  await fs.writeFile(path.join(out, 'bubble-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
