// Native boundary baseline is available; full A1–A9 acceptance remains unimplemented.
// Run only after the parent freezes and builds the production artifacts.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';
import { startFaultProxy } from '../fixtures/companion-desktop/fault-proxy.mjs';
import { connectionDomCase } from '../fixtures/companion-desktop/connection-dom.mjs';
import { targetDomCase } from '../fixtures/companion-desktop/target-dom.mjs';

if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--full')) {
  console.log(JSON.stringify({ scope: 'full-native-acceptance', status: 'not-implemented',
    pending: 'A1–A9 DOM, lifecycle, chooser and fault cases; baseline does not satisfy this gate' }));
  process.exit(2);
}

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const browser = path.join(root, '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell');
const files = [
  'apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/preload/index.cjs',
  'apps/desktop/dist/runtime/worker.cjs', 'apps/desktop/dist/renderer/pet/index.html',
  'apps/desktop/dist/renderer/console/index.html', 'plugins/companion-client/plugin.json',
  'plugins/companion-client/dist/index.mjs', 'apps/desktop/src/main/builtin-admission.json',
  'plugins/text-client/dist/client.js',
];
async function tree(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await tree(file));
    else if (entry.isFile()) result.push(file);
    else throw new Error('Unexpected link in built renderer');
  }
  return result;
}
const hashes = async () => {
  const names = [...new Set([...files, ...await tree('apps/desktop/dist/renderer')])].sort();
  return Object.fromEntries(await Promise.all(names.map(async (file) => [file,
    createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
};
const mode = process.argv[2];
const report = { scope: mode === '--dom' ? 'connection-and-target-dom-only' : 'native-boundary-baseline-only',
  checks: [], pending: 'A1–A9 full acceptance and Windows integration' };
let display, service, secondService, proxy, secondProxy, app, web;
let exit = 1;
let stage = 'preflight';
try {
  assert.equal(process.argv.length, 3);
  assert.ok(['--baseline', '--dom'].includes(mode), 'Pass --baseline or --dom; full acceptance is not implemented');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  for (const file of [electron, browser, path.join(root, '.companion-data/tooling/desktop/libraries/usr/bin/proot'),
    path.join(root, '.companion-data/tooling/desktop/libraries/usr/bin/Xvfb')]) await access(file);
  const before = await hashes();
  stage = 'display';
  display = await startDisplay(root);
  stage = 'isolated-service';
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE);
  const profile = `shared-${randomUUID()}`;
  stage = 'production-electron-launch';
  app = await _electron.launch({ executablePath: electron,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=${profile}`, '--show-settings'],
    env: display.env, timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const pet = app.windows().find((page) => page.url().endsWith('/pet/index.html'));
  const consolePage = app.windows().find((page) => page.url().endsWith('/console/index.html'));
  assert.ok(pet && consolePage, 'production pet and console file windows required');
  stage = 'window-visibility';
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().length === 2 && BrowserWindow.getAllWindows().every((window) => window.isVisible())),
  { timeout: 30000 }).toBe(true);
  const native = await app.evaluate(({ BrowserWindow }) => ({
    platform: process.platform, arch: process.arch, electron: process.versions.electron,
    windows: BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible(),
      sandbox: w.webContents.getLastWebPreferences().sandbox,
      contextIsolation: w.webContents.getLastWebPreferences().contextIsolation,
      nodeIntegration: w.webContents.getLastWebPreferences().nodeIntegration })),
  }));
  assert.equal(native.platform, 'linux'); assert.equal(native.arch, 'x64');
  assert.equal(native.electron.split('.')[0], '45');
  assert.equal(native.windows.length, 2);
  for (const win of native.windows) {
    assert.equal(win.visible, true); assert.equal(win.sandbox, true);
    assert.equal(win.contextIsolation, true); assert.equal(win.nodeIntegration, false);
  }
  stage = 'frozen-preload-and-source';
  for (const page of [pet, consolePage]) {
    const boundary = await page.evaluate(() => ({
      companion: !!window.petCompanion && Object.isFrozen(window.petCompanion),
      presentation: !!window.petLocalPresentation && Object.isFrozen(window.petLocalPresentation),
      legacy: ['petDemo', 'petModels', 'petApplication'].filter((key) => key in window),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
    }));
    assert.equal(boundary.companion, true); assert.equal(boundary.presentation, true);
    assert.deepEqual(boundary.legacy, []); assert.match(boundary.csp, /connect-src 'none'/);
  }
  const source = await consolePage.evaluate(() => window.petConsole.getSnapshot());
  assert.equal(source.ok, true);
  const client = source.value.plugins.find((entry) => entry.owner.pluginId === 'pet.companion-client');
  assert.equal(client?.state, 'active', 'actual Linux source must be admitted and active');
  for (const id of ['pet.agent-cortico', 'pet.llm-provider', 'pet.chat', 'pet.voice-chat']) {
    assert.notEqual(source.value.plugins.find((entry) => entry.owner.pluginId === id)?.state, 'active');
  }
  report.checks.push('real-linux-windows-security-and-active-source');

  if (mode === '--dom') {
    stage = 'connection-form-dom';
    proxy = await startFaultProxy(service.url);
    report.checks.push(...await connectionDomCase(consolePage, service, proxy, (name) => { stage = name; }));
    stage = 'inflight-target-dom';
    secondService = await startService(process.env.PET_CLOUD_EXEC_IMAGE, 'QA Target B');
    secondProxy = await startFaultProxy(secondService.url);
    report.checks.push(...await targetDomCase(consolePage, service, proxy, secondService, secondProxy,
      (name) => { stage = name; }));
  } else {
  // This checks the production IPC boundary, not the console connection form.
  stage = 'source-bound-connection';
  const initial = await consolePage.evaluate(() => window.petCompanion.getState());
  assert.equal(initial.ok, true); assert.equal(initial.value.source, 'ready');
  const connected = await consolePage.evaluate((input) => window.petCompanion.connect(input), {
    expectedRevision: initial.value.configRevision, baseUrl: service.url, token: service.token,
  });
  assert.equal(connected.ok, true); assert.equal(connected.value.phase, 'live');
  const petState = await pet.evaluate(() => window.petCompanion.getState());
  const authoritative = await service.snapshot();
  assert.equal(petState.ok, true);
  assert.equal(petState.value.connectionId, connected.value.connectionId);
  assert.equal(petState.value.snapshot.agent.id, authoritative.agent.id);
  assert.equal(petState.value.snapshot.agent.profileRevision, authoritative.agent.profileRevision);
  const denied = await pet.evaluate((input) => window.petCompanion.connect(input), {
    expectedRevision: initial.value.configRevision, baseUrl: service.url, token: service.token,
  });
  assert.equal(denied.ok, false); assert.equal(denied.error.code, 'permission-denied');
  report.checks.push('one-real-main-connection-and-pet-role-denial');

  stage = 'web-client';
  web = await chromium.launch({ executablePath: browser, chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], env: display.env });
  const page = await web.newPage();
  await page.goto(service.url, { waitUntil: 'domcontentloaded' });
  await page.locator('#tc-token').fill(service.token);
  await page.locator('#tc-token').press('Enter');
  await page.locator('.tc-chat').waitFor({ timeout: 30000 });
  report.checks.push('actual-web-client-connected-to-same-service');
  }
  assert.deepEqual(await hashes(), before, 'build artifacts changed during run');
  report.buildHashes = before;
  report.runtime = { platform: native.platform, arch: native.arch, electron: native.electron,
    windowCount: native.windows.length, noSandboxFlag: true };
  report.status = mode === '--dom' ? 'connection-dom-passed' : 'baseline-passed';
  exit = 0;
} catch (error) {
  // Diagnostics can contain input values. Redact every known spelling before reporting.
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token, secondService?.token].filter(Boolean)) {
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'),
      JSON.stringify(secret).slice(1, -1)]) detail = detail.split(value).join('[redacted]');
  }
  report.status = mode === '--dom' ? 'connection-dom-failed' : 'baseline-failed';
  report.failure = `Run failed at ${stage}: ${detail.slice(0, 1200)}`;
  if (stage === 'window-visibility' && app) {
    try {
      report.windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
        url: w.webContents.getURL(), visible: w.isVisible(),
      })));
      const settings = app.windows().find((page) => page.url().endsWith('/console/index.html'));
      if (settings) report.source = await settings.evaluate(async () => {
        const result = await window.petConsole.getSnapshot();
        if (!result.ok) return { error: result.error.code };
        const client = result.value.plugins.find((entry) => entry.owner.pluginId === 'pet.companion-client');
        return client ? { state: client.state, reason: client.reason?.code ?? null } : { state: 'absent' };
      });
    } catch { report.windowDiagnostic = 'unavailable'; }
  }
} finally {
  try { await web?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await app?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await secondProxy?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await proxy?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await secondService?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await service?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await display?.stop(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = exit;
}
