/* global document, innerWidth, window */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'qa/minimal-settings-preview'),
  out = path.join(base, 'screenshots');
await fs.mkdir(out, { recursive: true });
const report = {
  scope: 'selected minimal settings visual preview; no business services',
  errors: [],
  remoteRequests: [],
  screenshots: [],
  pages: [],
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
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) report.remoteRequests.push(r.url());
  });
  await page.goto(pathToFileURL(path.join(base, 'index.html')).href);
  for (const width of [1200, 880]) {
    await page.setViewportSize({ width, height: width === 1200 ? 900 : 760 });
    for (const id of [
      'start',
      'persona',
      'appearance',
      'conversation',
      'voice',
      'plugins',
      'permissions',
      'about',
    ]) {
      await page.locator('[data-nav=' + id + ']').click();
      await expect(page.locator('#page-' + id)).toBeVisible();
      await expect(page.locator('.page:visible')).toHaveCount(1);
      await expect(page.locator('[data-nav=' + id + ']')).toHaveAttribute('aria-current', 'page');
      const geometry = await page.evaluate(() => {
        const content = document.getElementById('settings-content').getBoundingClientRect();
        const fields = Array.from(
          document.querySelectorAll(
            '.page:not([hidden]) input:not([type=checkbox]):not([type=radio]),.page:not([hidden]) select',
          ),
        )
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { id: el.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
        return {
          scrollWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          content: { left: content.left, right: content.right },
          fields,
          images: Array.from(document.images).map((i) => ({
            src: i.getAttribute('src'),
            ready: i.complete && i.naturalWidth > 0,
          })),
          unnamedNav: Array.from(document.querySelectorAll('[data-nav]')).filter(
            (n) => !n.getAttribute('aria-label'),
          ).length,
        };
      });
      assert.ok(geometry.scrollWidth <= width + 1, 'document overflows');
      assert.equal(geometry.unnamedNav, 0, 'collapsed navigation lacks names');
      assert.ok(
        geometry.images.every((i) => i.ready),
        'image failed',
      );
      for (const a of geometry.fields) {
        assert.ok(
          a.left >= geometry.content.left - 1 && a.right <= geometry.content.right + 1,
          'field clipped: ' + a.id,
        );
        for (const b of geometry.fields.filter((b) => b.id !== a.id)) {
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left),
            y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          assert.ok(x <= 1 || y <= 1, 'fields overlap');
        }
      }
      const name = id + '-' + width + '.png';
      await page.screenshot({ path: path.join(out, name), fullPage: true });
      report.screenshots.push(name);
      report.pages.push({ page: id, width, geometry });
    }
  }
  await page.setViewportSize({ width: 1142, height: 804 });
  await page.locator('#nav-start').click();
  for (const id of ['fetch-models-button', 'test-connection-button', 'reasoning-effort-select']) {
    const control = page.locator('#' + id);
    await expect(control).toBeVisible();
    const rect = await control.boundingBox();
    assert.ok(
      rect && rect.x >= 0 && rect.x + rect.width <= 1142 && rect.y + rect.height <= 804,
      'requested control is out of view',
    );
  }
  await page.screenshot({ path: path.join(out, 'start-1142.png'), fullPage: true });
  await page.locator('#start-pet-card').screenshot({ path: path.join(out, 'start-pet-wide.png') });
  await page
    .locator('#interface-theme-card')
    .screenshot({ path: path.join(out, 'start-interface-theme.png') });
  await expect(page.locator('#start-pet-card .start__quick')).toHaveCount(0);
  await page.locator('#reasoning-effort-select').selectOption('high');
  await page.locator('#test-connection-button').click();
  await expect(page.locator('#model-action-status')).toHaveText('预览模式');
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.locator('#nav-start').click();
  await page.locator('#provider-select').selectOption('kimi');
  await expect(page.locator('#model-name-input')).toHaveAttribute('placeholder', /moonshot/);
  await page.locator('#model-name-input').fill('demo-model');
  await page.locator('#api-key-input').fill('DEMO_PREVIEW_KEY');
  await page.locator('#api-key-toggle').click();
  await expect(page.locator('#api-key-input')).toHaveAttribute('type', 'text');
  await page.locator('#api-key-toggle').click();
  await expect(page.locator('#api-key-input')).toHaveAttribute('type', 'password');
  await page.setViewportSize({ width: 880, height: 620 });
  await page.locator('#nav-appearance').click();
  await page.locator('#appearance-figure-list input[value=round]').check();
  await expect(page.locator('#page-appearance [data-pet-art]')).toHaveAttribute(
    'src',
    'assets/pet-round.svg',
  );
  const tile = page
    .locator('#appearance-palette-list label')
    .filter({ has: page.locator('input[value=orange]') });
  await tile.scrollIntoViewIfNeeded();
  const before = await page.locator('#settings-content').evaluate((el) => el.scrollTop);
  await tile.click();
  const after = await page.locator('#settings-content').evaluate((el) => el.scrollTop);
  assert.ok(before > 0, 'scroll scenario must begin below top');
  assert.ok(Math.abs(after - before) < 2, 'thumbnail choice reset scroll');
  await expect(page.locator('#appearance-stage')).toHaveAttribute('data-palette', 'orange');
  await expect(page.locator('#appearance-clothing-list img')).toHaveCount(0);
  await page.locator('#nav-start').click();
  await expect(page.locator('#model-name-input')).toHaveValue('demo-model');
  await expect(page.locator('#api-key-input')).toHaveValue('DEMO_PREVIEW_KEY');
  const storage = await page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
  }));
  assert.deepEqual(storage, { local: 0, session: 0 });
  await page.locator('[data-nav=persona]').click();
  await page.locator('[data-persona-tab=templates]').click();
  await page.locator('#persona-prompt').fill('温和且简短');
  await expect(page.locator('[data-count-for=personaPrompt]')).toHaveText('5 / 16384');
  await page.locator('[data-nav=plugins]').click();
  await page.locator('[data-open-dialog=plugin-config-dialog]').click();
  await expect(page.locator('#plugin-config-dialog')).toBeVisible();
  await expect(page.locator('#plugin-config-dialog [autofocus]')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('[data-confirm=uninstall]').first().click();
  await expect(page.locator('#preview-confirm-dialog')).toBeVisible();
  await expect(page.locator('#preview-confirm-dialog [autofocus]')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('[data-nav=start]').click();
  await page
    .locator('label.segment')
    .filter({ has: page.locator('input[name=themeMode][value=dark]') })
    .click();
  const dark = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
  assert.equal(dark, 'rgb(21, 23, 25)');
  await page.screenshot({ path: path.join(out, 'start-dark-1200.png'), fullPage: true });
  await page
    .locator('label.segment')
    .filter({ has: page.locator('input[name=themeMode][value=light]') })
    .click();
  const ids = await page.locator('[id]').evaluateAll((nodes) => nodes.map((n) => n.id));
  assert.equal(new Set(ids).size, ids.length, 'duplicate UI id');
  await expect(page.locator('.page__summary,.field__hint,.row__desc,.titlebar__note')).toHaveCount(
    0,
  );
  report.interactions = {
    fullPageFields: true,
    nativeDialogs: true,
    cancelFocus: true,
    darkTheme: true,
    provider: true,
    keyVisibility: true,
    figure: true,
    thumbnailSelection: true,
    emptyClothing: true,
    scrollPreserved: true,
    draftsAcrossPreviewNavigation: true,
    storage,
  };
  assert.equal(report.errors.length, 0, report.errors.join(';'));
  assert.equal(report.remoteRequests.length, 0, 'external request in offline preview');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(out, 'browser-report.json'),
    JSON.stringify(report, null, 2) + String.fromCharCode(10),
  );
}
console.log(
  JSON.stringify({
    status: report.status,
    pages: report.pages.length,
    images: report.screenshots.length,
    errors: report.errors.length,
    remoteRequests: report.remoteRequests.length,
  }),
);
