import { _electron, chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkContrast } from './contrast.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const { build } = await import(pathToFileURL(desktopRequire.resolve('vite')).href);
const out = path.join(root, '.cache/m2-ui-kit');
const shots = path.join(root, 'qa/screenshots/m2');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(shots, { recursive: true });
await fs.mkdir(path.join(out, 'profile'), { recursive: true });
await fs.writeFile(path.join(out, 'index.html'), '<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UI-kit 验收</title><div id="root"></div><script type="module" src="./renderer.ts"></script></html>');
await fs.writeFile(path.join(out, 'renderer.ts'), `import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UiKitDemo } from '../../packages/ui-kit/src/index.ts';
document.body.style.cssText = 'margin:0;padding:32px;';
createRoot(document.getElementById('root')!).render(createElement(StrictMode, null, createElement(UiKitDemo)));
`);
await build({ configFile: false, root: out, base: './', define: { 'process.env.NODE_ENV': JSON.stringify('development') }, build: { outDir: path.join(out, 'dist'), emptyOutDir: true }, logLevel: 'warn' });
await fs.writeFile(path.join(out, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'profile'));
app.whenReady().then(async () => { const w = new BrowserWindow({width:920,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}); await w.loadFile(path.join(__dirname,'dist/index.html')); });
app.on('window-all-closed', () => app.quit());
`);
const require = createRequire(import.meta.url);
const electronPath = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const env = {};
for (const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA']) if (process.env[name]) env[name] = process.env[name];
const report = { status: 'running', at: new Date().toISOString(), checks: [], contrast: [], screenshots: [], errors: [] };
const chromiumOnly = process.argv.includes('--chromium');
const sandboxOverride = process.argv.includes('--no-sandbox');
report.sandboxOverride = sandboxOverride;
let app, browser;
try {
  let page;
  if (chromiumOnly) {
    browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'], ...(process.env['PET_QA_CHROMIUM'] ? { executablePath: process.env['PET_QA_CHROMIUM'] } : {}) });
    page = await browser.newPage({ viewport: { width: 920, height: 900 } });
    await page.goto(pathToFileURL(path.join(out, 'dist/index.html')).href);
    report.runtime = { chromium: browser.version() };
  } else {
    app = await _electron.launch({ executablePath: electronPath, args: [...(sandboxOverride ? ['--no-sandbox'] : []), path.join(out, 'main.cjs')], env, timeout: 20000 });
    report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node }));
    assert.equal(report.runtime.electron, '45.0.0');
    page = await app.firstWindow();
  }
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url())) report.errors.push('Remote request: ' + r.url()); });
  await expect(page.getByRole('button', { name: '打开对话框', exact: true })).toBeVisible();
  const input = page.getByLabel('显示名称', { exact: true });
  await input.fill('桌宠组件');
  await expect(input).toHaveValue('桌宠组件');
  assert.ok(await input.evaluate(el => document.getElementById(el.getAttribute('aria-describedby')).textContent.length > 0));
  const invalid = page.locator('input[aria-invalid="true"]');
  assert.ok(await invalid.evaluate(el => el.getAttribute('aria-describedby').split(' ').some(id => document.getElementById(id).getAttribute('role') === 'alert')));
  report.checks.push('field-label-description-error-associations');

  const trigger = page.getByRole('button', { name: '打开对话框', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  for (const key of [...Array(7).fill('Tab'), ...Array(7).fill('Shift+Tab')]) {
    await page.keyboard.press(key);
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'Dialog focus escaped');
  }
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { width: parseFloat(s.outlineWidth), style: s.outlineStyle }; });
  assert.ok(ring.width >= 2 && ring.style !== 'none');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(trigger).toBeFocused();
  report.checks.push('dialog-initial-focus-tab-trap-escape-cancel-close-restore-in-strict-mode');

  const notify = page.getByRole('button', { name: '显示通知', exact: true });
  await notify.click();
  await expect(page.locator('.pk-toast')).toBeVisible();
  await expect(notify).toBeFocused();
  await page.getByRole('button', { name: /^关闭提示/ }).click();
  await expect(page.locator('.pk-toast')).toHaveCount(0);
  await notify.click();
  await expect(page.locator('.pk-toast')).toBeVisible();
  await expect(page.locator('.pk-toast')).toHaveCount(0, { timeout: 6500 });
  report.checks.push('toast-status-no-focus-steal-manual-and-timed-dismissal');

  for (const theme of ['light', 'dark', 'system']) {
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark', reducedMotion: 'reduce' });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    assert.equal(scheme, theme === 'light' ? 'light' : 'dark');
    const samples = await page.locator('.pk-section__title, .pk-section__description, .pk-field__label, .pk-field__description, .pk-field__error, .pk-input, .pk-button:not(:disabled), .pk-badge, .pk-empty__description').evaluateAll(nodes => nodes.filter(el => el.checkVisibility()).map((el, index) => {
      const s = getComputedStyle(el), backgrounds = [], opacities = [];
      for (let node = el; node; node = node.parentElement) { const style = getComputedStyle(node); backgrounds.push(style.backgroundColor); opacities.push(style.opacity); }
      return { id: el.className + '-' + index, color: s.color, backgrounds, opacities };
    }));
    const checks = samples.map(sample => checkContrast(sample));
    assert.ok(checks.length > 10 && checks.every(c => c.passed), 'Theme text contrast failed: ' + JSON.stringify(checks.filter(c => !c.passed)));
    report.contrast.push({ theme, minimum: Math.min(...checks.flatMap(c => c.cases.map(x => x.ratio))), measured: checks.length });
    if (theme !== 'system') { const image = path.join(shots, 'ui-kit-' + theme + '.png'); await page.screenshot({ path: image, fullPage: true }); report.screenshots.push(path.relative(root, image).split(path.sep).join('/')); }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
  report.checks.push('light-dark-system-theme-and-live-system-change', 'computed-text-contrast-at-least-4.5', 'visible-keyboard-focus');
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); }
finally { if (app) await app.close(); if (browser) await browser.close(); }
report.artifacts = {};
for (const file of ['packages/ui-kit/src/index.ts','packages/ui-kit/src/dialog.tsx','packages/ui-kit/src/theme.css','pnpm-lock.yaml']) report.artifacts[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
await fs.writeFile(path.join(root, chromiumOnly ? 'qa/M2-ui-kit-chromium-results.json' : 'qa/M2-ui-kit-results.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10));
console.log(JSON.stringify(report));
if (report.status !== 'passed') process.exitCode = 1;
