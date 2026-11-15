// Focused same-service browser wire/DOM and desktop identity correlation.
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

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const browser = path.join(root, '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell');
const files = ['qa/probes/companion-desktop-wire.mjs', 'qa/fixtures/companion-desktop/display.mjs',
  'qa/fixtures/companion-desktop/service.mjs', 'apps/desktop/dist/main/index.mjs',
  'apps/desktop/dist/preload/index.cjs', 'apps/desktop/dist/runtime/worker.cjs',
  'apps/desktop/src/main/builtin-admission.json', '.companion-data/tooling/desktop/electron-45/electron',
  'plugins/text-client/dist/client.js'];
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
  const paths = [...new Set([...files, ...await tree('apps/desktop/dist/renderer')])].sort();
  return Object.fromEntries(await Promise.all(paths.map(async (file) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(root, file))) hash.update(chunk);
    return [file, hash.digest('hex')];
  })));
}
const report = { scope: 'browser-snapshot-wire-id-correlation-only', status: 'running', checks: [],
  pending: 'other acceptance items are reported separately' };
let display, service, app, web;
let stage = 'preflight', exit = 1;
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  const before = await fingerprints(); report.inputHashesBeforeRun = before;
  display = await startDisplay(root);
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE);
  const isolatedHome = await mkdtemp(path.join(os.tmpdir(), 'companion-desktop-wire-home-'));
  const env = { ...display.env, HOME: isolatedHome, XDG_CONFIG_HOME: path.join(isolatedHome, 'config'),
    XDG_CACHE_HOME: path.join(isolatedHome, 'cache'), XDG_DATA_HOME: path.join(isolatedHome, 'data') };
  stage = 'desktop-connect';
  app = await _electron.launch({ executablePath: electron, env,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=wire-${randomUUID()}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const pet = app.windows().find((page) => page.url().endsWith('/pet/index.html'));
  const consolePage = app.windows().find((page) => page.url().endsWith('/console/index.html'));
  assert.ok(pet && consolePage);
  await consolePage.getByTestId('start-address').fill(service.url);
  await consolePage.getByTestId('start-ask-token').click();
  await consolePage.getByTestId('start-token').fill(service.token);
  await consolePage.getByTestId('start-connect').click();
  await expect.poll(async () => {
    const result = await consolePage.evaluate(() => window.petCompanion.getState());
    return result.ok && result.value.phase === 'live';
  }, { timeout: 30000 }).toBe(true);
  stage = 'browser-wire';
  web = await chromium.launch({ executablePath: browser, chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], env });
  const page = await web.newPage({ viewport: { width: 1200, height: 800 } });
  const text = `WEB-WIRE-${randomUUID()}`;
  const observations = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname !== '/api/snapshot' || response.status() !== 200) return;
    void response.json().then((envelope) => {
      if (!envelope?.ok || !envelope.value?.agent || !Array.isArray(envelope.value.messages)) return;
      const message = envelope.value.messages.find((item) => item.role === 'user' && item.text === text);
      if (message) observations.push({ agentId: envelope.value.agent.id, messageId: message.id, inputId: message.inputId });
    }).catch(() => {});
  });
  await page.goto(service.url, { waitUntil: 'domcontentloaded' });
  await page.locator('#tc-token').fill(service.token);
  await page.locator('#tc-token').press('Enter');
  await page.locator('.tc-chat').waitFor({ timeout: 30000 });
  await page.locator('#tc-input').fill(text);
  await page.locator('#tc-input').press('Enter');
  await expect(page.locator('.tc-msg--user:not(.tc-msg--pending)').filter({ hasText: text })).toHaveCount(1);
  await expect.poll(() => observations.length, { timeout: 30000 }).toBeGreaterThan(0);
  const canonical = await service.snapshot();
  const messages = canonical.messages.filter((item) => item.role === 'user' && item.text === text);
  assert.equal(messages.length, 1);
  const message = messages[0];
  assert.ok(observations.some((item) => item.agentId === canonical.agent.id &&
    item.messageId === message.id && item.inputId === message.inputId));
  for (const window of [pet, consolePage]) {
    await expect.poll(async () => {
      const result = await window.evaluate(() => window.petCompanion.getState());
      return result.ok && result.value.snapshot?.agent.id === canonical.agent.id &&
        result.value.snapshot.messages.some((item) => item.id === message.id && item.inputId === message.inputId && item.text === text);
    }, { timeout: 30000 }).toBe(true);
  }
  await consolePage.getByTestId('nav-conversation').click();
  await expect(consolePage.locator('[data-testid="chat-message"][data-role="user"]').filter({ hasText: text })).toHaveCount(1);
  const evidence = path.join(root, 'qa/fixtures/companion-desktop/evidence');
  await mkdir(evidence, { recursive: true });
  const screenshot = path.join(evidence, `wire-${randomUUID().slice(0, 8)}.png`);
  await page.screenshot({ path: screenshot });
  report.screenshot = path.relative(root, screenshot);
  report.correlation = { agentId: canonical.agent.id, messageId: message.id, inputId: message.inputId,
    browserSnapshotMatches: observations.filter((item) => item.messageId === message.id).length };
  report.checks.push('actual-browser-snapshot-and-dom-match-service-and-both-desktop-projections');
  assert.deepEqual(await fingerprints(), before, 'input/build changed during wire run');
  report.status = 'wire-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'wire-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1200)}`;
} finally {
  try { await web?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await app?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await service?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await display?.stop(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
