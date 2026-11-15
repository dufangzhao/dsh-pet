// Partial real source lifecycle acceptance; not the complete A1–A9 gate.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';
import { startFaultProxy } from '../fixtures/companion-desktop/fault-proxy.mjs';
import { sourceLifecycleCase } from '../fixtures/companion-desktop/lifecycle.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const files = ['apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/preload/index.cjs',
  'apps/desktop/dist/runtime/worker.cjs', 'plugins/companion-client/plugin.json',
  'plugins/companion-client/dist/index.mjs', 'apps/desktop/src/main/builtin-admission.json'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async (file) => [file,
  createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
const report = { scope: 'native-source-lifecycle-only', checks: [], status: 'running',
  pending: 'remaining full acceptance and Windows' };
let display, service, proxy, app;
let stage = 'preflight', exit = 1;
try {
  const before = await hashes();
  display = await startDisplay(root);
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE);
  proxy = await startFaultProxy(service.url);
  stage = 'production-launch';
  app = await _electron.launch({ executablePath: electron, env: display.env,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=source-${randomUUID()}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const page = app.windows().find((item) => item.url().endsWith('/console/index.html'));
  assert.ok(page);
  stage = 'connect';
  await page.getByTestId('start-address').fill(proxy.url);
  await page.getByTestId('start-ask-token').click();
  await page.getByTestId('start-token').fill(service.token);
  await page.getByTestId('start-connect').click();
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.petCompanion.getState());
    return state.ok && state.value.phase === 'live';
  }, { timeout: 30000 }).toBe(true);
  stage = 'source-lifecycle';
  report.checks.push(...await sourceLifecycleCase(page, service, proxy));
  assert.deepEqual(await hashes(), before);
  report.buildHashes = before;
  report.status = 'source-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'source-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1200)}`;
} finally {
  try { await app?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await proxy?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await service?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await display?.stop(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
