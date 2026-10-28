import { _electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(root, '.cache/m2-security-' + stamp),
  shots = path.join(root, 'qa/screenshots/m2-security');
const require = createRequire(import.meta.url),
  executablePath = path.join(
    path.dirname(require.resolve('electron/package.json')),
    'dist/electron.exe',
  );
const env = {};
for (const name of [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'PATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'HOMEDRIVE',
  'HOMEPATH',
])
  if (process.env[name]) env[name] = process.env[name];
const id = 'test.security',
  report = {
    status: 'running',
    at: new Date().toISOString(),
    sandboxOverride: true,
    checks: [],
    errors: [],
    screenshots: [],
  };
let app, page;
const diag = () => app.evaluate(() => globalThis.m2SecurityQA.diagnostics());
const security = () => page.evaluate(() => window.petConsole.getSecurity());
const capture = async (name) => {
  const file = path.join(shots, name + '-' + stamp + '.png');
  await page.screenshot({ path: file, animations: 'disabled' });
  report.screenshots.push(path.relative(root, file).split(path.sep).join('/'));
};
const pending = async () => {
  await expect.poll(async () => (await diag()).security.pending.length).toBe(1);
  return (await diag()).security.pending[0];
};
const begin = (method) =>
  app.evaluate((_electron, method) => globalThis.m2SecurityQA.begin(method), method);
const settled = () => app.evaluate(() => globalThis.m2SecurityQA.settled());
const preset = (value) =>
  page.locator('input[name^="preset-test.security|default|"][value="' + value + '"]');
try {
  for (const name of ['profile', 'plugins', 'builtin/test.security'])
    await fs.mkdir(path.join(out, name), { recursive: true });
  await fs.mkdir(shots, { recursive: true });
  const pkg = path.join(out, 'builtin/test.security');
  await fs.writeFile(
    path.join(pkg, 'plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      id,
      version: '1.0.0',
      displayName: { 'zh-CN': '授权验收插件' },
      description: { 'zh-CN': '受控权限测试' },
      license: 'MIT',
      host: '^1.0.0',
      platforms: ['win32-x64'],
      entries: { runtime: 'entry.mjs' },
      provides: [{ id: 'echo', capability: 'test.echo@1' }],
      consumes: [{ capability: 'test.echo@1', optional: true }],
      permissions: [{ kind: 'capability-use', capability: 'test.echo@1' }],
    }),
  );
  await fs.writeFile(
    path.join(pkg, 'entry.mjs'),
    'let calls=0;export default {activate(ctx){ctx.provide("echo",{ping:async()=>++calls,hold:async(context)=>new Promise(resolve=>context.signal.addEventListener("abort",()=>resolve("late"),{once:true}))});}};',
  );
  await build({
    entryPoints: [path.join(root, 'qa/probes/security-ui-host.ts')],
    outfile: path.join(out, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
  });
  app = await _electron.launch({
    executablePath,
    args: ['--no-sandbox', path.join(out, 'main.cjs')],
    env,
    timeout: 20000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForURL('**/console/index.html');
  const initial = await security();
  assert.equal(initial.ok, true);
  assert.equal(initial.value.sessionOnly, true);
  assert.equal(initial.value.plugins[0].trusted, false);
  assert.match(initial.value.plugins[0].digest, /^[a-f0-9]{64}$/);
  await app.evaluate(() => globalThis.m2SecurityQA.foreignWindow());
  const foreign = app.windows().find((target) => target !== page);
  assert.ok(foreign);
  const denied = await foreign.evaluate(() => window.petConsole.getSecurity());
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'permission-denied');
  await app.evaluate(() => globalThis.m2SecurityQA.closeForeign());
  report.checks.push('security-read-is-host-owned-and-other-window-denied');
  await page.getByTestId('nav-permissions').click();
  await page.getByTestId('trust-' + id).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  assert.equal((await security()).value.plugins[0].trusted, false);
  await page.getByTestId('trust-' + id).click();
  await expect(page.getByRole('dialog')).toContainText(initial.value.plugins[0].digest);
  await capture('trust-confirm');
  await page.getByTestId('trust-confirm').click();
  await expect.poll(async () => (await security()).value.plugins[0].trusted).toBe(true);
  report.checks.push('trust-dialog-review-cancel-and-exact-fingerprint-confirm');
  await page.getByTestId('nav-plugins').click();
  await page.getByTestId('plugin-enable-' + id).click();
  await expect.poll(async () => (await diag()).security.plugins[0].state).toBe('active');
  await begin('ping');
  const first = await pending();
  await expect(page.locator('.console-notice')).toContainText('1');
  await page.locator('.console-notice button').click();
  await expect(page.getByTestId('approval-allow-' + first.requestId)).toBeVisible();
  await capture('approval');
  await page.getByTestId('approval-allow-' + first.requestId).click();
  assert.deepEqual(await settled(), { ok: true, value: 1 });
  await expect.poll(async () => (await diag()).security.pending.length).toBe(0);
  report.checks.push('live-plugin-work-waits-for-single-allow-and-cross-page-notice');
  await begin('ping');
  const refused = await pending();
  await page.getByTestId('approval-deny-' + refused.requestId).click();
  const no = await settled();
  assert.equal(no.ok, false);
  assert.equal(no.error.code, 'permission-denied');
  const replay = await page.evaluate(
    (prompt) =>
      window.petConsole.answerApproval({
        requestId: prompt.requestId,
        owner: prompt.owner,
        taskId: prompt.taskId,
        permissionDigest: prompt.permissionDigest,
        approved: true,
      }),
    refused,
  );
  assert.equal(replay.value.operationError.code, 'not-ready');
  report.checks.push('explicit-denial-and-replayed-decision-never-runs-work');
  await begin('ping');
  const cancelled = await pending();
  await app.evaluate(() => globalThis.m2SecurityQA.cancel());
  await settled();
  await expect.poll(async () => (await diag()).security.pending.length).toBe(0);
  await expect(page.getByTestId('approval-allow-' + cancelled.requestId)).toHaveCount(0);
  report.checks.push('task-cancel-removes-pending-decision-and-view');
  await begin('ping');
  const expired = await pending();
  await expect.poll(async () => (await diag()).security.pending.length, { timeout: 10000 }).toBe(0);
  assert.equal((await settled()).ok, false);
  const late = await page.evaluate(
    (prompt) =>
      window.petConsole.answerApproval({
        requestId: prompt.requestId,
        owner: prompt.owner,
        taskId: prompt.taskId,
        permissionDigest: prompt.permissionDigest,
        approved: true,
      }),
    expired,
  );
  assert.equal(late.value.operationError.code, 'not-ready');
  report.checks.push('kernel-timeout-withdraws-request-and-refuses-late-allow');
  await preset('deny').click();
  await expect.poll(async () => (await security()).value.plugins[0].preset).toBe('deny');
  await begin('ping');
  assert.equal((await settled()).ok, false);
  assert.equal((await diag()).security.pending.length, 0);
  await preset('local').click();
  await expect.poll(async () => (await security()).value.plugins[0].preset).toBe('local');
  await begin('ping');
  assert.deepEqual(await settled(), { ok: true, value: 2 });
  assert.equal((await diag()).security.pending.length, 0);
  report.checks.push('actual-deny-and-local-presets-match-permission-content');
  await preset('ask').click();
  await expect.poll(async () => (await security()).value.plugins[0].preset).toBe('ask');
  await begin('hold');
  const held = await pending();
  await page.getByTestId('approval-allow-' + held.requestId).click();
  await expect.poll(async () => (await diag()).security.pending.length).toBe(0);
  await page.getByTestId('trust-' + id).click();
  await page.getByTestId('trust-confirm').click();
  await expect.poll(async () => (await security()).value.plugins[0].trusted).toBe(false);
  assert.equal((await settled()).ok, false);
  assert.equal((await diag()).security.plugins[0].state, 'disabled');
  report.checks.push('trust-revocation-stops-owner-and-invalidates-running-lease');
  await page.getByTestId('audit-refresh').click();
  const audit = await page.evaluate(() => window.petConsole.getAudit({ offset: 0, limit: 100 }));
  assert.equal(audit.ok, true);
  assert.ok(audit.value.entries.some((item) => item.event === 'approved'));
  assert.ok(audit.value.entries.some((item) => item.event === 'denied'));
  assert.ok(audit.value.entries.some((item) => item.errorCode === 'timeout'));
  assert.equal(JSON.stringify(audit).includes('late'), false);
  await capture('security-audit');
  report.checks.push('audit-shows-only-metadata-and-real-decisions');
  const known = (await security()).value.plugins[0];
  const removed = await page.evaluate(
    (owner) => window.petConsole.runPluginAction({ owner, action: 'uninstall' }),
    known.owner,
  );
  assert.equal(removed.value.operationError, null);
  assert.equal((await security()).value.plugins.length, 0);
  assert.equal((await security()).value.availableBuiltins.length, 1);
  assert.equal((await fs.stat(path.join(pkg, 'entry.mjs'))).isFile(), true);
  const available = (await security()).value.availableBuiltins[0];
  await page.getByTestId('restore-' + available.pluginId).click();
  const restoreDialog = page.getByRole('dialog');
  await expect(restoreDialog).toContainText(available.digest);
  await expect(restoreDialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.getByTestId('restore-confirm').click();
  await expect.poll(async () => (await security()).value.availableBuiltins.length).toBe(0);
  const restored = (await security()).value;
  assert.equal(restored.plugins[0].trusted, false);
  assert.equal(restored.plugins[0].state, 'disabled');
  report.checks.push('builtin-removal-keeps-packaged-code-and-restore-requires-new-trust');
  await app.evaluate(() => globalThis.m2SecurityQA.changeCode());
  const entry = (await security()).value.plugins[0];
  const changed = await page.evaluate(
    (entry) =>
      window.petConsole.setTrust({
        owner: entry.owner,
        expectedDigest: entry.digest,
        approved: true,
      }),
    entry,
  );
  assert.equal(changed.value.operationError.code, 'package-changed');
  assert.equal(changed.value.security.plugins[0].trusted, false);
  report.checks.push('changed-package-cannot-inherit-reviewed-trust');
  report.finalSecurity = (await security()).value;
  report.audit = audit.value;
  report.shutdown = await app.evaluate(() => globalThis.m2SecurityQA.shutdown());
  assert.equal(report.shutdown.exitConfirmed, true);
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
  if (app) {
    try {
      report.diagnostics = await diag();
      report.failurePage = await page.getByRole('main').innerText();
      await capture('failure');
    } catch {}
    try {
      report.shutdown = await app.evaluate(() => globalThis.m2SecurityQA.shutdown());
    } catch {}
  }
} finally {
  if (app) await app.close().catch(() => {});
  await fs.writeFile(
    path.join(root, 'qa/M2-security-results.json'),
    JSON.stringify(report, null, 2) + String.fromCharCode(10),
  );
  console.log(JSON.stringify(report));
}
