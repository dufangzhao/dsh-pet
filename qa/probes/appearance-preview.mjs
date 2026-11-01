/* global window */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'qa/minimal-settings-preview/screenshots');
const report = {
  scope: 'standalone outfit package preview; no app/backend writes',
  checks: [],
  errors: [],
  remoteRequests: [],
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const art = (color) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="40" fill="' +
      color +
      '"/></svg>',
  );
const packageFile = (name, data) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(data)),
});
const packageA = {
  format: 'desktop-pet-outfit-preview',
  version: 1,
  name: '装扮甲',
  image: art('#abd3ef'),
  palettes: [
    { id: 'sky', name: '天蓝', image: art('#abd3ef') },
    { id: 'mint', name: '薄荷', image: art('#95ccba') },
  ],
  clothing: [{ id: 'scarf', name: '围巾', image: art('#dca2a2') }],
};
const packageB = {
  format: 'desktop-pet-outfit-preview',
  version: 1,
  name: '装扮乙',
  image: art('#c5c5df'),
  palettes: [{ id: 'ink', name: '墨色', image: art('#a8a8bf') }],
  clothing: [{ id: 'hat', name: '帽子', image: art('#bbb2d1') }],
};
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
  await expect(page.getByRole('button', { name: '导入装扮包', exact: true })).toHaveCount(1);
  await expect(page.locator('[data-asset-import]')).toHaveCount(0);
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(2);
  await expect(page.locator('#appearance-clothing-list img')).toHaveCount(0);
  for (const width of [1200, 1142, 880]) {
    await page.setViewportSize({ width, height: width === 880 ? 760 : width === 1142 ? 804 : 900 });
    const bounds = await page.locator('#appearance-stage').boundingBox();
    assert.ok(bounds && bounds.width > width * 0.6 && bounds.height >= 260);
    const escaped = await page.locator('#page-appearance').evaluate((el) => {
      const box = window.document.getElementById('settings-content').getBoundingClientRect();
      return Array.from(
        el.querySelectorAll('.asset-tile,.asset-empty,.stage,#import-outfit-button'),
      )
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
    'one outfit importer; large stage and package-owned rows fit three widths; unmade clothing empty',
  );
  const importPack = async (file) => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#import-outfit-button').click();
    await (await chooser).setFiles(file);
  };
  await importPack([]);
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(2);
  await importPack(packageFile('装扮甲.outfit.json', packageA));
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(3);
  await expect(page.locator('#appearance-figure-list input[value=outfit-1]')).toBeChecked();
  await expect(page.locator('#appearance-palette-list label')).toHaveCount(2);
  await expect(page.locator('#appearance-clothing-list label')).toHaveCount(1);
  await expect(page.locator('#appearance-palette-list input[value=sky]')).toBeChecked();
  await expect(page.locator('#appearance-clothing-list input[value=scarf]')).toBeChecked();
  await expect(page.locator('.appearance-clothing')).toHaveAttribute(
    'src',
    packageA.clothing[0].image,
  );
  await page.locator('#appearance-palette-list input[value=mint]').check();
  await expect(page.locator('#appearance-stage [data-pet-art]')).toHaveAttribute(
    'src',
    packageA.palettes[1].image,
  );
  await importPack(packageFile('装扮乙.outfit.json', packageB));
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(4);
  await expect(page.locator('#appearance-palette-list label')).toHaveCount(1);
  await expect(page.locator('#appearance-clothing-list label')).toHaveCount(1);
  await expect(page.locator('#appearance-palette-list input[value=ink]')).toBeChecked();
  await expect(page.locator('#appearance-clothing-list input[value=hat]')).toBeChecked();
  await expect(page.locator('#appearance-palette-list input[value=mint]')).toHaveCount(0);
  await expect(page.locator('#appearance-clothing-list input[value=scarf]')).toHaveCount(0);
  await page.locator('#appearance-figure-list input[value=outfit-1]').check();
  await expect(page.locator('#appearance-palette-list input[value=sky]')).toBeChecked();
  await expect(page.locator('#appearance-clothing-list input[value=scarf]')).toBeChecked();
  await page.locator('#clear-clothing').click();
  await expect(page.locator('.appearance-clothing')).toHaveCount(0);
  await page.locator('#appearance-figure-list input[value=minimal]').check();
  await expect(page.locator('#appearance-palette-list label')).toHaveCount(4);
  await expect(page.locator('#appearance-clothing-list img')).toHaveCount(0);
  await expect(page.locator('#appearance-palette-list input[value=morning]')).toBeChecked();
  report.checks.push(
    'one file adds all three categories; package switching updates palette and clothing atomically without cross-package leftovers',
  );
  await importPack(packageFile('缺少内容.json', { ...packageA, clothing: null }));
  await expect(page.locator('#appearance-import-status')).toHaveText('装扮包信息不完整');
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(4);
  await expect(page.locator('#appearance-figure-list input[value=minimal]')).toBeChecked();
  await importPack(
    packageFile('损坏图片.json', { ...packageA, image: 'data:image/png;base64,bm90YW5pbWFnZQ==' }),
  );
  await expect(page.locator('#appearance-import-status')).toHaveText('装扮包中有无法读取的图片');
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(4);
  await importPack(
    packageFile('空栏装扮.json', { ...packageA, name: '空栏装扮', palettes: [], clothing: [] }),
  );
  await expect(page.locator('#appearance-palette-list label')).toHaveCount(0);
  await expect(page.locator('#appearance-clothing-list label')).toHaveCount(0);
  await page.locator('[data-nav=persona]').click();
  await page.locator('[data-nav=appearance]').click();
  await expect(page.locator('#appearance-figure-list label')).toHaveCount(5);
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
    'cancel and invalid package keep selection; unmade content stays empty; imports remain local and disappear on reload',
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'appearance-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
