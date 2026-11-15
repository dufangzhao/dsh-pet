// Minimal real-artifact native chooser ownership diagnostic; no dialog override.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';
import { completeNativeChooser } from '../fixtures/companion-desktop/native-chooser.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const bin = path.join(root, '.companion-data/tooling/desktop/libraries/usr/bin');
const exec = promisify(execFile);
const report = { scope: 'native-chooser-save-and-cancel-only', status: 'running',
  pending: 'remaining full acceptance and Windows' };
let display, service, app, ownerXid, desktopEnv, isolatedHome;
let stage = 'preflight', exit = 1, stderr = '', dialogPending = false;
const runId = randomUUID().slice(0, 8);
const screenshots = [];
try {
  display = await startDisplay(root);
  assert.match(display.env.DISPLAY, /^:\d+$/);
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE);
  const command = async (tool, args) => {
    try {
      const result = await exec(path.join(bin, tool), args, { env: display.env, timeout: 5000, maxBuffer: 16384 });
      return { code: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    } catch (error) {
      return { code: typeof error.code === 'number' ? error.code : null,
        stdout: String(error.stdout ?? '').trim(), stderr: String(error.stderr ?? error.message ?? '').trim() };
    }
  };
  stage = 'owned-display';
  report.display = display.env.DISPLAY;
  report.privateLibraryEnv = display.env.LD_LIBRARY_PATH.includes(path.join(bin, '../lib/x86_64-linux-gnu'));
  report.displayGeometry = await command('xdotool', ['getdisplaygeometry']);
  assert.equal(report.displayGeometry.code, 0);
  stage = 'production-launch';
  isolatedHome = await mkdtemp(path.join(os.tmpdir(), 'companion-desktop-home-'));
  desktopEnv = { ...display.env, HOME: isolatedHome,
    XDG_CONFIG_HOME: path.join(isolatedHome, 'config'),
    XDG_CACHE_HOME: path.join(isolatedHome, 'cache'),
    XDG_DATA_HOME: path.join(isolatedHome, 'data') };
  app = await _electron.launch({ executablePath: electron, env: desktopEnv,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=chooser-${randomUUID()}`, '--show-settings'], timeout: 30000 });
  app.process().stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-6000); });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const page = app.windows().find((item) => item.url().endsWith('/console/index.html'));
  assert.ok(page);
  const runtime = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    pid: process.pid,
    ozonePlatform: electronApp.commandLine.getSwitchValue('ozone-platform'),
    headless: electronApp.commandLine.hasSwitch('headless'),
    windows: BrowserWindow.getAllWindows().map((window) => ({
      xid: `0x${window.getNativeWindowHandle().readUInt32LE(0).toString(16)}`,
      role: window.webContents.getURL().includes('/console/') ? 'console' : 'pet',
    })),
  }));
  report.electron = runtime;
  ownerXid = runtime.windows.find((window) => window.role === 'console')?.xid;
  assert.ok(ownerXid);
  report.treeBeforeChooser = await command('xwininfo', ['-root', '-tree']);
  assert.equal(report.treeBeforeChooser.code, 0);
  await page.getByTestId('start-address').fill(service.url);
  await page.getByTestId('start-ask-token').click();
  await page.getByTestId('start-token').fill(service.token);
  await page.getByTestId('start-connect').click();
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.petCompanion.getState());
    return state.ok && state.value.phase === 'live';
  }, { timeout: 30000 }).toBe(true);
  stage = 'real-artifact';
  const title = `Chooser-${randomUUID().slice(0, 8)}`;
  const task = await service.startTask({ commandId: randomUUID(), title,
    code: "import {writeFileSync} from 'node:fs'; writeFileSync('chooser.txt','chooser-test\\n');",
    outputs: [{ path: 'chooser.txt', mediaType: 'text/plain' }], timeoutMs: 20000 });
  assert.ok(task.taskId);
  await expect.poll(async () => (await service.task(task.taskId)).status, { timeout: 30000 }).toBe('completed');
  const finished = await service.task(task.taskId);
  assert.equal(finished.artifacts.length, 1);
  const artifact = finished.artifacts[0];
  const bytes = await service.artifact(artifact.id);
  assert.equal(bytes.byteLength, artifact.sizeBytes);
  const destination = path.join(isolatedHome, 'native-chooser-saved.txt');
  await page.getByTestId('nav-conversation').click();
  const saveButton = page.getByTestId('task-row').filter({ hasText: title }).getByTestId('artifact-save');
  await saveButton.click({ timeout: 15000 });
  dialogPending = true;
  stage = 'window-enumeration';
  // Establish actual dialog and owner before sending any keyboard input.
  const deadline = Date.now() + 10000;
  let windows = [];
  do {
    report.search = await command('xdotool', ['search', '--onlyvisible', '--name', '.']);
    if (report.search.code !== 0 && !(report.search.code === 1 && report.search.stderr === ''))
      throw new Error(`xdotool search failed: ${JSON.stringify(report.search)}`);
    windows = report.search.stdout.split('\n').filter(Boolean);
    if (windows.length > 2) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  report.treeWithChooser = await command('xwininfo', ['-root', '-tree']);
  assert.equal(report.treeWithChooser.code, 0);
  report.windows = [];
  for (const id of windows) {
    const titleResult = await command('xdotool', ['getwindowname', id]);
    const pidResult = await command('xdotool', ['getwindowpid', id]);
    const properties = await command('xprop', ['-id', id, '_NET_WM_PID', 'WM_CLASS', 'WM_TRANSIENT_FOR', 'WM_CLIENT_LEADER']);
    report.windows.push({ id, title: titleResult, pid: pidResult, properties });
  }
  report.consoleNotices = await page.locator('.pk-toast__text').allTextContents();
  const evidence = path.join(root, 'qa/fixtures/companion-desktop/evidence');
  await mkdir(evidence, { recursive: true });
  const capture = async (label) => {
    const output = path.join(evidence, `${runId}-chooser-${label}.png`);
    await exec('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'x11grab',
      '-video_size', '1440x1000', '-i', `${display.env.DISPLAY}.0`, '-frames:v', '1', '-n', output],
    { env: display.env, timeout: 10000, maxBuffer: 8192 });
    screenshots.push(path.relative(root, output));
  };
  stage = 'verified-native-save';
  report.save = await completeNativeChooser({ root, env: desktopEnv,
    electronPid: runtime.pid, ownerXid, destination, capture });
  await expect.poll(async () => (await readFile(destination).catch(() => null))?.byteLength ?? -1,
    { timeout: 10000 }).toBe(bytes.length);
  assert.deepEqual(await readFile(destination), bytes);
  await expect(page.getByText(`已保存 ${artifact.name}`, { exact: false })).toBeVisible();
  dialogPending = false;
  report.artifact = { id: artifact.id, taskId: task.taskId, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  stage = 'verified-native-cancel';
  await saveButton.click();
  dialogPending = true;
  report.cancel = await completeNativeChooser({ root, env: desktopEnv,
    electronPid: runtime.pid, ownerXid, destination: null });
  dialogPending = false;
  await expect(page.getByText('已取消，没有写入文件')).toBeVisible();
  assert.deepEqual(await readFile(destination), bytes);
  report.mainStderr = stderr.split(service.token).join('[redacted]').slice(-3000);
  report.status = 'chooser-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token].filter(Boolean)) detail = detail.split(secret).join('[redacted]');
  report.status = 'diagnostic-failed'; report.failure = `${stage}: ${detail.slice(0, 1200)}`;
  report.mainStderr = stderr.split(service?.token ?? '\0').join('[redacted]').slice(-3000);
} finally {
  if (dialogPending && app && desktopEnv && ownerXid) {
    try {
      await completeNativeChooser({ root, env: desktopEnv, electronPid: app.process().pid, ownerXid, destination: null });
      report.cleanupDialog = 'cancelled by verified native window';
    } catch {
      // Only signal a detached group after verifying its PGID equals this owned Electron PID.
      const pid = app.process().pid;
      const group = await exec('ps', ['-o', 'pgid=', '-p', String(pid)]).then((value) => value.stdout.trim()).catch(() => '');
      if (group === String(pid)) {
        try { process.kill(-pid, 'SIGTERM'); report.cleanupDialog = 'forced owned Electron group'; }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      } else app.process().kill('SIGTERM');
      exit = 1; report.status = 'cleanup-forced';
    }
  }
  try { await app?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await service?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await display?.stop(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  report.screenshots = screenshots;
  let serialized = JSON.stringify(report, null, 2);
  for (const secret of [service?.token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      serialized = serialized.split(value).join('[redacted]');
  console.log(serialized); process.exitCode = exit;
}
