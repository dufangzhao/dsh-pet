import { _electron, expect } from '@playwright/test';
import electronPath from 'electron';
import koffi from 'koffi';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.cache/m0-06-real');
await fs.mkdir(out, { recursive: true });
const user32 = koffi.load(path.join(process.env.SystemRoot, 'System32/user32.dll'));
const getForeground = user32.func('uintptr_t __stdcall GetForegroundWindow(void)');
const getWindowLong = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int index)');
const originalForeground = String(getForeground());
const env = {};
for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH']) {
  if (process.env[name]) env[name] = process.env[name];
}
const report = { at: new Date().toISOString(), status: 'running', checks: [], consoleErrors: [], remoteRequests: [], screenshots: [] };
let app;
try {
  app = await _electron.launch({ executablePath: electronPath, args: [path.join(root, 'apps/desktop')], env, timeout: 20000 });
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
      topmost: w.isAlwaysOnTop(), bounds: w.getBounds(),
      preferences: { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity },
      displays: screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })) };
  });
  report.window = metadata;
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
    'Only reported actual display configuration covered; no physical display unplug/mixed-DPI sweep',
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
