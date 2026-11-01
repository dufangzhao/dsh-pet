/* global window */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'qa/minimal-settings-preview/screenshots');
const report = {
  scope: 'standalone appearance image preview; no app/backend writes',
  checks: [],
  errors: [],
  remoteRequests: [],
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
  await page.goto(pathToFileURL(path.join(root, 'qa/minimal-settings-preview/index.html')).href);
  await page.locator('[data-nav=appearance]').click();
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(2);
  await expect(page.locator('#appearance-palette-list label')).toHaveCount(4);
  await expect(page.locator('#appearance-clothing-list img')).toHaveCount(0);
  await expect(page.locator('#appearance-clothing-list label')).toHaveCount(0);
  for (const width of [1200, 1142, 880]) {
    await page.setViewportSize({ width, height: width === 880 ? 760 : width === 1142 ? 804 : 900 });
    const bounds = await page.locator('#appearance-stage').boundingBox();
    assert.ok(bounds && bounds.width > width * 0.6 && bounds.height >= 260);
    const escaped = await page.locator('#page-appearance').evaluate((el) => {
      const box = window.document.getElementById('settings-content').getBoundingClientRect();
      return Array.from(el.querySelectorAll('.asset-tile,.asset-empty,.stage'))
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1);
        })
        .map((n) => n.id || n.className);
    });
    assert.deepEqual(escaped, []);
    await page.screenshot({ path: path.join(out, 'appearance-assets-' + width + '.png') });
  }
  report.checks.push(
    'large stage and three compact asset rows fit three widths; clothing initially empty',
  );
  await page.locator('#appearance-figure-list input[value=round]').check();
  await expect(page.locator('#appearance-stage [data-pet-art]')).toHaveAttribute(
    'src',
    'assets/pet-round.svg',
  );
  await expect(page.locator('#appearance-palette-list [data-thumb-art]').first()).toHaveAttribute(
    'src',
    'assets/pet-round.svg',
  );
  await page.locator('#appearance-palette-list input[value=pine]').check();
  await expect(page.locator('#appearance-stage [data-pet-art]')).toHaveAttribute(
    'data-art-palette',
    'pine',
  );
  await page.locator('[data-appearance-scene]').click();
  await expect(page.locator('#appearance-stage')).toHaveAttribute('data-scene-dark', 'true');
  await page.locator('[data-appearance-pose=listening]').click();
  await expect(page.locator('#appearance-stage')).toHaveAttribute('data-preview-pose', 'listening');
  const importImage = async (kind, file) => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-asset-import=' + kind + ']').click();
    await (await chooser).setFiles(file);
  };
  await importImage('figure', []);
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(2);
  const image = (name) => ({
    name,
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="42" fill="#a8d3ef"/><circle cx="45" cy="53" r="4"/><circle cx="75" cy="53" r="4"/></svg>',
    ),
  });
  await importImage('figure', image('本地形象.svg'));
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(3);
  await expect(page.locator('#appearance-figure-list input[value=import-1]')).toBeChecked();
  await expect(page.locator('#appearance-stage [data-pet-art]')).toHaveAttribute('src', /^blob:/);
  await importImage('palette', image('本地配色.svg'));
  await expect(page.locator('#appearance-palette-list label')).toHaveCount(5);
  await expect(page.locator('#appearance-palette-list input[value=import-2]')).toBeChecked();
  await page.locator('#appearance-figure-list input[value=minimal]').check();
  await expect(page.locator('#appearance-palette-list input[value=morning]')).toBeChecked();
  await expect(page.locator('#appearance-stage [data-pet-art]')).toHaveAttribute(
    'src',
    'assets/pet-minimal.svg',
  );
  await importImage('clothing', image('本地服装.svg'));
  await expect(page.locator('.appearance-clothing')).toHaveCount(1);
  await expect(page.locator('#appearance-clothing-list [data-empty-slot]')).toHaveCount(0);
  await page.locator('#clear-clothing').click();
  await expect(page.locator('.appearance-clothing')).toHaveCount(0);
  await importImage('figure', {
    name: '损坏图片.png',
    mimeType: 'image/png',
    buffer: Buffer.from('invalid image'),
  });
  await expect(page.locator('#appearance-import-status')).toHaveText('无法读取这张图片');
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(3);
  await expect(page.locator('#appearance-stage [data-pet-art]')).toHaveAttribute(
    'src',
    'assets/pet-minimal.svg',
  );
  await page.locator('[data-nav=persona]').click();
  await page.locator('[data-nav=appearance]').click();
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(3);
  report.checks.push(
    'selection updates stage and thumbnails; local scene/pose controls; import cancel/success/error, clothing clear and draft navigation',
  );
  assert.deepEqual(
    await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length]),
    [0, 0],
  );
  await page.reload();
  await page.locator('[data-nav=appearance]').click();
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(2);
  await expect(page.locator('#appearance-clothing-list img')).toHaveCount(0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.remoteRequests, []);
  report.checks.push(
    'imports remain in page memory and disappear on reload; no network/storage/backend access',
  );
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = String(e);
  throw e;
} finally {
  await fs.writeFile(path.join(out, 'appearance-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
