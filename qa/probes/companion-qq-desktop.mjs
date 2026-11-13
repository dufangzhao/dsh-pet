// Thin M6 production Electron surface gate. Run serially only after Parent freezes the build.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';

assert.deepEqual(process.argv.slice(2), ['--run-frozen'], 'Wait for Parent build-ready; pass --run-frozen for this readonly subset only');
const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const runId = randomUUID();
const evidence = path.join(root, 'qa/fixtures/companion-qq-desktop/evidence', runId);
const report = { scope: 'production-Electron-M6-readonly-status-fixed-Web-facade', runId, status: 'running', checks: [], cleanup: {},
  limits: ['shell.openExternal is spied only in this owned Electron process; OS browser launch is not verified.',
    '--no-sandbox is required by this Linux test environment; webPreferences are recorded, not OS sandbox effectiveness.',
    'Fresh scripted service, no real QQ/model/device calls; this is not full desktop or live-platform acceptance.'] };
let display, service, app, appExit, profile, temporary, serviceData;
let stage = 'preflight', failed = false, closedApp = false, closedService = false, hashesBefore;
let serviceAttempted = false, launchAttempted = false;
const value = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
async function within(work, label, ms = 30000) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function ownedDirectory(directory, parent, prefix) {
  const absolute = await realpath(directory), parentPath = await realpath(parent), info = await lstat(absolute);
  assert.equal(path.dirname(absolute), parentPath);
  assert.ok(path.basename(absolute).startsWith(prefix));
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
  return { path: absolute, dev: info.dev, ino: info.ino };
}
async function removeOwned(owned) {
  const info = await lstat(owned.path);
  assert.equal(await realpath(owned.path), owned.path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(info.dev, owned.dev); assert.equal(info.ino, owned.ino);
  await rm(owned.path, { recursive: true, force: false });
}
async function tree(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await tree(file));
    else if (entry.isFile()) result.push(file);
    else throw new Error(`Unexpected link in frozen input: ${directory}`);
  }
  return result;
}
async function fingerprints() {
  const fixed = ['qa/probes/companion-qq-desktop.mjs', 'qa/fixtures/companion-desktop/display.mjs', 'qa/fixtures/companion-desktop/service.mjs',
    'apps/desktop/package.json', 'apps/desktop/src/main/builtin-admission.json',
    '.companion-data/tooling/desktop/electron-45/electron', 'plugins/companion-client/plugin.json', 'plugins/companion-client/dist/index.mjs'];
  const names = [...new Set([...fixed, ...await tree('apps/desktop/dist'), ...await tree('apps/companion-service/src'), ...await tree('packages/contracts/src')])].sort();
  return Object.fromEntries(await Promise.all(names.map(async file => {
    const hash = createHash('sha256'); for await (const bytes of createReadStream(path.join(root, file))) hash.update(bytes);
    return [file, hash.digest('hex')];
  })));
}
function scrub(error) {
  let text = error instanceof Error ? error.message : 'Non-error failure';
  if (service?.token) for (const spelling of [service.token, encodeURIComponent(service.token), Buffer.from(service.token).toString('base64'), JSON.stringify(service.token).slice(1, -1)]) text = text.split(spelling).join('[redacted]');
  return text.slice(0, 1600);
}
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  assert.ok(process.env.PET_CLOUD_EXEC_IMAGE, 'Set PET_CLOUD_EXEC_IMAGE to an existing approved local image; no pull/build is performed');
  for (const file of [electron, path.join(root, 'apps/desktop/dist/main/index.mjs'), path.join(root, 'apps/desktop/dist/preload/index.cjs')]) await access(file);
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  hashesBefore = await fingerprints(); report.buildHashesBefore = hashesBefore;
  const tempPath = await mkdtemp(path.join(os.tmpdir(), 'companion-qq-desktop-'));
  temporary = await ownedDirectory(tempPath, os.tmpdir(), 'companion-qq-desktop-');
  const cache = path.join(root, '.cache'); await mkdir(cache, { recursive: true });
  const profileId = `qq-${runId}`, profilePath = path.join(cache, `pet-demo-acceptance-${profileId}`);
  await mkdir(profilePath, { mode: 0o700 });
  profile = await ownedDirectory(profilePath, cache, `pet-demo-acceptance-${profileId}`);
  stage = 'isolated-service';
  serviceAttempted = true;
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE, 'M6 readonly desktop QA');
  serviceData = await ownedDirectory(service.dataDirectory, os.tmpdir(), 'companion-desktop-qa-');
  const canonical = await service.snapshot();
  assert.equal(canonical.agent.mode, 'scripted'); assert.ok(canonical.qq);
  assert.deepEqual(canonical.qq.sources.map(source => source.protocol).sort(), ['official', 'onebot-v11']);
  for (const source of canonical.qq.sources) { assert.equal(source.desiredEnabled, false); assert.notEqual(source.phase, 'ready'); assert.equal(source.account, null); }
  report.qq = canonical.qq; report.service = { url: service.url, mode: canonical.agent.mode, dataDirectory: serviceData.path };
  stage = 'display'; display = await startDisplay(root);
  const home = path.join(temporary.path, 'home'); await mkdir(home, { mode: 0o700 });
  const env = { ...display.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data') };
  stage = 'production-two-windows';
  launchAttempted = true;
  app = await _electron.launch({ executablePath: electron, args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=${profileId}`, '--show-settings'], env, timeout: 30000 });
  appExit = app.process().exitCode !== null || app.process().signalCode !== null ? Promise.resolve() : once(app.process(), 'exit');
  await expect.poll(() => app.windows().filter(page => page.url().startsWith('file:')).length, { timeout: 30000 }).toBe(2);
  const consolePage = app.windows().find(page => page.url().endsWith('/console/index.html'));
  const pet = app.windows().find(page => page.url().endsWith('/pet/index.html'));
  assert.ok(consolePage && pet, 'Both actual production file windows are required');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 2 && BrowserWindow.getAllWindows().every(window => window.isVisible())), { timeout: 30000 }).toBe(true);
  const native = await app.evaluate(({ app, BrowserWindow }) => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, argv: process.argv, userData: app.getPath('userData'),
    windows: BrowserWindow.getAllWindows().map(window => { const prefs = window.webContents.getLastWebPreferences(); return { url: window.webContents.getURL(), visible: window.isVisible(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }; }) }));
  assert.equal(await realpath(native.userData), profile.path); assert.equal(native.electron.split('.')[0], '45'); assert.equal(native.windows.length, 2);
  for (const window of native.windows) { assert.equal(window.visible, true); assert.equal(window.sandbox, true); assert.equal(window.contextIsolation, true); assert.equal(window.nodeIntegration, false); }
  assert.ok(native.argv.includes('--no-sandbox'));
  assert.ok(!native.argv.some(arg => /use-fake-ui-for-media-stream|auto-accept|use-fake-device-for-media-stream/.test(arg)));
  report.runtime = { ...native, noSandboxFlag: native.argv.includes('--no-sandbox'), autoAcceptMedia: false };
  for (const page of [consolePage, pet]) {
    const boundary = await page.evaluate(() => ({ frozen: Object.isFrozen(globalThis.petCompanion), openWeb: typeof globalThis.petCompanion?.openWeb, node: typeof globalThis.require, csp: globalThis.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content }));
    assert.equal(boundary.frozen, true); assert.equal(boundary.openWeb, 'function'); assert.equal(boundary.node, 'undefined'); assert.match(boundary.csp, /connect-src 'none'/);
  }
  // Only the owned test process's native shell property is replaced; facade/Main handlers stay real.
  const installed = await app.evaluate(({ shell }) => {
    const saved = shell.openExternal, calls = [];
    globalThis.__qqDesktopProbe = { saved, calls };
    shell.openExternal = async url => { calls.push(url); };
    return shell.openExternal !== saved;
  });
  assert.equal(installed, true, 'Do not click an opener unless the process-local spy was installed');
  const calls = () => app.evaluate(() => [...globalThis.__qqDesktopProbe.calls]);
  const state = async () => value(await consolePage.evaluate(() => globalThis.petCompanion.getState()));
  const connect = async () => {
    await consolePage.getByTestId('nav-start').click();
    await consolePage.getByTestId('start-address').fill(service.url);
    await consolePage.getByTestId('start-ask-token').click();
    await consolePage.getByTestId('start-token').fill(service.token);
    await consolePage.getByTestId('start-connect').click();
    await expect.poll(async () => { const current = await state(); return current.phase === 'live' && current.snapshot?.agent.id === canonical.agent.id && !!current.connectionId; }, { timeout: 30000 }).toBe(true);
    return state();
  };
  stage = 'readonly-snapshot-ui';
  const first = await connect();
  assert.deepEqual(first.snapshot.qq, canonical.qq);
  const petState = value(await pet.evaluate(() => globalThis.petCompanion.getState()));
  assert.equal(petState.connectionId, first.connectionId); assert.deepEqual(petState.snapshot.qq, canonical.qq);
  const card = consolePage.locator('#qq-card'); await expect(card).toBeVisible();
  await expect(card.locator('input,select,textarea')).toHaveCount(0);
  await expect(consolePage.getByTestId('qq-sources').locator('[data-testid^="qq-source-"]')).toHaveCount(2);
  for (const source of canonical.qq.sources) await expect(consolePage.getByTestId(`qq-source-${source.protocol}`)).toContainText(source.source === 'unavailable' ? '不可用' : '已停用');
  await expect(consolePage.getByTestId('qq-manage-hint')).toContainText('都在服务 Web');
  await card.screenshot({ path: path.join(evidence, 'readonly-qq.png') });
  report.checks.push('actual-service-qq-snapshot-through-production-Main-preload-both-windows-and-readonly-two-source-DOM');
  stage = 'fixed-opener-ui';
  await consolePage.getByTestId('qq-open-web').click();
  await expect.poll(calls).toEqual([service.url]);
  await expect(consolePage.getByTestId('qq-open-failed')).toHaveCount(0);
  stage = 'closed-arguments-and-frame';
  const extra = await consolePage.evaluate(connectionId => globalThis.petCompanion.openWeb({ connectionId, url: 'https://probe.invalid/?token=forbidden' }), first.connectionId);
  assert.equal(extra.ok, false); assert.equal(extra.error.code, 'invalid-input');
  const originalUrl = consolePage.url();
  try {
    await consolePage.evaluate(() => { globalThis.history.replaceState(null, '', `${globalThis.location.href}#qq-untrusted-frame`); });
    const denied = await consolePage.evaluate(connectionId => globalThis.petCompanion.openWeb({ connectionId }), first.connectionId);
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'permission-denied');
  } finally { await consolePage.evaluate(url => { globalThis.history.replaceState(null, '', url); }, originalUrl); }
  const petDenied = await pet.evaluate(input => globalThis.petCompanion.connect(input), { expectedRevision: first.configRevision, baseUrl: service.url, token: service.token });
  assert.equal(petDenied.ok, false); assert.equal(petDenied.error.code, 'permission-denied');
  assert.deepEqual(await calls(), [service.url]);
  report.checks.push('real-fixed-Web-IPC-facade-no-URL-token-argument-and-exact-frame-plus-Pet-connect-role-denial');
  stage = 'disconnect-and-fresh-connection';
  await consolePage.getByTestId('start-disconnect').click();
  await expect.poll(async () => (await state()).connectionId, { timeout: 30000 }).toBe(null);
  const oldDisconnected = await consolePage.evaluate(connectionId => globalThis.petCompanion.openWeb({ connectionId }), first.connectionId);
  assert.equal(oldDisconnected.ok, false);
  const second = await connect(); assert.notEqual(second.connectionId, first.connectionId);
  const oldReplaced = await consolePage.evaluate(connectionId => globalThis.petCompanion.openWeb({ connectionId }), first.connectionId);
  assert.equal(oldReplaced.ok, false); assert.deepEqual(await calls(), [service.url]);
  await consolePage.getByTestId('qq-open-web').click();
  await expect.poll(calls).toEqual([service.url, service.url]);
  assert.equal((await state()).connectionId, second.connectionId);
  assert.deepEqual(value(await pet.evaluate(() => globalThis.petCompanion.getState())).snapshot.qq, canonical.qq);
  for (const url of await calls()) { assert.equal(url, new URL(service.url).origin); assert.ok(!url.includes(service.token)); const parsed = new URL(url); assert.equal(parsed.search, ''); assert.equal(parsed.hash, ''); assert.equal(parsed.username, ''); assert.equal(parsed.password, ''); }
  report.connectionIds = { before: first.connectionId, after: second.connectionId };
  report.openExternalCalls = await calls();
  report.checks.push('stale-disconnected-and-replaced-targets-refused-new-UI-click-uses-new-current-connection');
  report.status = 'readonly-native-facade-subset-passed';
} catch (error) {
  failed = true; report.status = 'failed'; report.failure = `${stage}: ${scrub(error)}`;
} finally {
  if (app) {
    // Keep the spy until physical process exit: an in-flight late invoke must never launch the OS browser.
    try { await within(app.close(), 'Electron close'); await within(appExit, 'Electron physical exit'); closedApp = true; report.cleanup.app = 'joined'; }
    catch (error) { failed = true; report.cleanup.app = scrub(error); }
  } else { closedApp = !launchAttempted; if (launchAttempted) report.cleanup.app = 'launch-failed-no-handle-join-unconfirmed'; }
  if (service) {
    try { await within(service.close(), 'service close'); closedService = true; report.cleanup.service = 'joined'; }
    catch (error) { failed = true; report.cleanup.service = scrub(error); }
  } else { closedService = !serviceAttempted; if (serviceAttempted) report.cleanup.service = 'startup-failed-before-helper-return-join-unconfirmed'; }
  if (display) { try { await within(display.stop(), 'Xvfb close'); report.cleanup.display = 'joined'; } catch (error) { failed = true; report.cleanup.display = scrub(error); } }
  for (const [name, owned, joined] of [['profile', profile, closedApp], ['temporary', temporary, closedApp], ['serviceData', serviceData, closedService]]) {
    if (!owned) continue;
    if (!joined) { report.cleanup[name] = 'retained-unconfirmed-process-cleanup'; failed = true; continue; }
    try { await removeOwned(owned); report.cleanup[name] = 'verified-owned-directory-removed'; } catch (error) { failed = true; report.cleanup[name] = scrub(error); }
  }
  if (hashesBefore) {
    try { report.buildHashesAfter = await fingerprints(); assert.deepEqual(report.buildHashesAfter, hashesBefore, 'Frozen inputs changed'); report.checks.push('build-input-hashes-unchanged-before-after'); }
    catch (error) { failed = true; report.hashFailure = scrub(error); }
  }
  if (failed && report.status === 'readonly-native-facade-subset-passed') report.status = 'cleanup-or-freeze-failed';
  try { await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
  catch (error) { failed = true; report.reportFailure = scrub(error); }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = failed ? 1 : 0;
}
