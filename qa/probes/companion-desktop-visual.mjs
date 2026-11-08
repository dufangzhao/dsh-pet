// Partial native model/layout/transparency evidence; not full acceptance.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';
import { visualCase } from '../fixtures/companion-desktop/visuals.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const evidence = path.join(root, 'qa/fixtures/companion-desktop/evidence');
const files = ['apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/preload/index.cjs',
  'apps/desktop/dist/runtime/worker.cjs'];
async function tree(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await tree(file));
    else if (entry.isFile()) result.push(file);
    else throw new Error('Unexpected renderer build entry');
  }
  return result;
}
const hashes = async () => {
  const names = [...new Set([...files, ...await tree('apps/desktop/dist/renderer')])].sort();
  return Object.fromEntries(await Promise.all(names.map(async (file) => [file,
    createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
};
const report = { scope: 'native-model-layout-and-transparency-only', checks: [], status: 'running',
  pending: 'chooser, lifecycle, remaining full acceptance and Windows' };
let display, service, app;
let stage = 'preflight', exit = 1;
const screenshots = [];
const runId = randomUUID().slice(0, 8);
try {
  const before = await hashes();
  await mkdir(evidence, { recursive: true });
  display = await startDisplay(root);
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE);
  const isolatedHome = await mkdtemp(path.join(os.tmpdir(), 'companion-desktop-visual-home-'));
  const desktopEnv = { ...display.env, HOME: isolatedHome,
    XDG_CONFIG_HOME: path.join(isolatedHome, 'config'),
    XDG_CACHE_HOME: path.join(isolatedHome, 'cache'),
    XDG_DATA_HOME: path.join(isolatedHome, 'data') };
  stage = 'desktop-launch';
  app = await _electron.launch({ executablePath: electron, env: desktopEnv,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=visual-${randomUUID()}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const pet = app.windows().find((page) => page.url().endsWith('/pet/index.html'));
  const consolePage = app.windows().find((page) => page.url().endsWith('/console/index.html'));
  assert.ok(pet && consolePage);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().length === 2 && BrowserWindow.getAllWindows().every((window) => window.isVisible())),
  { timeout: 30000 }).toBe(true);
  stage = 'connect';
  await consolePage.getByTestId('start-address').fill(service.url);
  await consolePage.getByTestId('start-ask-token').click();
  await consolePage.getByTestId('start-token').fill(service.token);
  await consolePage.getByTestId('start-connect').click();
  await expect.poll(async () => {
    const state = await consolePage.evaluate(() => window.petCompanion.getState());
    return state.ok && state.value.phase === 'live';
  }, { timeout: 30000 }).toBe(true);
  stage = 'model-and-transparency';
  const shot = async (page, name) => {
    const file = path.join(evidence, `${runId}-${name}.png`);
    await page.screenshot({ path: file }); screenshots.push(path.relative(root, file));
  };
  report.measurements = {};
  report.transparency = await visualCase(app, consolePage, pet, shot,
    (name, value) => { report.measurements[name] = value; });
  report.checks.push('minimum-and-wide-sidebar-model-dialog-focus-and-pet-css-isolation');
  report.screenshots = screenshots;
  assert.deepEqual(await hashes(), before);
  report.buildHashes = before;
  report.status = 'visual-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'visual-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1200)}`;
} finally {
  try { await app?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await service?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await display?.stop(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  report.screenshots = screenshots;
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
