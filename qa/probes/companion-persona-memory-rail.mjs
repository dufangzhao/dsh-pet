// Read-only layout measurement at the production console's minimum width.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const report = { scope: 'production-console-rail-minimum-measurement', status: 'running', measurements: [], screenshots: [] };
let display, service, app;
let stage = 'preflight', exit = 1;
try {
  const image = process.env.PET_CLOUD_EXEC_IMAGE;
  assert.ok(image, 'PET_CLOUD_EXEC_IMAGE must name the prepared image');
  display = await startDisplay(root); service = await startService(image);
  const home = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-rail-home-'));
  const env = { ...display.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data') };
  app = await _electron.launch({ executablePath: path.join(root, '.companion-data/tooling/desktop/electron-45/electron'),
    env, args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=rail-${randomUUID()}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const page = app.windows().find((item) => item.url().endsWith('/console/index.html'));
  assert.ok(page);
  await page.getByTestId('start-address').fill(service.url);
  await page.getByTestId('start-ask-token').click(); await page.getByTestId('start-token').fill(service.token);
  await page.getByTestId('start-connect').click();
  const state = async () => {
    const value = await page.evaluate(() => window.petCompanion.getState());
    assert.equal(value.ok, true); return value.value;
  };
  await expect.poll(async () => (await state()).phase, { timeout: 30000 }).toBe('live');
  const size = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/console/index.html'));
    if (!window) throw new Error('Console window unavailable');
    window.setSize(880, 600); return window.getSize();
  });
  report.windowSize = size;
  const request = async (method, input) => {
    const response = await fetch(`${service.url}/api/profile`, { method,
      headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(10000) });
    const body = await response.json(); assert.equal(body.ok, true); return body.value;
  };
  const evidence = path.join(root, 'qa/fixtures/companion-persona-memory/evidence');
  await mkdir(evidence, { recursive: true });
  const runId = randomUUID().slice(0, 8);
  for (const [label, name] of [['normal', 'M3 QA normal'], ['max', `Persona-${'x'.repeat(72)}`]]) {
    stage = `save-${label}`;
    const before = await request('GET');
    await request('POST', { expectedProfileRevision: before.revision, name, persona: before.persona });
    await expect.poll(async () => (await state()).snapshot?.agent.name, { timeout: 30000 }).toBe(name);
    for (const width of [880, 1100]) {
      stage = `measure-${label}-${width}`;
      const actualSize = await app.evaluate(({ BrowserWindow }, requested) => {
        const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/console/index.html'));
        if (!window) throw new Error('Console window unavailable');
        window.setSize(requested, 600); return window.getSize();
      }, width);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(actualSize[0]);
      const measures = await page.evaluate(() => {
        const selectors = { rail: '.rail', footer: '.rail__foot', run: '.pb-run', name: '.pb-run .row__value' };
        return Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) throw new Error(`Missing ${key}`);
          const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
          return [key, { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            rectWidth: bounds.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
            overflowX: style.overflowX, overflowY: style.overflowY, textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace, display: style.display,
            textLength: key === 'name' ? [...element.textContent].length : null }];
        }));
      });
      assert.equal(measures.name.textLength, [...name].length);
      report.measurements.push({ nameCase: label, windowSize: actualSize, ...measures });
      const file = path.join(evidence, `${runId}-rail-${label}-${width}.png`);
      await page.screenshot({ path: file }); report.screenshots.push(path.relative(root, file));
    }
  }
  report.status = 'rail-measured'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const token of [service?.token].filter(Boolean))
    for (const value of [token, encodeURIComponent(token), Buffer.from(token).toString('base64'), JSON.stringify(token).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'rail-measurement-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { await app?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await service?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await display?.stop(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
