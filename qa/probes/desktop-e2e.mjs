import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import koffi from 'koffi';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContrast } from './contrast.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const electronPackagePath = require.resolve('electron/package.json');
const electronPackage = JSON.parse(await fs.readFile(electronPackagePath, 'utf8'));
assert.equal(electronPackage.version, '45.0.0');
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
const electronPath = path.join(path.dirname(electronPackagePath), 'dist/electron.exe');
await fs.access(electronPath);
const scale = process.argv[2] ?? '1';
if (process.argv.length > 3 || !['1', '1.25', '1.5'].includes(scale)) throw new Error('Usage: desktop-e2e.mjs [1|1.25|1.5]');
const out = path.join(root, scale === '1' ? '.cache/m0-06-real' : '.cache/m0-06-scale-' + scale.replace('.', '_'));
await fs.mkdir(out, { recursive: true });
const user32 = koffi.load(path.join(process.env.SystemRoot, 'System32/user32.dll'));
const getForeground = user32.func('uintptr_t __stdcall GetForegroundWindow(void)');
const getWindowLong = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int index)');
const originalForeground = String(getForeground());
const env = {};
for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH']) {
  if (process.env[name]) env[name] = process.env[name];
}
const report = { at: new Date().toISOString(), status: 'running', requestedDeviceScale: Number(scale), checks: [], consoleErrors: [], remoteRequests: [], screenshots: [] };
const assetDir = path.join(root, 'apps/desktop/dist/renderer/pet/assets');
const artifacts = ['dist/main/index.mjs', 'dist/preload/index.cjs', 'dist/renderer/pet/index.html', ...(await fs.readdir(assetDir)).filter(name => name.endsWith('.css') || name.endsWith('.js')).map(name => 'dist/renderer/pet/assets/' + name)];
report.artifacts = [];
for (const artifact of artifacts) { const bytes = await fs.readFile(path.join(root, 'apps/desktop', artifact)); report.artifacts.push({ path: artifact, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
let app;
try {
  app = await _electron.launch({ executablePath: electronPath, args: [path.join(root, 'apps/desktop'), ...(scale === '1' ? [] : ['--force-device-scale-factor=' + scale])], env, timeout: 20000 });
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, platform: process.platform, arch: process.arch }));
  assert.equal(report.runtime.electron, '45.0.0');
  assert.equal(report.runtime.platform, 'win32');
  assert.equal(report.runtime.arch, 'x64');
  const page = await app.firstWindow({ timeout: 15000 });
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) report.remoteRequests.push(request.url()); });
  await page.waitForFunction(() => typeof globalThis.pet === 'object', null, { timeout: 10000 });
  await expect(page.getByTestId('pet-stage')).toBeVisible();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  const metadata = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences();
    return { hwnd: w.getNativeWindowHandle().readBigUInt64LE().toString(), visible: w.isVisible(),
      topmost: w.isAlwaysOnTop(), bounds: w.getBounds(), webZoom: w.webContents.getZoomFactor(),
      preferences: { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity },
      displays: screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })) };
  });
  report.window = metadata;
  assert.equal(metadata.webZoom, 1, 'DPR test must not inherit an unrelated web zoom factor');
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  assert.ok(Math.abs(report.viewport.dpr - Number(scale)) < 0.01, 'Requested process scale must be observed');
  const afterLaunch = String(getForeground());
  report.startupFocus = originalForeground === '0' || afterLaunch === '0' ? 'unknown'
    : afterLaunch === originalForeground ? 'preserved' : afterLaunch === metadata.hwnd ? 'stolen' : 'changed-by-other';
  assert.notEqual(report.startupFocus, 'stolen', 'showInactive must not activate the pet');
  assert.equal(metadata.topmost, true);
  assert.equal(metadata.preferences.sandbox, true);
  assert.equal(metadata.preferences.contextIsolation, true);
  assert.equal(metadata.preferences.nodeIntegration, false);
  assert.notEqual(metadata.preferences.webSecurity, false);
  const isolated = await page.evaluate(() => ({ require: typeof globalThis.require, process: typeof globalThis.process,
    frozen: Object.isFrozen(globalThis.pet), methods: Object.keys(globalThis.pet) }));
  assert.equal(isolated.require, 'undefined'); assert.equal(isolated.process, 'undefined'); assert.equal(isolated.frozen, true);
  report.bridge = isolated; report.checks.push('secure-window-and-isolated-preload');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const state of ['idle', 'listening', 'thinking', 'replying', 'error']) {
    await page.getByTestId('state-' + state).click();
    await expect(page.getByTestId('pet-stage')).toHaveAttribute('data-state', state);
    await expect(page.getByTestId('state-' + state)).toHaveAttribute('aria-pressed', 'true');
    const screenshot = path.join(out, 'pet-' + state + '.png');
    await page.screenshot({ path: screenshot, omitBackground: true });
    report.screenshots.push(path.relative(root, screenshot).split(path.sep).join('/'));
  }
  report.checks.push('five-real-renderer-states');
  const readSamples = async (includeNotice = false) => page.evaluate((includeNotice) => {
    const definitions = includeNotice ? [['error-notice', '.pet-root__notice']] : [
      ['active-button', '.prototype-panel__button[data-active=true]'], ['inactive-button', '.prototype-panel__button[data-active=false]'],
      ['title', '.prototype-panel__title'], ['simulation-notice', '.prototype-panel__notice'],
      ['hint', '.prototype-panel__hint'], ['bubble', '.pet-bubble__text'], ['quit', '.prototype-panel__quit'],
    ];
    return definitions.map(([id, selector]) => {
      const el = document.querySelector(selector); if (!el) throw new Error('Missing style target ' + id);
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      const backgrounds = [], opacities = [], hiddenAncestors = [];
      for (let node = el; node; node = node.parentElement) { const s = getComputedStyle(node); backgrounds.push(s.backgroundColor); opacities.push(s.opacity); if (s.display === 'none' || s.visibility === 'hidden' || s.clipPath !== 'none') hiddenAncestors.push(String(node.className || node.tagName)); }
      return { id, color: style.color, backgrounds, opacities, hiddenAncestors, fontSize: parseFloat(style.fontSize), disabled: el.matches(':disabled'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right } };
    });
  }, includeNotice);
  await page.mouse.move(1, 1);
  report.styleSamples = await readSamples();
  report.contrast = report.styleSamples.filter(s => !s.disabled).map(s => checkContrast(s));
  assert.ok(report.contrast.every(s => s.passed), 'All measured text colors must meet 4.5:1');
  await page.getByTestId('state-error').hover();
  const activeHover = (await readSamples()).find(s => s.id === 'active-button');
  report.activeHoverContrast = checkContrast({ ...activeHover, id: 'active-button-hover' });
  assert.equal(report.activeHoverContrast.passed, true);
  await page.getByTestId('pet-quit').hover();
  const quitHover = (await readSamples()).find(s => s.id === 'quit');
  report.quitHoverContrast = checkContrast({ ...quitHover, id: 'quit-hover' });
  assert.equal(report.quitHoverContrast.passed, true);
  for (const sample of report.styleSamples) {
    assert.ok(sample.fontSize >= 12, 'Text below 12px: ' + sample.id);
    if (sample.id === 'bubble') assert.ok(sample.hiddenAncestors.length === 0 && sample.rect.width >= 16 && sample.rect.height >= 12, 'Core bubble must remain visually present');
    assert.ok(sample.rect.x >= -0.5 && sample.rect.y >= -0.5 && sample.rect.right <= report.viewport.width + 0.5 && sample.rect.bottom <= report.viewport.height + 0.5, 'Clipped text: ' + sample.id);
  }
  const buttons = await page.locator('button').evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
  assert.ok(buttons.every(b => b.width >= 44 && b.height >= 44), 'Button targets must actually reach 44px');
  await page.evaluate(() => {
    const note = document.createElement('p'); note.className = 'pet-root__notice'; note.dataset.qaNotice = 'true';
    note.textContent = '请求参数不被主进程接受，界面仍可查看，但状态不会同步。';
    document.querySelector('.pet-root__panel').append(note);
  });
  const notice = (await readSamples(true))[0]; report.noticeContrast = checkContrast(notice);
  assert.equal(report.noticeContrast.passed, true);
  const quitBox = await page.getByTestId('pet-quit').boundingBox();
  assert.ok(notice.rect.bottom <= report.viewport.height + 0.5 && quitBox.y + quitBox.height <= report.viewport.height + 0.5, 'Notice fixture must not clip the exit control');
  const noticeShot = path.join(out, 'notice-layout-fixture.png');
  await page.screenshot({ path: noticeShot, omitBackground: true });
  report.screenshots.push(path.relative(root, noticeShot).split(path.sep).join('/'));
  await page.evaluate(() => document.querySelector('[data-qa-notice]').remove());
  report.checks.push('computed-text-contrast-and-notice-layout-fixture');

  const invalid = await page.evaluate(() => globalThis.pet.previewState('__invalid__'));
  assert.deepEqual(invalid, { ok: false, error: 'invalid-request' });
  report.checks.push('invalid-ipc-payload-rejected');
  await page.mouse.move(1, 1);
  await expect.poll(async () => (await page.evaluate(() => globalThis.pet.getSnapshot())).value.clickThrough).toBe(true);
  const styleFor = () => Number(getWindowLong(BigInt(metadata.hwnd), -20));
  report.blankNativeTransparent = (styleFor() & 0x20) !== 0;
  assert.equal(report.blankNativeTransparent, true);
  await page.getByTestId('state-idle').hover();
  await expect.poll(async () => (await page.evaluate(() => globalThis.pet.getSnapshot())).value.clickThrough).toBe(false);
  report.controlNativeTransparent = (styleFor() & 0x20) !== 0;
  assert.equal(report.controlNativeTransparent, false);
  report.checks.push('renderer-hit-test-toggles-native-WS_EX_TRANSPARENT');
  await page.getByTestId('state-thinking').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pet-stage')).toHaveAttribute('data-state', 'thinking');
  report.checks.push('keyboard-state-button');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => { const el = document.activeElement, style = getComputedStyle(el), backgrounds = [], opacities = []; for(let node = el.parentElement; node; node = node.parentElement) { const s = getComputedStyle(node); backgrounds.push(s.backgroundColor); opacities.push(s.opacity); } return { id: 'focus-ring', color: style.outlineColor, backgrounds, opacities, focusVisible: el.matches(':focus-visible'), width: parseFloat(style.outlineWidth) }; });
  report.focusContrast = checkContrast(focus, 3);
  assert.ok(focus.focusVisible && focus.width >= 2 && report.focusContrast.passed, 'Visible focus outline must meet 3:1 against adjacent surface');
  const drag = await page.evaluate(async () => {
    await globalThis.pet.beginDrag();
    await globalThis.pet.setInteraction(false);
    const during = await globalThis.pet.getSnapshot();
    await globalThis.pet.endDrag();
    return { during, after: await globalThis.pet.getSnapshot() };
  });
  assert.equal(drag.during.value.dragging, true); assert.equal(drag.during.value.clickThrough, false);
  assert.equal(drag.after.value.dragging, false); assert.equal(drag.after.value.clickThrough, true);
  report.checks.push('real-ipc-drag-lifecycle');
  await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]; const b = w.getBounds();
    const d = screen.getPrimaryDisplay(); w.setBounds({ ...b, x: d.bounds.x - 10000, y: d.bounds.y - 10000 });
  });
  const restored = await page.evaluate(async () => { await globalThis.pet.beginDrag(); return globalThis.pet.endDrag(); });
  const b = restored.value.bounds;
  assert.ok(metadata.displays.some(d => b.x >= d.workArea.x && b.y >= d.workArea.y &&
    b.x + b.width <= d.workArea.x + d.workArea.width && b.y + b.height <= d.workArea.y + d.workArea.height));
  report.checks.push('real-window-offscreen-recovery');
  const countBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await page.evaluate(() => { window.open('https://example.invalid'); });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(countBefore);
  report.checks.push('popup-denied');
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.remoteRequests, []);
  report.status = 'passed';
  report.limitations = ['CDP pointer actions plus native style readback are not a physical OS click-through test',
    'Drag lifecycle and offscreen recovery tested; physical cursor-follow drag remains untested',
    'Process-only forced device scale is not an OS DPI change or a physical mixed-DPI sweep',
    'Synthetic notice only verifies style/layout, not the React error lifecycle',
    'No screen-reader or keyboard alternative-to-drag acceptance'];
} catch (error) {
  report.status = 'failed'; report.error = error.message;
  process.exitCode = 1;
} finally {
  if (app) { try { await app.close(); } catch { report.cleanup = 'close failed'; process.exitCode = 1; } }
  user32.unload();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
