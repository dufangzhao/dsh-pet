import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import koffi from 'koffi';

// Opt-in OS mouse input, limited to owned windows. No keyboard input.
assert.ok(process.argv.includes('--os-input'), 'Use --os-input for this owned-window mouse test');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executablePath = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH']) if (process.env[key]) env[key] = process.env[key];
const u = koffi.load('user32.dll');
koffi.struct('PetPoint', { x: 'int', y: 'int' });
koffi.struct('PetRect', { left: 'int', top: 'int', right: 'int', bottom: 'int' });
const mi = koffi.struct('PetMouseInput', { dx: 'int32_t', dy: 'int32_t', mouseData: 'uint32_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' });
const data = koffi.union('PetInputData', { mi });
const input = koffi.struct('PetInput', { type: 'uint32_t', data });
assert.equal(koffi.sizeof(input), 40);
const cursor = u.func('bool __stdcall GetCursorPos(_Out_ PetPoint *)');
const move = u.func('bool __stdcall SetCursorPos(int, int)');
const hitWindow = u.func('uintptr_t __stdcall WindowFromPoint(PetPoint)');
const owner = u.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t, _Out_ uint32_t *)');
const clientRect = u.func('bool __stdcall GetClientRect(uintptr_t, _Out_ PetRect *)');
const clientOrigin = u.func('bool __stdcall ClientToScreen(uintptr_t, _Inout_ PetPoint *)');
const nativeRect = u.func('bool __stdcall GetWindowRect(uintptr_t, _Out_ PetRect *)');
const metric = u.func('int __stdcall GetSystemMetrics(int)');
const visible = u.func('bool __stdcall IsWindowVisible(uintptr_t)');
const send = u.func('uint32_t __stdcall SendInput(uint32_t, const PetInput *, int)');
const dpi = u.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t)');
const previousDpi = dpi(-4);
assert.notEqual(previousDpi, 0);
const original = {}; assert.ok(cursor(original));
const report = { status: 'running', at: new Date().toISOString(), input: 'Win32 SetCursorPos and SendInput, owned windows only', checks: [] };
let app, target, pet, down = false;
function mouse(flags) {
  const records = flags.map(dwFlags => ({ type: 0, data: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags, time: 0, dwExtraInfo: 0x50455432 } } }));
  assert.equal(send(records.length, records, koffi.sizeof(input)), records.length);
}
function moveInput(point) {
  const dx = Math.round((point.x - metric(76)) * 65535 / (metric(78) - 1));
  const dy = Math.round((point.y - metric(77)) * 65535 / (metric(79) - 1));
  assert.equal(send(1, [{ type: 0, data: { mi: { dx, dy, mouseData: 0, dwFlags: 0xc001, time: 0, dwExtraInfo: 0x50455432 } } }], koffi.sizeof(input)), 1);
}
function hitPid(point) { const pid = [0]; owner(hitWindow(point), pid); return pid[0]; }
function rect(hwnd) { const value = {}; assert.ok(nativeRect(hwnd, value)); return value; }
async function snapshot() { const value = await pet.evaluate(() => globalThis.pet.getSnapshot()); assert.ok(value.ok); return value.value; }
try {
  app = await _electron.launch({ executablePath, args: ['--no-sandbox', path.join(root, 'apps/desktop'), '--m0-mouse-lab', '--show-settings'], env, timeout: 20000 });
  await app.firstWindow();
  await expect.poll(() => app.windows().some(page => page.url().includes('/console/index.html'))).toBe(true);
  pet = app.windows().find(page => page.url().includes('/pet/index.html'));
  await expect(pet.getByTestId('pet-avatar')).toBeVisible();
  await app.windows().find(page => page.url().includes('/console/index.html')).close();
  const meta = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/pet/index.html'));
    return { pid: process.pid, hwnd: Number(win.getNativeWindowHandle().readBigUInt64LE()), bounds: win.getBounds(), scaleFactor: screen.getDisplayMatching(win.getBounds()).scaleFactor };
  });
  report.pet = meta;
  await pet.evaluate(() => {
    globalThis.__pointerCheck = [];
    for (const type of ['pointermove', 'mousemove', 'pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => { globalThis.__pointerCheck.push({ type, x: event.clientX, y: event.clientY, trusted: event.isTrusted, target: event.target.closest('[data-testid]')?.dataset.testid }); if (globalThis.__pointerCheck.length > 80) globalThis.__pointerCheck.shift(); }, { capture: true, passive: true });
  });
  target = await _electron.launch({ executablePath, args: ['--no-sandbox', path.join(root, 'qa/fixtures/pet-pointer-underlay.cjs'), '--bounds', JSON.stringify(meta.bounds)], env, timeout: 20000 });
  const board = await target.firstWindow();
  await board.waitForFunction(() => Boolean(globalThis.__m0MouseTarget));
  const targetPid = await target.evaluate(() => process.pid);
  assert.notEqual(targetPid, meta.pid);
  report.targetPid = targetPid;
  const viewport = await pet.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  function point(x, y) {
    const area = {}; clientRect(meta.hwnd, area); const origin = { x: 0, y: 0 }; clientOrigin(meta.hwnd, origin);
    return { x: Math.round(origin.x + x * area.right / viewport.width), y: Math.round(origin.y + y * area.bottom / viewport.height) };
  }
  async function hover(p, pid) {
    moveInput(p);
    await expect.poll(() => hitPid(p), { timeout: 3000 }).toBe(pid);
  }
  await hover(point(5, 5), targetPid);
  await expect.poll(async () => (await snapshot()).clickThrough).toBe(true);
  mouse([2, 4]);
  await expect.poll(() => board.evaluate(() => globalThis.__m0MouseTarget.clicks)).toBe(1);
  assert.equal(await board.evaluate(() => globalThis.__m0MouseTarget.lastEvent.isTrusted), true);
  report.checks.push('transparent-corner-delivers-native-click-to-separate-owned-underlay');
  const avatar = await pet.getByTestId('pet-avatar').boundingBox();
  const start = point(avatar.x + avatar.width / 2, avatar.y + avatar.height / 2);
  await hover(start, meta.pid);
  await expect.poll(async () => (await snapshot()).clickThrough).toBe(false);
  const before = rect(meta.hwnd);
  mouse([2]); down = true;
  await expect.poll(async () => (await snapshot()).dragging).toBe(true);
  moveInput({ x: start.x - 50, y: start.y - 30 });
  await expect.poll(() => rect(meta.hwnd).left).toBeLessThan(before.left - 30);
  mouse([4]); down = false;
  await expect.poll(async () => (await snapshot()).dragging).toBe(false);
  const after = rect(meta.hwnd);
  assert.ok(Math.abs(after.left - before.left + 50) <= 2);
  assert.ok(Math.abs(after.top - before.top + 30) <= 2);
  report.drag = { before, after };
  report.checks.push('native-avatar-drag-moves-window-and-releases');
  await app.evaluate(({ BrowserWindow }, oldBounds) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/pet/index.html')).setBounds(oldBounds); }, meta.bounds);
  await hover(point(5, 5), targetPid);
  await expect.poll(async () => (await snapshot()).clickThrough).toBe(true);
  const button = await pet.getByTestId('pet-settings').boundingBox();
  const settingPoint = point(button.x + button.width / 2, button.y + button.height / 2);
  await hover(settingPoint, meta.pid);
  const targetBefore = await board.evaluate(() => globalThis.__m0MouseTarget.clicks);
  const opening = app.waitForEvent('window');
  mouse([2, 4]);
  const settings = await opening;
  await expect(settings.getByRole('heading', { level: 1, name: '开始', exact: true })).toBeVisible();
  const settingsNative = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/console/index.html')); return { hwnd: Number(win.getNativeWindowHandle().readBigUInt64LE()), visible: win.isVisible(), focused: win.isFocused() }; });
  await expect.poll(() => visible(settingsNative.hwnd)).toBe(true);
  assert.equal(await board.evaluate(() => globalThis.__m0MouseTarget.clicks), targetBefore);
  report.settings = settingsNative;
  report.checks.push('native-settings-button-opens-visible-settings-without-clicking-underlay');
  report.events = await pet.evaluate(() => globalThis.__pointerCheck);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack;
  if (pet && !pet.isClosed()) { report.snapshot = await snapshot().catch(() => null); report.events = await pet.evaluate(() => globalThis.__pointerCheck).catch(() => null); }
  process.exitCode = 1;
} finally {
  if (down) mouse([4]);
  assert.ok(move(original.x, original.y));
  const restored = {}; cursor(restored); report.pointerRestored = restored.x === original.x && restored.y === original.y;
  dpi(previousDpi);
  if (target) await target.close();
  if (app) await app.close();
  await fs.writeFile(path.join(root, '.cache/pet-pointer-e2e-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); u.unload();
}
