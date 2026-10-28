import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executablePath = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const env = {};
for (const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA']) if (process.env[name]) env[name] = process.env[name];
const report = { status: 'running', checks: [], errors: [], sandboxOverride: true };
let app;
try {
  app = await _electron.launch({ executablePath, args: ['--no-sandbox', path.join(root, 'apps/desktop'), '--demo-acceptance=app-' + Date.now(), '--show-settings'], env, timeout: 30000 });
  app.process().stderr?.on('data', chunk => { report.mainLog = ((report.mainLog ?? '') + String(chunk)).slice(-8000); });
  await expect.poll(() => app.windows().some(p => p.url().includes('/pet/index.html')), { timeout: 20000 }).toBe(true);
  await expect.poll(() => app.windows().some(p => p.url().includes('/console/index.html')), { timeout: 15000 }).toBe(true);
  const pet = app.windows().find(p => p.url().includes('/pet/index.html'));
  const page = app.windows().find(p => p.url().includes('/console/index.html'));
  for (const p of [pet,page]) p.on('pageerror', error => report.errors.push(error.message));
  const get = () => page.evaluate(() => window.petApplication.getSnapshot());
  await expect.poll(async () => (await get()).ok, { timeout: 10000 }).toBe(true);
  const state = await get();
  if (!state.ok) throw new Error(JSON.stringify(state.error));
  report.initial = state.value;
  if (state.value.pages.length !== 5 || state.value.agent.state !== 'ready') throw new Error('Application plugins not ready');
  report.checks.push('five-real-plugin-pages-and-one-Core-ready');
  const sent = await pet.evaluate(() => window.petDemo.sendText({ text: '你好' }));
  if (!sent.ok) throw new Error('Pet text denied: ' + sent.error.code);
  await expect.poll(async () => { const state = await get(); return state.ok && state.value.history.some(i => i.kind === 'pet'); }, { timeout: 15000 }).toBe(true);
  report.checks.push('pet-text-enters-same-Core-history-without-Key');
  await page.screenshot({ path: path.join(root, 'qa/application-console-smoke.png') });
  await pet.screenshot({ path: path.join(root, 'qa/application-pet-smoke.png') });
  report.status = report.errors.length ? 'failed' : 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error?.stack ?? error); report.windows = app?.windows().map(p => p.url()); }
finally { if (app) await app.close(); }
await fs.writeFile(path.join(root, 'qa/application-ui-smoke-results.json'), JSON.stringify(report, null, 2) + String.fromCharCode(10));
console.log(JSON.stringify(report));
if (report.status !== 'passed') process.exitCode = 1;
