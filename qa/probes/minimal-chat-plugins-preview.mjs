/* global document, window, KeyboardEvent, innerWidth */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.cache', 'chat-plugin-preview');
await fs.mkdir(out, { recursive: true });
const report = { assertions: [], errors: [], remoteRequests: [], screenshots: [] };
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1200, height: 900 },
  reducedMotion: 'reduce',
});
const record = (label) => report.assertions.push(label);
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('request', (request) => {
  if (/^https?:/.test(request.url())) report.remoteRequests.push(request.url());
});
await page.addInitScript(() => {
  window.__previewProbe = { network: 0, microphone: 0, storage: 0 };
  window.fetch = () => {
    window.__previewProbe.network++;
    throw new Error('Unexpected network in a local preview');
  };
  if (navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = () => {
      window.__previewProbe.microphone++;
      throw new Error('Unexpected microphone in a local preview');
    };
  window.localStorage.setItem = () => {
    window.__previewProbe.storage++;
    throw new Error('Unexpected persistence in a local preview');
  };
});
try {
  await page.goto(pathToFileURL(path.join(root, 'qa/minimal-settings-preview/index.html')).href);
  await page.locator('[data-nav="plugins"]').click();
  const cards = page.locator('#page-plugins article[data-plugin-id]:visible');
  assert.equal(await cards.count(), 4);
  await page.locator('#plugin-search').fill('语音');
  assert.equal(await cards.count(), 1);
  assert.equal(await cards.first().getAttribute('data-plugin-id'), 'voice-input');
  await page.locator('#plugin-search').fill('没有这个插件');
  assert.equal(await cards.count(), 0);
  assert.equal(await page.locator('#plugins-empty').isVisible(), true);
  await page.locator('#plugin-search').fill('');
  await page.locator('[data-plugin-filter="builtin"]').click();
  assert.equal(await cards.count(), 3);
  await page.locator('[data-plugin-filter="disabled"]').click();
  assert.equal(await cards.count(), 0);
  await page.locator('[data-plugin-filter="all"]').click();
  record('Plugin cards search and filter actual cards, including the empty state.');

  await page.locator('#voice-plugin-toggle').click();
  await page.locator('[data-plugin-filter="disabled"]').click();
  assert.equal(await cards.count(), 1);
  assert.equal(await cards.first().getAttribute('data-plugin-id'), 'voice-input');
  await page.locator('[data-plugin-filter="all"]').click();
  await page.locator('#voice-plugin-toggle').click();
  assert.equal(await page.locator('[data-show="plugins-active-count"]').textContent(), '4');
  record('Voice card keeps the existing shared enabled state and correct counts.');

  const model = page.locator('article[data-plugin-id="model-reply"]');
  await model.locator('[data-preview-action="plugin-disable"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await model.getAttribute('data-plugin-state'), 'active');
  await model.locator('[data-preview-action="plugin-disable"]').click();
  await page.locator('#preview-confirm-dialog button[value="confirm"]').click();
  assert.equal(await model.getAttribute('data-plugin-state'), 'disabled');
  assert.equal(await page.locator('[data-show="plugins-active-count"]').textContent(), '3');
  await model.locator('[data-preview-action="plugin-enable"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await model.getAttribute('data-plugin-state'), 'disabled');
  await model.locator('[data-preview-action="plugin-enable"]').click();
  await page.locator('#preview-confirm-dialog button[value="confirm"]').click();
  assert.equal(await model.getAttribute('data-plugin-state'), 'active');
  record(
    'Confirm applies only the selected plugin action; Escape never reuses an old confirmation.',
  );

  await page.locator('[data-nav="conversation"]').click();
  const stream = page.locator('#conversation-stream');
  const entries = stream.locator('[data-interaction-id]');
  const input = page.locator('#conversation-input');
  const send = page.locator('[data-preview-action="conversation-send"]');
  assert.equal(await entries.count(), 3);
  await input.fill('   ');
  assert.equal(await send.isDisabled(), true);
  await input.press('Enter');
  assert.equal(await entries.count(), 3);
  await input.fill('<b>你好，桌宠</b>');
  await input.press('Enter');
  assert.equal(await stream.locator('.chat-entry--user').last().textContent(), '<b>你好，桌宠</b>');
  assert.equal(await stream.locator('b').count(), 0);
  await page.locator('[data-chat-action="toggle-console"]').click();
  await page.locator('[data-interaction="touch"]').click();
  await page.locator('[data-interaction="stroke"]').click();
  await input.fill('切页后保留的草稿');
  await page.locator('[data-nav="plugins"]').click();
  await page.locator('[data-nav="conversation"]').click();
  assert.equal(await input.inputValue(), '切页后保留的草稿');
  await page.locator('#conversation-thinking').waitFor({ state: 'hidden' });
  assert.equal(await entries.count(), 7);
  assert.equal(await stream.locator('.chat-entry--user').count(), 2);
  assert.equal(await stream.locator('.chat-entry--pet').count(), 2);
  assert.equal(await stream.locator('.chat-entry--interaction').count(), 3);
  assert.equal(
    await stream.locator('.chat-entry--interaction').last().textContent(),
    '你摸了摸小蓝',
  );
  const ids = await entries.evaluateAll((nodes) => nodes.map((node) => node.dataset.interactionId));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))),
  );
  record(
    'User messages, one preview reply and pet interactions append once in chronological order.',
  );
  record('Message markup stays plain text and switching pages preserves the draft.');

  await input.fill('第一行');
  await input.press('Shift+Enter');
  await input.press('End');
  await input.type('第二行');
  assert.ok((await input.inputValue()).includes('\n'));
  const beforeIme = await entries.count();
  await input.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    ),
  );
  assert.equal(await entries.count(), beforeIme);
  record('Shift+Enter adds a line and Chinese IME confirmation does not send a message.');

  for (let i = 0; i < 18; i++) await page.locator('[data-interaction="touch"]').click();
  await stream.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.locator('[data-interaction="put-down"]').click();
  assert.ok((await stream.evaluate((element) => element.scrollTop)) < 5);
  const beforeEarlier = await entries.count();
  await page.locator('[data-preview-action="conversation-load-earlier"]').click();
  assert.equal(await entries.count(), beforeEarlier + 2);
  assert.equal(
    await page.locator('[data-preview-action="conversation-load-earlier"]').isDisabled(),
    true,
  );
  assert.equal(await entries.first().getAttribute('data-interaction-id'), 'earlier-1');
  assert.ok(await stream.evaluate((element) => element.scrollHeight > element.clientHeight));
  record('Reading earlier messages does not jump on arrival; earlier records prepend once.');

  for (const width of [1200, 880]) {
    await page.setViewportSize({ width, height: width === 1200 ? 900 : 760 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        const select = document.querySelector('[data-pref="themeMode"]');
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, theme);
      for (const panel of ['plugins', 'conversation']) {
        await page.locator('[data-nav="' + panel + '"]').click();
        const geometry = await page.evaluate(() => {
          const content = document.getElementById('settings-content').getBoundingClientRect();
          const composer = document.getElementById('conversation-compose').getBoundingClientRect();
          return {
            viewport: innerWidth,
            width: document.documentElement.scrollWidth,
            content: { right: content.right, bottom: content.bottom },
            composer: { right: composer.right, bottom: composer.bottom },
          };
        });
        assert.ok(
          geometry.width <= geometry.viewport + 1,
          'Page overflows at ' + width + '/' + panel,
        );
        if (panel === 'conversation') {
          assert.ok(geometry.composer.right <= geometry.content.right + 1);
          assert.ok(geometry.composer.bottom <= geometry.content.bottom + 1);
        }
        const name = panel + '-' + theme + '-' + width + '.png';
        await page.screenshot({ path: path.join(out, name), fullPage: true });
        report.screenshots.push(name);
      }
    }
  }
  record('Plugin and conversation layouts fit 1200px and 880px in light and dark themes.');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await input.fill('这一条回复先停一下');
  const petCount = await stream.locator('.chat-entry--pet').count();
  await input.press('Enter');
  await page.locator('[data-nav="plugins"]').click();
  await page.locator('[data-preview-action="plugins-stop-all"]').click();
  await page.locator('#preview-confirm-dialog button[value="confirm"]').click();
  await page.locator('[data-nav="conversation"]').click();
  await page.locator('#conversation-thinking').waitFor({ state: 'hidden' });
  await page.clock.runFor(800);
  assert.equal(await stream.locator('.chat-entry--pet').count(), petCount);
  assert.equal(
    await stream.locator('.chat-entry--interaction').last().textContent(),
    '你停止了这次回复',
  );
  record('Stopping current preview work cancels the pending response without a late message.');
  await page.locator('[data-nav="plugins"]').click();
  assert.equal(
    await page
      .locator('article[data-plugin-id="builtin-bridge"] [data-preview-action="plugin-uninstall"]')
      .count(),
    0,
  );
  await model.locator('[data-preview-action="plugin-uninstall"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await model.isVisible(), true);
  await model.locator('[data-preview-action="plugin-uninstall"]').click();
  await page.locator('#preview-confirm-dialog button[value="confirm"]').click();
  assert.equal(await model.isVisible(), false);
  await page.locator('[data-nav="conversation"]').click();
  await input.fill('插件停用后保留这条文字');
  await input.press('Enter');
  assert.equal(await page.locator('#conversation-thinking').count(), 0);
  assert.equal(await page.locator('#conversation-chat-status').textContent(), '回复已暂停');
  record(
    'Uninstall is confirmed, built-in core stays protected and unavailable replies show a paused state.',
  );
  await page.clock.resume();
  assert.deepEqual(await page.evaluate(() => window.__previewProbe), {
    network: 0,
    microphone: 0,
    storage: 0,
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.remoteRequests, []);
  record(
    'The preview makes no network, microphone or persistence calls and reports no browser errors.',
  );
  // 交付截图使用新草稿，不包含边界测试文字或压力记录。
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(pathToFileURL(path.join(root, 'qa/minimal-settings-preview/index.html')).href);
  await page.locator('[data-nav="plugins"]').click();
  await page.screenshot({ path: path.join(out, 'plugins-preview.png'), fullPage: true });
  await page.locator('[data-nav="conversation"]').click();
  await page.locator('#conversation-input').fill('今天忙完了，陪我休息一会儿吧。');
  await page.locator('#conversation-input').press('Enter');
  await page.locator('#conversation-thinking').waitFor({ state: 'hidden' });
  await page.locator('[data-chat-action="toggle-console"]').click();
  await page.locator('[data-interaction="touch"]').click();
  await page.locator('[data-interaction="pick-up"]').click();
  await page.locator('[data-interaction="put-down"]').click();
  await page.locator('[data-chat-action="toggle-console"]').click();
  await page.screenshot({ path: path.join(out, 'conversation-preview.png'), fullPage: true });
  report.screenshots.push('plugins-preview.png', 'conversation-preview.png');
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      passed: report.assertions.length,
      screenshots: report.screenshots.length,
      report: path.join(out, 'report.json'),
    }),
  );
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
  report.failure = String(error);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
