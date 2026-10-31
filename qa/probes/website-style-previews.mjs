/* global window, document, getComputedStyle, innerWidth */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'qa/website-style-previews');
const output = path.join(base, 'screenshots');
await fs.mkdir(output, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(base, 'source-manifest.json'), 'utf8'));
const hashes = [];
for (const family of manifest.families)
  for (const source of family.sources) {
    const bytes = await fs.readFile(path.join(base, source.file));
    const sha = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha, source.sha256);
    hashes.push({ family: family.id, file: source.file, sha256: sha });
  }
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const report = {
  scope: 'visual-only offline style previews',
  rawSources: hashes,
  styles: [],
  errors: [],
  remoteRequests: [],
  screenshots: [],
};
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.remoteRequests.push(request.url());
  });
  const url = pathToFileURL(path.join(base, 'index.html')).href;
  await page.goto(url);
  await expect(page.locator('#style-picker button')).toHaveCount(5);
  const styles = await page.evaluate(() =>
    window.PREVIEW_DATA.styles.map((s) => ({ id: s.id, label: s.label })),
  );
  assert.equal(styles.length, 5);
  for (const style of styles) {
    await page.locator('#style-picker [data-style=' + JSON.stringify(style.id) + ']').click();
    await expect(page.locator('body')).toHaveAttribute('data-style', style.id);
    await page.locator('#view-switcher [data-view=window]').click();
    await page.locator('#width-toggle [data-width=wide]').click();
    await page.screenshot({ path: path.join(output, style.id + '-wide.png'), fullPage: true });
    report.screenshots.push(style.id + '-wide.png');
    await page
      .locator('#host-window')
      .screenshot({ path: path.join(output, style.id + '-canvas.png'), animations: 'disabled' });
    report.screenshots.push(style.id + '-canvas.png');
    const geometry = await page.evaluate(() => {
      const host = document.getElementById('host-window');
      const shadow = host.shadowRoot;
      const button = shadow?.querySelector('button,input[type=submit],[role=button]');
      const input = shadow?.querySelector(
        'input:not([type=checkbox]):not([type=radio]):not([type=submit])',
      );
      const pick = (el) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
          tag: el.tagName,
          radius: s.borderRadius,
          shadow: s.boxShadow,
          border: s.border,
          background: s.background,
          font: s.fontFamily,
        };
      };
      return {
        button: pick(button),
        input: pick(input),
        fields: Array.from(
          shadow.querySelectorAll(
            'input:not([type=checkbox]):not([type=radio]):not([type=submit])',
          ),
        ).map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        }),
        host: {
          left: host.getBoundingClientRect().left,
          right: host.getBoundingClientRect().right,
        },
        bodyScroll: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    assert.ok(geometry.bodyScroll <= 1280 + 1, 'wide document overflows');
    if (style.id === 'hard-edge') {
      assert.ok(geometry.button.border.startsWith('2px'), 'current-source border not applied');
      assert.ok(geometry.button.shadow.includes('4px 4px'), 'current-source shadow not applied');
    }
    for (let i = 0; i < geometry.fields.length; i++) {
      const a = geometry.fields[i];
      assert.ok(
        a.left >= geometry.host.left - 1 && a.right <= geometry.host.right + 1,
        'sample input clipped',
      );
      for (const b of geometry.fields.slice(i + 1)) {
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        assert.ok(overlapX <= 1 || overlapY <= 1, 'sample inputs overlap');
      }
    }
    await expect(page.locator('#stage > section:visible')).toHaveCount(1);
    await page.locator('#width-toggle [data-width=narrow]').click();
    await page.setViewportSize({ width: 880, height: 960 });
    await page.screenshot({ path: path.join(output, style.id + '-narrow.png'), fullPage: true });
    report.screenshots.push(style.id + '-narrow.png');
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'narrow document overflows',
    );
    await page.locator('#view-switcher [data-view=controls]').click();
    await expect(page.locator('#panel-controls')).toBeVisible();
    await page.screenshot({ path: path.join(output, style.id + '-controls.png'), fullPage: true });
    report.screenshots.push(style.id + '-controls.png');
    await page.locator('#view-switcher [data-view=raw]').click();
    await expect(page.locator('#panel-raw')).toBeVisible();
    assert.equal(page.url(), url);
    report.styles.push({ ...style, geometry });
    await page.setViewportSize({ width: 1280, height: 960 });
  }
  assert.equal(report.errors.length, 0, report.errors.join('; '));
  assert.equal(report.remoteRequests.length, 0, 'preview requested remote resources');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(output, 'visual-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({
    status: report.status,
    styles: report.styles.length,
    rawSources: hashes.length,
    screenshots: report.screenshots.length,
    output: path.relative(root, output),
  }),
);
