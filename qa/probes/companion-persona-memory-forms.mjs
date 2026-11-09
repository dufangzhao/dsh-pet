// Real shared web + Electron PersonaMemory forms; run only on parent-authorized frozen build.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';
import { startResponseGate } from '../fixtures/companion-persona-memory/response-gate.mjs';
import { beginMovedNoticeWatch, openForgetConfirmation, personaMemoryControls } from '../fixtures/companion-persona-memory/form-observers.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--run-frozen') {
  console.error('Pass --run-frozen only after parent build/freeze/start authorization');
  process.exit(2);
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const chromiumPath = path.join(root, '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell');
const files = ['qa/probes/companion-persona-memory-forms.mjs',
  'qa/fixtures/companion-persona-memory/response-gate.mjs', 'qa/fixtures/companion-persona-memory/form-observers.mjs',
  'qa/fixtures/companion-desktop/display.mjs', 'qa/fixtures/companion-desktop/service.mjs',
  'apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/preload/index.cjs', 'apps/desktop/dist/runtime/worker.cjs',
  'apps/desktop/src/main/builtin-admission.json', 'plugins/text-client/dist/client.js',
  '.companion-data/tooling/desktop/electron-45/electron'];
async function tree(directory) {
  const output = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await tree(file));
    else if (entry.isFile()) output.push(file);
    else throw new Error('Unexpected renderer file');
  }
  return output;
}
async function fingerprints() {
  const names = [...new Set([...files, ...await tree('apps/desktop/dist/renderer')])].sort();
  return Object.fromEntries(await Promise.all(names.map(async (name) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(root, name))) hash.update(chunk);
    return [name, hash.digest('hex')];
  })));
}
async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
const report = { scope: 'actual-shared-persona-memory-forms-only', status: 'running', checks: [],
  limit: 'Real web/desktop UI and service; controlled loopback wire gate only, no live model. Other A1–A8 evidence is separate.' };
let display, first, second, gate, app, browser;
let stage = 'preflight', exit = 1;
const screenshots = [];
try {
  const before = await fingerprints(); report.inputHashesBeforeRun = before;
  const image = process.env.PET_CLOUD_EXEC_IMAGE;
  assert.ok(image, 'PET_CLOUD_EXEC_IMAGE must name an already prepared image');
  display = await startDisplay(root);
  first = await startService(image);
  gate = await startResponseGate(first.url);
  const home = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-electron-home-'));
  const browserHome = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-browser-home-'));
  const env = { ...display.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data') };
  const browserEnv = { ...display.env, HOME: browserHome, XDG_CONFIG_HOME: path.join(browserHome, 'config'),
    XDG_CACHE_HOME: path.join(browserHome, 'cache'), XDG_DATA_HOME: path.join(browserHome, 'data') };
  stage = 'connect-both-surfaces';
  app = await _electron.launch({ executablePath: electron, env,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=m3forms-${randomUUID()}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const desktop = app.windows().find((page) => page.url().endsWith('/console/index.html'));
  assert.ok(desktop);
  await desktop.getByTestId('start-address').fill(gate.url);
  await desktop.getByTestId('start-ask-token').click();
  await desktop.getByTestId('start-token').fill(first.token);
  await desktop.getByTestId('start-connect').click();
  const desktopState = async () => {
    const result = await desktop.evaluate(() => window.petCompanion.getState());
    assert.equal(result.ok, true); return result.value;
  };
  await expect.poll(async () => (await desktopState()).phase, { timeout: 30000 }).toBe('live');
  browser = await chromium.launch({ executablePath: chromiumPath, env: browserEnv, chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const web = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await web.goto(first.url, { waitUntil: 'domcontentloaded' });
  await web.locator('#tc-token').fill(first.token); await web.locator('#tc-token').press('Enter');
  await web.locator('.tc-chat').waitFor({ timeout: 30000 });
  await desktop.getByTestId('nav-persona').click();
  await desktop.getByTestId('persona-read').click();
  const local = personaMemoryControls(desktop), remote = personaMemoryControls(web);
  await expect(local.name).not.toHaveValue('');
  await expect(remote.name).not.toHaveValue('');
  const api = async (service, route, body) => {
    const response = await fetch(service.url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const envelope = await response.json();
    assert.equal(envelope.ok, true, `actual service ${route} failed: ${response.status}`);
    return envelope.value;
  };
  const agentId = (await api(first, '/api/profile')).agentId;
  const runId = randomUUID().slice(0, 8);
  const evidence = path.join(root, 'qa/fixtures/companion-persona-memory/evidence');
  await mkdir(evidence, { recursive: true });
  const shot = async (page, label) => {
    const file = path.join(evidence, `${runId}-${label}.png`);
    await page.screenshot({ path: file }); screenshots.push(path.relative(root, file));
  };
  const historyText = `m3-history-${runId}`;
  await web.locator('#tc-input').fill(historyText); await web.locator('#tc-input').press('Enter');
  await expect.poll(async () => {
    const value = await api(first, '/api/snapshot');
    return value.agent.status === 'ready' && value.messages.some((message) => message.text === historyText);
  }, { timeout: 30000 }).toBe(true);

  stage = 'profile-own-pending';
  const newName = `M3 QA ${runId}`;
  await local.name.fill(newName);
  const profileWatch = await beginMovedNoticeWatch(desktop);
  const profileGate = gate.arm('/api/profile');
  await local.saveProfile.click();
  const profileResponse = await within(profileGate.observed, 'profile response');
  assert.equal(profileResponse.method, 'POST'); assert.equal(profileResponse.status, 200);
  await expect.poll(async () => (await desktopState()).snapshot?.agent.name, { timeout: 30000 }).toBe(newName);
  assert.equal((await profileWatch()).profile, 0, 'own pending profile write must not report external change');
  profileGate.release();
  const savedProfile = await api(first, '/api/profile');
  assert.equal(savedProfile.agentId, agentId); assert.equal(savedProfile.name, newName);
  await expect(web.locator('.tc-agent__name')).toHaveText(newName);
  report.checks.push('real-profile-own-pending-and-shared-identity');

  stage = 'memory-own-pending';
  const key = `m3-tea-${runId}`, original = '喜欢乌龙茶', corrected = '喜欢普洱茶';
  await local.key.fill(key); await local.value.fill(original);
  const memoryWatch = await beginMovedNoticeWatch(desktop);
  const memoryGate = gate.arm('/api/facts');
  await local.saveMemory.click();
  const memoryResponse = await within(memoryGate.observed, 'memory response');
  assert.equal(memoryResponse.method, 'POST'); assert.equal(memoryResponse.status, 200);
  await expect.poll(async () => (await desktopState()).snapshot?.facts.some((fact) => fact.key === key && fact.value === original),
    { timeout: 30000 }).toBe(true);
  assert.equal((await memoryWatch()).memory, 0, 'own pending memory write must not report external change');
  memoryGate.release();
  await expect(local.row(key)).toHaveCount(1);
  await expect(remote.row(key)).toHaveCount(1);
  await expect(local.row(key).getByTestId('memory-origin')).toContainText('手动设置');
  assert.equal((await api(first, '/api/memory')).facts.find((fact) => fact.key === key)?.origin.kind, 'owner-form');
  report.checks.push('real-memory-own-pending-origin-and-two-surface-projection');

  stage = 'keyboard-and-minimum-layout';
  const nativeSize = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/console/index.html'));
    if (!window) throw new Error('Console window unavailable');
    window.setSize(880, 600);
    return window.getSize();
  });
  assert.ok(nativeSize[0] >= 880 && nativeSize[1] >= 600);
  await local.name.focus(); await local.name.press('Tab'); await expect(local.persona).toBeFocused();
  const keyboardForget = local.row(key).getByTestId(`memory-forget-${key}`);
  await keyboardForget.focus(); await keyboardForget.press('Enter');
  await expect(local.forgetConfirm).toBeVisible();
  await local.forgetConfirm.focus(); await local.forgetConfirm.press('Tab');
  await expect(local.forgetCancel).toBeFocused(); await local.forgetCancel.press('Enter');
  await expect(local.forgetConfirm).toHaveCount(0);
  await expect.poll(() => desktop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(desktop, 'desktop-minimum-keyboard');
  await web.setViewportSize({ width: 360, height: 700 });
  await remote.key.scrollIntoViewIfNeeded();
  await expect.poll(() => web.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await remote.key.focus(); await remote.key.press('Tab'); await expect(remote.value).toBeFocused();
  await shot(web, 'web-narrow-keyboard');
  await web.setViewportSize({ width: 1440, height: 900 });
  report.checks.push('actual-keyboard-and-desktop-minimum-web-narrow-layout');

  stage = 'stale-forget-confirmation';
  const opened = await openForgetConfirmation(desktop, key);
  await remote.row(key).getByTestId(`memory-edit-${key}`).click();
  await remote.value.fill(corrected); await remote.saveMemory.click();
  await expect.poll(async () => (await api(first, '/api/memory')).facts.find((fact) => fact.key === key)?.value,
    { timeout: 30000 }).toBe(corrected);
  await expect.poll(async () => (await desktopState()).snapshot?.facts.find((fact) => fact.key === key)?.value,
    { timeout: 30000 }).toBe(corrected);
  await opened.control.forgetConfirm.click();
  await expect(local.root.getByTestId('persona-memory-notice')).toContainText('没有删除');
  assert.equal((await api(first, '/api/memory')).facts.find((fact) => fact.key === key)?.value, corrected);
  await openForgetConfirmation(web, key);
  await remote.forgetConfirm.click();
  await expect.poll(async () => (await api(first, '/api/memory')).facts.some((fact) => fact.key === key),
    { timeout: 30000 }).toBe(false);
  assert.ok((await api(first, '/api/snapshot')).messages.some((message) => message.text === historyText));
  report.checks.push('captured-forget-conflicts-after-correction-and-history-remains');

  stage = 'retarget-during-memory-response';
  if (await local.forgetCancel.count()) await local.forgetCancel.click();
  const afterForget = await api(first, '/api/memory');
  await expect.poll(async () => (await desktopState()).snapshot?.memory?.revision, { timeout: 30000 }).toBe(afterForget.revision);
  if (await local.memoryMoved.isVisible()) await local.root.getByTestId('memory-rebase').click();
  const oldKey = `old-target-${runId}`, oldValue = 'only old target';
  await local.key.fill(oldKey); await local.value.fill(oldValue);
  const delayedOld = gate.arm('/api/facts');
  await local.saveMemory.click();
  const oldResponse = await within(delayedOld.observed, 'old target mutation response');
  assert.equal(oldResponse.method, 'POST'); assert.equal(oldResponse.status, 200);
  assert.equal((await api(first, '/api/memory')).facts.find((fact) => fact.key === oldKey)?.value, oldValue);
  await desktop.getByTestId('nav-start').click();
  second = await startService(image, `M3 Target ${runId}`);
  await desktop.getByTestId('start-address').fill(second.url);
  await desktop.getByTestId('start-ask-token').click();
  await desktop.getByTestId('start-token').fill(second.token);
  await desktop.getByTestId('start-connect').click();
  await expect.poll(async () => (await desktopState()).snapshot?.agent.id, { timeout: 30000 })
    .toBe((await api(second, '/api/profile')).agentId);
  report.oldResponseDeliveredToOpenSocket = delayedOld.release();
  await desktop.getByTestId('nav-persona').click(); await desktop.getByTestId('persona-read').click();
  await expect(personaMemoryControls(desktop).root.getByTestId('memory-row')).toHaveCount(0);
  await expect(personaMemoryControls(desktop).key).not.toHaveValue(oldKey);
  assert.equal((await api(second, '/api/memory')).facts.some((fact) => fact.key === oldKey), false);
  assert.equal((await api(first, '/api/memory')).facts.find((fact) => fact.key === oldKey)?.value, oldValue);
  report.checks.push('gated-old-target-response-cannot-affect-new-target');

  stage = 'saved-not-applied-when-harness-disabled';
  await api(second, '/api/plugins/pet.harness-cortico', { commandId: randomUUID(), enabled: false });
  await expect.poll(async () => (await desktopState()).snapshot?.agent.status, { timeout: 30000 }).toBe('unavailable');
  await desktop.getByTestId('persona-read').click();
  const other = personaMemoryControls(desktop);
  const disabledName = `Saved Not Applied ${runId}`;
  await other.name.fill(disabledName); await other.saveProfile.click();
  await expect.poll(async () => (await api(second, '/api/profile')).name, { timeout: 30000 }).toBe(disabledName);
  const disabledProfile = await api(second, '/api/profile');
  assert.equal(disabledProfile.management.application.appliedRevision, null);
  assert.ok(disabledProfile.management.application.error);
  await expect(other.profileApplied).toContainText('尚未生效');
  report.checks.push('real-disabled-harness-saved-not-applied-ui');
  await shot(desktop, 'saved-not-applied');
  assert.deepEqual(await fingerprints(), before, 'product or QA inputs changed during run');
  report.status = 'forms-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const token of [first?.token, second?.token].filter(Boolean))
    for (const value of [token, encodeURIComponent(token), Buffer.from(token).toString('base64'), JSON.stringify(token).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'forms-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { await browser?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await app?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await gate?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await second?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await first?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await display?.stop(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  report.screenshots = screenshots;
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
