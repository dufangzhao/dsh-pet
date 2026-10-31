/* global window, document */
import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(import.meta.url),
  profile = 'start-model-' + Date.now();
const out = path.join(root, 'qa/start-model-settings');
await fs.mkdir(out, { recursive: true });
const report = {
  scope:
    'real Start/IPC/task/credential flow with controlled Main provider responses, no live account calls',
  approvals: [],
  cases: [],
  pageErrors: [],
};
let app, page, pet;
const unwrap = (r) => {
  assert.ok(r?.ok, JSON.stringify(r?.error));
  return r.value;
};
const models = async () => unwrap(await page.evaluate(() => window.petModels.getSnapshot()));
const security = async () => unwrap(await page.evaluate(() => window.petConsole.getSecurity()));
async function settle(testId, denyNetwork = false, untilDispatched = false) {
  const until = Date.now() + 30000;
  let denied = false;
  while (Date.now() < until) {
    const pending = (await security()).pending[0];
    if (pending) {
      assert.equal(pending.owner.pluginId, 'pet.llm-provider');
      assert.ok(
        ['network', 'credentials', 'capability-use'].includes(pending.permission.kind),
        'Unexpected fixture permission',
      );
      const deny = denyNetwork && pending.permission.kind === 'network';
      await expect(pet.getByTestId('pet-dialog')).toHaveAttribute('data-busy', 'false');
      await pet.getByTestId(deny ? 'pet-dialog-choice-deny' : 'pet-dialog-choice-allow').click();
      report.approvals.push({ kind: pending.permission.kind, allowed: !deny });
      if (deny) denied = true;
    } else if (untilDispatched) {
      if (
        await app.evaluate(() =>
          globalThis.__startModelFixtureCalls.some((c) => c.slow && !c.settled),
        )
      )
        return denied;
    } else if ((await page.getByTestId(testId).getAttribute('aria-busy')) !== 'true') {
      return denied;
    }
    await page.waitForTimeout(50);
  }
  throw new Error('Model action did not settle');
}
try {
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
  app = await _electron.launch({
    executablePath: path.join(
      path.dirname(require.resolve('electron/package.json')),
      'dist/electron.exe',
    ),
    args: [
      '--no-sandbox',
      path.join(root, 'qa/probes/fixtures/start-model-settings-main.mjs'),
      '--demo-acceptance=' + profile,
      '--show-settings',
    ],
    env,
    cwd: root,
    timeout: 30000,
  });
  await expect
    .poll(
      async () =>
        Promise.all(app.windows().map(async (w) => ({ w, url: w.url() }))).then(
          (all) => all.filter((x) => x.url.includes('/console/')).length,
        ),
      { timeout: 30000 },
    )
    .toBe(1);
  page = app.windows().find((w) => w.url().includes('/console/'));
  await page.setViewportSize({ width: 1200, height: 900 });
  pet = app.windows().find((w) => w.url().includes('/pet/'));
  assert.ok(page && pet);
  page.on('pageerror', (e) => report.pageErrors.push(e.message));
  await page.waitForFunction(() => !!window.petModels && !!window.petConsole);
  await expect(page.getByTestId('model-fetch')).toBeVisible();
  await page.getByTestId('key-input').fill('QA_QUERY_FIXTURE_KEY');
  const before = await models();
  assert.equal(before.active, null);
  await page.getByTestId('model-fetch').click();
  await settle('model-fetch');
  await expect(page.getByTestId('model-list-result')).toContainText('已获取 2');
  assert.deepEqual(
    await page.locator('datalist option').evaluateAll((all) => all.map((n) => n.value)),
    ['qa-deepseek-one', 'qa-deepseek-two'],
  );
  const after = await models();
  assert.equal(after.revision, before.revision);
  assert.equal(after.active, null);
  assert.ok(after.endpoints.every((e) => !e.keyConfigured));
  report.cases.push('selected-provider fetch uses draft key without saving or activating');
  await page.getByTestId('model-input').fill('qa-deepseek-one');
  await page.getByTestId('model-reasoning-effort').selectOption('high');
  await page.getByTestId('model-test').click();
  await settle('model-test');
  await expect(page.getByTestId('model-test').locator('..')).toContainText('连接正常');
  const checked = await models();
  assert.equal(checked.revision, before.revision);
  assert.equal(checked.active, null);
  report.cases.push('selected draft diagnostic includes high effort without save/activation');
  await page.getByTestId('model-input').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'start-controls-1200.png') });
  await page.getByTestId('key-input').fill('QA_BAD_FIXTURE_KEY');
  await page.getByTestId('model-fetch').click();
  await settle('model-fetch');
  await expect(page.getByTestId('model-list-result')).not.toContainText('已获取');
  await expect(page.getByTestId('model-list-result')).toHaveAttribute('data-state', 'error');
  report.cases.push('auth failure is shown without fake model success');
  await page.getByTestId('key-input').fill('QA_SLOW_FIXTURE_KEY');
  await page.getByTestId('model-fetch').click();
  await settle('model-fetch', false, true);
  await page.getByTestId('key-input').fill('QA_QUERY_FIXTURE_KEY');
  await expect
    .poll(() =>
      app.evaluate(() =>
        globalThis.__startModelFixtureCalls.filter((c) => c.slow).every((c) => c.settled),
      ),
    )
    .toBe(true);
  await expect(page.getByTestId('model-list-result')).not.toContainText('已获取');
  report.cases.push('changing the draft Key discards a late successful catalog completion');
  await page.getByTestId('key-input').fill('QA_SLOW_FIXTURE_KEY');
  await page.getByTestId('model-fetch').click();
  await settle('model-fetch', false, true);
  await page.getByTestId('model-provider-select').selectOption('qwen');
  await page.getByTestId('key-input').fill('QA_QUERY_FIXTURE_KEY');
  await page.getByTestId('model-fetch').click();
  await settle('model-fetch');
  await expect(page.getByTestId('model-list-result')).toContainText('已获取 2');
  assert.ok(
    (
      await page.locator('datalist option').evaluateAll((all) => all.map((n) => n.value))
    ).every((v) => v.includes('qwen')),
  );
  await expect
    .poll(() =>
      app.evaluate(() =>
        globalThis.__startModelFixtureCalls.filter((c) => c.slow).every((c) => c.settled),
      ),
    )
    .toBe(true);
  assert.ok(
    (
      await page.locator('datalist option').evaluateAll((all) => all.map((n) => n.value))
    ).every((v) => v.includes('qwen')),
  );
  report.cases.push(
    'switching providers discards or cancels the previous query and preserves only the selected-provider catalog',
  );
  await page.getByTestId('model-input').fill('qa-qwen-one');
  await page.getByTestId('model-reasoning-effort').selectOption('high');
  await page.getByTestId('model-save').click();
  assert.equal(await settle('model-save', true), true);
  const saved = await models();
  assert.equal(saved.active, null);
  assert.equal(saved.endpoints.find((e) => e.id === 'qwen').reasoningEffort, 'high');
  assert.equal(saved.endpoints.find((e) => e.id === 'qwen').keyConfigured, true);
  report.cases.push(
    'save persists the selected effort while denied provider diagnostics do not claim an active connection',
  );
  await page.getByTestId('model-fetch').click();
  await settle('model-fetch');
  await expect(page.getByTestId('model-list-result')).toContainText('已获取 2');
  report.cases.push(
    'model retrieval after save uses the stored credential and the same runtime client',
  );
  await page.setViewportSize({ width: 880, height: 760 });
  await page.getByTestId('model-input').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'start-controls-880.png') });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false);
  report.calls = await app.evaluate(() => globalThis.__startModelFixtureCalls);
  assert.ok(report.calls.some((c) => c.effort === 'high' && c.model === 'qa-deepseek-one'));
  assert.equal(report.pageErrors.length, 0);
  report.status = 'passed';
} catch (e) {
  if (app) {
    report.calls = await app.evaluate(() => globalThis.__startModelFixtureCalls);
  }
  report.status = 'failed';
  report.failure = String(e);
  if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw e;
} finally {
  if (app) await app.close();
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2) + String.fromCharCode(10),
  );
}
console.log(
  JSON.stringify({
    status: report.status,
    cases: report.cases.length,
    approvals: report.approvals.length,
  }),
);
