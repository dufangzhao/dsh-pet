import { _electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(import.meta.url),
  exe = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const env = {};
for (const key of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
])
  if (process.env[key]) env[key] = process.env[key];
const report = { status: 'running', errors: [] };
let app;
try {
  app = await _electron.launch({
    executablePath: exe,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), '--show-settings'],
    env,
    timeout: 30000,
  });
  await expect
    .poll(() => app.windows().some((p) => p.url().includes('/pet/index.html')), { timeout: 30000 })
    .toBe(true);
  const pet = app.windows().find((p) => p.url().includes('/pet/index.html'));
  await pet.waitForLoadState('domcontentloaded');
  await expect
    .poll(
      async () => {
        const r = await pet.evaluate(() => window.petApplication.getSnapshot());
        return r.ok && !!r.value.profile;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const r = await pet.evaluate(() => window.petApplication.getSnapshot());
  report.application = {
    ok: r.ok,
    error: r.ok ? r.value.error : r.error,
    profile: r.ok
      ? {
          revision: r.value.profile?.revision,
          fields: Object.keys(r.value.profile?.data ?? {}).length,
        }
      : null,
    agent: r.ok ? r.value.agent.state : null,
    pages: r.ok ? r.value.pages.map((p) => p.title) : [],
  };
  report.status = r.ok && !r.value.error ? 'passed' : 'failed';
} catch (e) {
  report.status = 'failed';
  report.error = String(e);
  if (app) {
    for (const page of app.windows()) {
      if (page.url().includes('/pet/index.html')) {
        const s = await page.evaluate(() => window.petApplication.getSnapshot()).catch(() => null);
        report.failureApplication = s
          ? {
              ok: s.ok,
              error: s.error ?? s.value?.error,
              agent: s.value?.agent,
              pages: s.value?.pages?.map((p) => p.title),
              profilePresent: !!s.value?.profile,
            }
          : null;
      }
      if (page.url().includes('/console/index.html')) {
        const s = await page.evaluate(() => window.petConsole.getSnapshot()).catch(() => null);
        report.failurePlugins = s?.value?.plugins
          ?.filter((p) => ['pet.profile', 'pet.agent-cortico'].includes(p.owner.pluginId))
          .map((p) => ({ id: p.owner.pluginId, state: p.state, reason: p.reason }));
      }
    }
  }

  throw e;
} finally {
  await fs.mkdir(path.join(root, '.cache/mvp-native'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.cache/mvp-native/normal-profile.json'),
    JSON.stringify(report, null, 2),
  );
  if (app) await app.close();
}
