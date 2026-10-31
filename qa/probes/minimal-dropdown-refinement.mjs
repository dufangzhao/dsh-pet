/* global CSS */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  base = path.join(root, 'qa/minimal-settings-preview'),
  out = path.join(base, 'screenshots');
await fs.mkdir(out, { recursive: true });
const report = {
  scope: 'provider logos and three native styled select controls',
  errors: [],
  remoteRequests: [],
  captures: [],
  pickers: [],
};
const b = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  report.browser = b.version();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  p.on('pageerror', (e) => report.errors.push(e.message));
  p.on('request', (r) => {
    if (/^https?:/.test(r.url())) report.remoteRequests.push(r.url());
  });
  await p.goto(pathToFileURL(path.join(base, 'index.html')).href);
  report.nativeSupport = await p.evaluate(() => ({
    baseSelect: CSS.supports('appearance', 'base-select'),
    picker: CSS.supports('selector(::picker(select))'),
  }));
  assert.ok(report.nativeSupport.baseSelect && report.nativeSupport.picker);
  const provider = p.locator('#provider-select');
  await expect(provider.locator('option')).toHaveCount(7);
  const logos = await provider
    .locator('option img')
    .evaluateAll((imgs) =>
      imgs.map((i) => ({ src: i.getAttribute('src'), ready: i.complete && i.naturalWidth > 0 })),
    );
  assert.equal(logos.length, 7);
  assert.ok(
    logos.every((i) => i.ready),
    'provider logo missing',
  );
  report.logos = logos;
  async function shot(name) {
    await p.screenshot({ path: path.join(out, name), fullPage: true });
    report.captures.push(name);
  }
  for (const width of [1200, 880]) {
    await p.setViewportSize({ width, height: width === 1200 ? 900 : 760 });
    await p.locator('#nav-start').click();
    await shot('provider-closed-' + width + '.png');
    await provider.click();
    await expect(p.locator('#provider-select:open')).toHaveCount(1);
    await shot('provider-open-' + width + '.png');
    const boxes = await provider.locator('option').evaluateAll((options) =>
      options.map((o) => {
        const r = o.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    assert.ok(
      boxes.every(
        (r) =>
          r.left >= 0 &&
          r.right <= width + 1 &&
          r.top >= 0 &&
          r.bottom <= (width === 1200 ? 900 : 760) + 1,
      ),
      'provider picker clipped',
    );
    report.pickers.push({ id: 'provider-select', width, options: boxes.length });
    await p.keyboard.press('Escape');
    await expect(p.locator('#provider-select:open')).toHaveCount(0);
  }
  await p.setViewportSize({ width: 1200, height: 900 });
  await provider.click();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await expect(provider).toHaveValue('gemini');
  await expect(p.locator('#model-name-input')).toHaveAttribute('placeholder', /gemini/);
  assert.ok(
    await provider.locator('selectedcontent img').getAttribute('src'),
    'selected provider logo missing',
  );
  await provider.click();
  await p.locator('.titlebar__name').click();
  await expect(p.locator('#provider-select:open')).toHaveCount(0);
  await p.locator('#nav-voice').click();
  for (const id of ['voice-model-select', 'voice-after-select']) {
    const el = p.locator('#' + id);
    await el.click();
    await expect(p.locator('#' + id + ':open')).toHaveCount(1);
    await shot(id + '-open-1200.png');
    await p.keyboard.press('Escape');
    await expect(p.locator('#' + id + ':open')).toHaveCount(0);
  }
  await p.locator('#voice-after-select').click();
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await expect(p.locator('#voice-after-select')).toHaveValue('keep');
  report.interactions = {
    keyboardSelection: true,
    escape: true,
    outsideDismissal: true,
    providerLocalBinding: true,
    selectedLogo: true,
    voiceLocalBinding: true,
  };
  assert.equal(report.errors.length, 0, report.errors.join(';'));
  assert.equal(report.remoteRequests.length, 0);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.failure = String(e);
  throw e;
} finally {
  await b.close();
  await fs.writeFile(
    path.join(out, 'dropdown-report.json'),
    JSON.stringify(report, null, 2) + String.fromCharCode(10),
  );
}
console.log(
  JSON.stringify({
    status: report.status,
    logos: report.logos?.length,
    pickers: report.pickers.length,
    captures: report.captures.length,
  }),
);
