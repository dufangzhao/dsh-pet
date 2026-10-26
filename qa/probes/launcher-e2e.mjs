import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import koffi from 'koffi';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const report = { status: 'running', at: new Date().toISOString(), checks: [] };
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH']) if (process.env[key]) env[key] = process.env[key];
env.ELECTRON_RUN_AS_NODE = '1';
const u = koffi.load('user32.dll');
koffi.struct('LauncherRect', { left: 'int', top: 'int', right: 'int', bottom: 'int' });
const callbackType = koffi.proto('bool __stdcall LauncherEnum(uintptr_t, intptr_t)');
const enumerate = u.func('bool __stdcall EnumWindows(LauncherEnum *, intptr_t)');
const owner = u.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t, _Out_ uint32_t *)');
const text = u.func('int __stdcall GetWindowTextW(uintptr_t, _Out_ void *, int)');
const visible = u.func('bool __stdcall IsWindowVisible(uintptr_t)');
const minimized = u.func('bool __stdcall IsIconic(uintptr_t)');
const foreground = u.func('uintptr_t __stdcall GetForegroundWindow(void)');
const bounds = u.func('bool __stdcall GetWindowRect(uintptr_t, _Out_ LauncherRect *)');
const show = u.func('bool __stdcall ShowWindow(uintptr_t, int)');
const metric = u.func('int __stdcall GetSystemMetrics(int)');
function windows(pid) {
  const rows = [];
  const callback = koffi.register((hwnd) => {
    const processId = [0]; owner(hwnd, processId);
    if (processId[0] !== pid) return true;
    const buffer = Buffer.alloc(1024); text(hwnd, buffer, 512);
    const title = buffer.toString('utf16le').split(String.fromCharCode(0))[0];
    const rect = {}; bounds(hwnd, rect);
    rows.push({ hwnd: String(hwnd), title, visible: visible(hwnd), minimized: minimized(hwnd), foreground: String(foreground()) === String(hwnd), bounds: rect });
    return true;
  }, koffi.pointer(callbackType));
  try { enumerate(callback, 0); } finally { koffi.unregister(callback); }
  return rows;
}
function launch(extra = '') {
  const command = '""' + path.join(root, '启动桌宠.cmd') + '" --m1-host-smoke ' + extra + '"';
  const child = spawn(path.join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/s', '/c', command], { cwd: path.dirname(root), env, windowsVerbatimArguments: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const task = { child, output: '', errors: '', settled: false, code: null };
  child.stdout.on('data', data => { task.output += data.toString('utf8'); });
  child.stderr.on('data', data => { task.errors += data.toString('utf8'); });
  task.done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => { task.settled = true; task.code = code; resolve(code); }); });
  return task;
}
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const first = launch('--remote-debugging-port=' + port);
let browser, pet;
try {
  await expect.poll(async () => {
    assert.ok(!first.settled, first.output + first.errors);
    try { return (await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
  }, { timeout: 20000 }).toBe(true);
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().some(page => page.url().includes('/console/index.html'))).toBe(true);
  pet = context.pages().find(page => page.url().includes('/pet/index.html'));
  let settings = context.pages().find(page => page.url().includes('/console/index.html'));
  await expect(settings.getByRole('heading', { level: 1, name: '开始', exact: true })).toBeVisible();
  await expect(settings.getByTestId('theme-select').getByRole('radio')).toHaveCount(3);
  const cdp = await browser.newBrowserCDPSession();
  const info = await cdp.send('SystemInfo.getProcessInfo');
  const pid = info.processInfo.find(item => item.type === 'browser').id;
  const title = await settings.title();
  await expect.poll(() => windows(pid).find(window => window.title === title)?.visible).toBe(true);
  const original = windows(pid).find(window => window.title === title);
  assert.equal(original.minimized, false);
  const virtual = { x: metric(76), y: metric(77), width: metric(78), height: metric(79) };
  assert.ok(original.bounds.right > virtual.x && original.bounds.left < virtual.x + virtual.width && original.bounds.bottom > virtual.y && original.bounds.top < virtual.y + virtual.height);
  report.initialWindow = original;
  report.checks.push('launcher-opens-native-visible-settings-without-pet-click-or-keyboard-input');
  show(Number(original.hwnd), 6);
  await expect.poll(() => minimized(Number(original.hwnd))).toBe(true);
  const second = launch();
  await expect.poll(() => second.settled, { timeout: 15000 }).toBe(true);
  assert.equal(await second.done, 0, second.output + second.errors);
  await expect.poll(() => minimized(Number(original.hwnd))).toBe(false);
  const reused = windows(pid).filter(window => window.title === title);
  assert.equal(reused.length, 1); assert.equal(reused[0].hwnd, original.hwnd); assert.equal(reused[0].visible, true);
  report.reusedWindow = reused[0];
  report.checks.push('second-launch-restores-same-native-window-and-exits-without-a-second-host');
  await settings.close();
  const opening = context.waitForEvent('page');
  const third = launch();
  await expect.poll(() => third.settled, { timeout: 15000 }).toBe(true);
  assert.equal(await third.done, 0, third.output + third.errors);
  settings = await opening;
  await expect(settings.getByRole('heading', { level: 1, name: '开始', exact: true })).toBeVisible();
  await expect.poll(() => windows(pid).some(window => window.title === title && window.visible && !window.minimized)).toBe(true);
  report.checks.push('relaunch-reopens-closed-settings-in-existing-host');
  await pet.getByRole('button', { name: /退出/ }).click();
  await expect.poll(() => first.settled).toBe(true);
  assert.equal(await first.done, 0);
  report.checks.push('pet-exit-closes-host-and-launcher-cleanly');
  report.automaticCompatibility = first.output.includes('Using local compatibility preview');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; } finally {
  if (browser?.isConnected()) { if (pet && !pet.isClosed()) await pet.getByRole('button', { name: /退出/ }).click().catch(error => { report.cleanupError = error.message; }); await browser.close(); }
  if (!first.settled) { first.child.kill(); await first.done; }
  report.launchOutput = first.output; report.launchErrors = first.errors;
  await fs.writeFile(path.join(root, '.cache/launcher-e2e-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); u.unload();
}
