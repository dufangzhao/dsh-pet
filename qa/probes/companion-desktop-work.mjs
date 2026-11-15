// Partial real-work acceptance. This is not the full A1–A9 gate.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';
import { startFaultProxy } from '../fixtures/companion-desktop/fault-proxy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const browser = path.join(root, '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell');
const evidence = path.join(root, 'qa/fixtures/companion-desktop/evidence');
const productFiles = ['apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/preload/index.cjs',
  'apps/desktop/dist/runtime/worker.cjs', 'plugins/companion-client/dist/index.mjs',
  'plugins/companion-client/plugin.json', 'apps/desktop/src/main/builtin-admission.json',
  'plugins/text-client/dist/client.js'];
async function tree(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await tree(file));
    else if (entry.isFile()) files.push(file);
    else throw new Error('Unexpected renderer build entry');
  }
  return files;
}
async function fingerprints() {
  const names = [...new Set([...productFiles, ...await tree('apps/desktop/dist/renderer')])].sort();
  return Object.fromEntries(await Promise.all(names.map(async (file) => [file,
    createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
}
const report = { scope: 'cross-surface-work-and-restart-only', status: 'running', checks: [],
  pending: 'native chooser, additional lifecycle/security/offline/layout cases and Windows' };
let display, service, proxy, desktop, web;
let stage = 'preflight';
let exit = 1;
const profile = `work-${randomUUID()}`;
const runId = randomUUID().slice(0, 8);
const screenshots = [];
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  const before = await fingerprints();
  await mkdir(evidence, { recursive: true });
  display = await startDisplay(root);
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE);
  proxy = await startFaultProxy(service.url);
  const launch = async () => {
    const instance = await _electron.launch({ executablePath: electron, env: display.env,
      args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=${profile}`, '--show-settings'], timeout: 30000 });
    desktop = instance;
    await expect.poll(() => instance.windows().filter((page) => page.url().startsWith('file:')).length,
      { timeout: 30000 }).toBe(2);
    const pet = instance.windows().find((page) => page.url().endsWith('/pet/index.html'));
    const consolePage = instance.windows().find((page) => page.url().endsWith('/console/index.html'));
    assert.ok(pet && consolePage);
    await expect.poll(() => instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().length === 2 && BrowserWindow.getAllWindows().every((window) => window.isVisible())),
    { timeout: 30000 }).toBe(true);
    return { pet, consolePage };
  };
  const stateOf = async (page) => {
    const state = await page.evaluate(() => window.petCompanion.getState());
    assert.equal(state.ok, true); return state.value;
  };
  const connect = async (page) => {
    await page.getByTestId('start-address').fill(proxy.url);
    await page.getByTestId('start-ask-token').click();
    await page.getByTestId('start-token').fill(service.token);
    await page.getByTestId('start-connect').click();
    await expect.poll(async () => (await stateOf(page)).phase, { timeout: 30000 }).toBe('live');
  };
  const shot = async (page, name) => {
    const file = path.join(evidence, `${runId}-${name}.png`);
    await page.screenshot({ path: file }); screenshots.push(path.relative(root, file));
  };
  stage = 'launch-and-connect';
  let { pet, consolePage } = await launch();
  await connect(consolePage);
  web = await chromium.launch({ executablePath: browser, chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], env: display.env });
  const webPage = await web.newPage({ viewport: { width: 1440, height: 900 } });
  await webPage.goto(service.url, { waitUntil: 'domcontentloaded' });
  await webPage.locator('#tc-token').fill(service.token);
  await webPage.locator('#tc-token').press('Enter');
  await webPage.locator('.tc-chat').waitFor({ timeout: 30000 });
  const initial = await service.snapshot();
  const petState = await stateOf(pet);
  const consoleState = await stateOf(consolePage);
  assert.equal(petState.snapshot.agent.id, initial.agent.id);
  assert.equal(consoleState.snapshot.agent.id, initial.agent.id);
  assert.equal(petState.snapshot.agent.profileRevision, initial.agent.profileRevision);
  await expect(webPage.locator('.tc-agent__name')).toHaveText(initial.agent.name);
  await expect(consolePage.getByTestId('start-identity')).toContainText(initial.agent.name);
  report.checks.push('real-three-surfaces-share-agent-identity');

  stage = 'three-surface-messages';
  const texts = { pet: `PET-${runId}`, console: `CONSOLE-${runId}`, web: `WEB-${runId}` };
  await pet.getByTestId('pet-avatar').focus();
  await pet.getByTestId('pet-avatar').press('Enter');
  await pet.getByTestId('pet-composer-input').fill(texts.pet);
  await pet.getByTestId('pet-composer-input').press('Enter');
  await expect.poll(async () => (await service.snapshot()).messages.filter((m) => m.role === 'user' && m.text === texts.pet).length,
    { timeout: 30000 }).toBe(1);
  await consolePage.getByTestId('nav-conversation').click();
  await expect(consolePage.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: texts.pet })).toHaveCount(1);
  await expect(webPage.locator('.tc-msg--user:not(.tc-msg--pending)').filter({ hasText: texts.pet })).toHaveCount(1);
  await consolePage.getByTestId('conversation-input').fill(texts.console);
  await consolePage.getByTestId('conversation-send').click();
  await expect.poll(async () => (await service.snapshot()).messages.filter((m) => m.role === 'user' && m.text === texts.console).length,
    { timeout: 30000 }).toBe(1);
  await expect(webPage.locator('.tc-msg--user:not(.tc-msg--pending)').filter({ hasText: texts.console })).toHaveCount(1);
  await webPage.locator('#tc-input').fill(texts.web);
  await webPage.locator('#tc-input').press('Enter');
  await expect.poll(async () => (await service.snapshot()).messages.filter((m) => m.role === 'user' && m.text === texts.web).length,
    { timeout: 30000 }).toBe(1);
  await expect(consolePage.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: texts.web })).toHaveCount(1);
  const canonical = await service.snapshot();
  const selected = canonical.messages.filter((m) => Object.values(texts).includes(m.text));
  assert.equal(selected.length, 3);
  const desktopState = await stateOf(pet);
  await expect.poll(async () => {
    const state = await stateOf(pet);
    return selected.every((m) => state.snapshot?.messages.some((item) => item.id === m.id && item.inputId === m.inputId));
  }, { timeout: 30000 }).toBe(true);
  assert.equal(desktopState.snapshot.agent.id, initial.agent.id);
  report.messageIds = selected.map((message) => message.id);
  report.checks.push('real-pet-console-web-send-once-with-canonical-ids');
  await shot(consolePage, 'shared-conversation');
  await shot(pet, 'shared-pet');

  stage = 'two-real-tasks';
  const keepTitle = `Keep-${runId}`;
  const stopTitle = `Stop-${runId}`;
  const keep = await service.startTask({ commandId: randomUUID(), title: keepTitle,
    code: "import {writeFileSync} from 'node:fs'; await new Promise(r=>setTimeout(r,18000)); writeFileSync('result.txt','native shared task\\n');",
    outputs: [{ path: 'result.txt', mediaType: 'text/plain' }], timeoutMs: 28000 });
  const stop = await service.startTask({ commandId: randomUUID(), title: stopTitle,
    code: 'setInterval(()=>{},1000)', timeoutMs: 28000 });
  assert.ok(keep.taskId && stop.taskId && keep.taskId !== stop.taskId);
  await expect.poll(async () => (await service.task(stop.taskId)).status, { timeout: 20000 }).toBe('running');
  const row = consolePage.getByTestId('task-row').filter({ hasText: stopTitle });
  await row.getByTestId('task-stop').click({ timeout: 20000 });
  await expect.poll(async () => (await service.task(stop.taskId)).status, { timeout: 20000 }).toBe('cancelled');
  const other = await service.task(keep.taskId);
  assert.equal(other.status, 'running', 'other work must still be running before desktop exit');
  report.checks.push('actual-selected-stop-leaves-other-task-running');

  stage = 'quit-and-independent-completion';
  await desktop.close(); desktop = undefined;
  assert.equal((await service.task(keep.taskId)).status, 'running');
  await expect.poll(async () => (await service.task(keep.taskId)).status, { timeout: 45000 }).toBe('completed');
  const finished = await service.task(keep.taskId);
  assert.equal(finished.artifacts.length, 1);
  const artifact = finished.artifacts[0];
  const bytes = await service.artifact(artifact.id);
  assert.equal(bytes.byteLength, artifact.sizeBytes);
  assert.equal(bytes.toString('utf8'), 'native shared task\n');
  report.artifact = { taskId: keep.taskId, id: artifact.id, size: artifact.sizeBytes,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  report.checks.push('task-completes-after-desktop-exit');

  stage = 'restart-and-fresh-token';
  const snapshotCount = proxy.count('/api/snapshot');
  ({ pet, consolePage } = await launch());
  const restarted = await stateOf(consolePage);
  assert.equal(restarted.baseUrl, proxy.url); assert.equal(restarted.connectionId, null);
  assert.notEqual(restarted.phase, 'live');
  assert.equal(proxy.count('/api/snapshot'), snapshotCount, 'restart must not authenticate automatically');
  await connect(consolePage);
  const recovered = await stateOf(pet);
  assert.equal(recovered.snapshot.agent.id, initial.agent.id);
  assert.ok(recovered.snapshot.tasks.some((task) => task.id === keep.taskId && task.artifacts.some((item) => item.id === artifact.id)));
  report.checks.push('fresh-process-requires-token-and-recovers-same-artifact');
  await consolePage.getByTestId('nav-conversation').click();
  await expect(consolePage.getByTestId('task-row').filter({ hasText: keepTitle })).toBeVisible();
  await shot(consolePage, 'recovered-task');

  assert.deepEqual(await fingerprints(), before, 'product build changed during run');
  report.buildHashes = before; report.screenshots = screenshots;
  report.runtime = { platform: 'linux', arch: 'x64', electron: '45 (verified in baseline)', noSandboxFlag: true };
  report.status = 'work-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'work-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1200)}`;
  report.screenshots = screenshots;
} finally {
  try { await web?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await desktop?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await proxy?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await service?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await display?.stop(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
