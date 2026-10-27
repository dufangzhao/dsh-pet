import { _electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContrast } from './contrast.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(root, '.cache/m2-plugin-' + stamp),
  shots = path.join(root, 'qa/screenshots/m2-plugin');
const bridgeOnly = process.argv.includes('--bridge-only'),
  sandboxOverride = process.argv.includes('--no-sandbox');
const require = createRequire(import.meta.url);
const executablePath = path.join(
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
const report = {
  status: 'running',
  at: new Date().toISOString(),
  bridgeOnly,
  sandboxOverride,
  checks: [],
  errors: [],
  screenshots: [],
  themes: [],
};
const ids = {
  good: 'test.manage-good',
  core: 'test.manage-core',
  blocked: 'test.manage-blocked',
  fail: 'test.manage-fail',
};
const names = {
  good: '用户功能插件',
  core: '受保护基础插件',
  blocked: '待确认来源插件',
  fail: '首次失败插件',
};
const contributes = [
  { id: 'run', kind: 'command', title: { 'zh-CN': '示例命令' }, handler: 'execute' },
  { id: 'quick', kind: 'shortcut-button', title: { 'zh-CN': '示例按钮' }, command: 'run' },
  { id: 'key', kind: 'hotkey', title: { 'zh-CN': '示例快捷键' }, command: 'run' },
  { id: 'settings', kind: 'settings', title: { 'zh-CN': '示例设置' }, section: 'general' },
  { id: 'panel', kind: 'panel', title: { 'zh-CN': '示例面板' }, entry: 'panel.html' },
];
let app, page;
const capture = async (name) => {
  const file = path.join(shots, name + '-' + stamp + '.png');
  await page.screenshot({ path: file, animations: 'disabled' });
  report.screenshots.push(path.relative(root, file).split(path.sep).join('/'));
};
const diag = () => app.evaluate(() => globalThis.m2PluginQA.diagnostics());
const owned = (snapshot, id) => snapshot.contributions.filter((item) => item.owner.pluginId === id);
const owner = async (id) =>
  (await diag()).snapshot.plugins.find((plugin) => plugin.owner.pluginId === id).owner;
const run = async (id, action) =>
  page.evaluate((request) => window.petConsole.runPluginAction(request), {
    owner: await owner(id),
    action,
  });
const row = (id) => page.locator('[data-owner-key^="' + id + '|default|"]');
const action = (id, verb) => row(id).getByTestId('plugin-' + verb + '-' + id);
const state = async (id, expected) => {
  await expect
    .poll(
      async () =>
        (await diag()).snapshot.plugins.find((plugin) => plugin.owner.pluginId === id)?.state ??
        'absent',
    )
    .toBe(expected);
};
try {
  await fs.mkdir(shots, { recursive: true });
  for (const name of ['profile', 'plugins', 'builtin'])
    await fs.mkdir(path.join(out, name), { recursive: true });
  for (const kind of Object.keys(ids)) {
    const directory = path.join(out, kind === 'core' ? 'builtin' : 'plugins', ids[kind]);
    await fs.mkdir(directory);
    const manifest = {
      schemaVersion: 1,
      id: ids[kind],
      version: '1.0.0',
      displayName: { 'zh-CN': names[kind] },
      description: { 'zh-CN': 'M2-04受控验收插件' },
      license: 'MIT',
      host: '^1.0.0',
      platforms: ['win32-x64'],
      entries: { runtime: 'entry.mjs' },
      ...(kind === 'blocked'
        ? {
            permissions: [
              { kind: 'microphone' },
              { kind: 'network', origins: ['https://example.com'] },
              { kind: 'credentials', keys: ['key-ref'] },
              { kind: 'files', scope: 'plugin-data', access: 'read-write' },
              { kind: 'clipboard', access: 'read' },
            ],
          }
        : { contributes }),
      ...(kind === 'good'
        ? {
            config: {
              version: 1,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  count: {
                    type: 'integer',
                    title: '测试计数',
                    default: 1,
                    minimum: 1,
                    maximum: 10,
                  },
                },
              },
            },
          }
        : {}),
    };
    await fs.writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(directory, 'panel.html'), '<p>fixture</p>');
    const guard =
      kind === 'good'
        ? 'if(ctx.config.count!==9)throw new Error("WRONG_PERSISTED_CONFIG");'
        : kind === 'fail'
          ? 'if(++attempts===1)throw new Error("PRIVATE_ACTIVATION_FAILURE");'
          : '';
    await fs.writeFile(
      path.join(directory, 'entry.mjs'),
      'let attempts=0;export default {activate(ctx){' +
        guard +
        (kind === 'blocked'
          ? ''
          : 'ctx.contribute("run",async()=>null);for(const id of ["quick","key","settings","panel"])ctx.contribute(id);') +
        '}};',
    );
  }
  await build({
    entryPoints: [path.join(root, 'qa/probes/plugin-ui-host.ts')],
    outfile: path.join(out, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
  });
  app = await _electron.launch({
    executablePath,
    args: [...(sandboxOverride ? ['--no-sandbox'] : []), path.join(out, 'main.cjs')],
    env,
    timeout: 20000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.errors.push('Remote request: ' + request.url());
  });
  await page.waitForURL('**/console/index.html');
  await expect(page.getByTestId('nav-plugins')).toBeVisible();
  report.runtime = await app.evaluate(() => ({
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  }));
  const first = await diag();
  assert.equal(first.snapshot.plugins.length, 4);
  assert.equal(first.goodTrusted, true);
  assert.equal(first.blockedTrusted, false);
  assert.equal(first.snapshot.plugins.find((p) => p.owner.pluginId === ids.core).protected, true);
  assert.equal(owned(first.snapshot, ids.core).length, 5);
  const oldGood = await owner(ids.good);
  const malformed = await page.evaluate(
    (owner) => window.petConsole.runPluginAction({ owner, action: 'enable', path: 'forbidden' }),
    oldGood,
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'invalid-input');
  await app.evaluate(() => globalThis.m2PluginQA.foreignWindow());
  const foreign = app.windows().find((target) => target !== page);
  assert.ok(foreign);
  const denied = await foreign.evaluate(
    (owner) => window.petConsole.runPluginAction({ owner, action: 'enable' }),
    oldGood,
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'permission-denied');
  await app.evaluate(() => globalThis.m2PluginQA.closeForeign());
  for (const verb of ['disable', 'uninstall']) {
    const denied = await run(ids.core, verb);
    assert.equal(denied.ok, true);
    assert.equal(denied.value.operationError.code, 'permission-denied');
  }
  report.checks.push(
    'real-owned-window-and-payload-boundary',
    'protected-host-rejects-stop-and-removal',
  );
  if (bridgeOnly) {
    await app.evaluate(async () => {
      const qa = globalThis.m2PluginQA,
        id = { pluginId: 'test.manage-good', instanceId: 'default' };
      const result = await qa.host.configs.save(id, { count: 9 }, 1);
      if (!result.ok) throw new Error('Fixture save failed');
    });
    const enabled = await run(ids.good, 'enable');
    assert.equal(enabled.ok, true);
    assert.equal(enabled.value.operationError, null);
    assert.equal(owned(enabled.value.snapshot, ids.good).length, 5);
    const stale = await page.evaluate(
      (owner) => window.petConsole.runPluginAction({ owner, action: 'disable' }),
      oldGood,
    );
    assert.equal(stale.value.operationError.code, 'stale-owner');
    await state(ids.good, 'active');
    const blocked = await run(ids.blocked, 'enable');
    assert.equal(blocked.value.operationError.code, 'permission-denied');
    assert.equal((await diag()).blockedTrusted, false);
    const disabled = await run(ids.good, 'disable');
    assert.equal(disabled.value.operationError, null);
    assert.equal(owned(disabled.value.snapshot, ids.good).length, 0);
    assert.equal(owned(disabled.value.snapshot, ids.core).length, 5);
    const removed = await run(ids.good, 'uninstall');
    assert.equal(removed.value.operationError, null);
    await state(ids.good, 'absent');
    report.checks.push(
      'real-configured-enable-and-stale-owner-rejection',
      'untrusted-plugin-is-not-approved',
      'owner-contributions-cleaned-on-disable',
      'real-package-uninstalled',
    );
  } else {
    await page.getByTestId('nav-plugins').click();
    await expect(row(ids.core)).toContainText('受保护');
    await expect(action(ids.core, 'disable')).toHaveCount(0);
    await expect(action(ids.core, 'uninstall')).toHaveCount(0);
    await row(ids.blocked).locator('summary').click();
    await expect(row(ids.blocked)).toContainText('https://example.com');
    await expect(row(ids.blocked)).toContainText('key-ref');
    await expect(row(ids.blocked)).toContainText('麦克风');
    await expect(row(ids.blocked)).toContainText('读取剪贴板');
    await capture('plugin-list');
    report.checks.push('real-protected-actions-hidden-and-permission-declarations');
    await row(ids.good)
      .getByTestId('plugin-config-' + ids.good)
      .click();
    await page.getByLabel('测试计数', { exact: true }).fill('8');
    await page.getByTestId('nav-plugins').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('测试计数', { exact: true })).toHaveValue('8');
    await page.getByLabel('测试计数', { exact: true }).fill('9');
    await page.getByTestId('config-save').click();
    await expect(page.getByRole('status')).toContainText('已保存');
    await page.getByRole('button', { name: '返回插件列表', exact: true }).click();
    report.checks.push('existing-schema-draft-guard-and-persisted-activation-config');
    const before = await diag();
    await app.evaluate(() => globalThis.m2PluginQA.setSnapshotFailure(true));
    await app.evaluate(() => globalThis.m2PluginQA.holdAction());
    await action(ids.good, 'enable').click();
    await expect(action(ids.good, 'enable')).toBeDisabled();
    await action(ids.good, 'enable').evaluate((button) => button.click());
    assert.equal((await diag()).actionCalls, before.actionCalls + 1);
    await app.evaluate(() => globalThis.m2PluginQA.releaseAction());
    await state(ids.good, 'active');
    await expect(action(ids.good, 'disable')).toBeVisible();
    assert.equal((await diag()).snapshotCalls, before.snapshotCalls);
    assert.equal(owned((await diag()).snapshot, ids.good).length, 5);
    report.checks.push(
      'real-runtime-enabled-with-latest-config',
      'busy-enable-not-duplicated-and-no-followup-snapshot',
    );
    const disableCalls = (await diag()).actionCalls;
    await action(ids.good, 'disable').click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    assert.equal((await diag()).actionCalls, disableCalls);
    await state(ids.good, 'active');
    await action(ids.good, 'disable').click();
    await page.getByTestId('plugin-action-confirm').click();
    await state(ids.good, 'disabled');
    await expect(action(ids.good, 'enable')).toBeVisible();
    assert.equal(owned((await diag()).snapshot, ids.good).length, 0);
    assert.equal(owned((await diag()).snapshot, ids.core).length, 5);
    assert.equal((await diag()).snapshotCalls, before.snapshotCalls);
    await app.evaluate(() => globalThis.m2PluginQA.setSnapshotFailure(false));
    report.checks.push('disable-confirm-cancel-focus-and-owned-contribution-cleanup');
    await action(ids.blocked, 'enable').click();
    await state(ids.blocked, 'unready');
    await expect(row(ids.blocked)).toContainText('没有获得授权');
    assert.equal((await diag()).blockedTrusted, false);
    await row(ids.blocked).getByRole('button', { name: '前往权限与数据', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '权限与数据', exact: true, level: 1 }),
    ).toBeVisible();
    await page.getByTestId('nav-plugins').click();
    report.checks.push('untrusted-enable-error-new-generation-and-repair-navigation');
    await action(ids.fail, 'enable').click();
    await state(ids.fail, 'failed');
    await expect(row(ids.fail)).toContainText('内部错误');
    await action(ids.fail, 'enable').click();
    await state(ids.fail, 'active');
    await expect(action(ids.fail, 'disable')).toBeVisible();
    report.checks.push('activation-error-preserves-real-failed-state-and-explicit-retry');
    const unknownBefore = await diag();
    await app.evaluate(() => globalThis.m2PluginQA.loseNextReply());
    await action(ids.good, 'enable').click();
    await state(ids.good, 'active');
    await expect(page.getByRole('main')).toContainText('结果未确认');
    await expect(action(ids.good, 'enable')).toHaveCount(0);
    assert.equal((await diag()).snapshotCalls, unknownBefore.snapshotCalls);
    await page.getByRole('button', { name: '重新读取', exact: true }).click();
    await expect(action(ids.good, 'disable')).toBeVisible();
    report.checks.push('lost-reply-does-not-claim-rollback-and-manual-refresh-recovers-state');
    await page
      .locator('.pk-toast-region button')
      .evaluateAll((buttons) => buttons.forEach((button) => button.click()));
    const cancelCalls = (await diag()).actionCalls;
    await action(ids.good, 'uninstall').click();
    await expect(page.getByRole('dialog')).toContainText('配置');
    await capture('uninstall-dialog');
    await page.keyboard.press('Escape');
    assert.equal((await diag()).actionCalls, cancelCalls);
    await app.evaluate(() => globalThis.m2PluginQA.hideGoodPackage());
    await action(ids.good, 'uninstall').click();
    await page.getByTestId('plugin-action-confirm').click();
    await expect(
      page.getByRole('alert').filter({ hasText: names.good }).filter({ hasText: '当前不可用' }),
    ).toBeVisible();
    await state(ids.good, 'disabled');
    await expect(row(ids.good)).toBeVisible();
    await app.evaluate(() => globalThis.m2PluginQA.restoreGoodPackage());
    assert.equal((await diag()).goodTrusted, true);
    await action(ids.good, 'uninstall').click();
    await page.getByTestId('plugin-action-confirm').click();
    await state(ids.good, 'absent');
    await expect(row(ids.good)).toHaveCount(0);
    report.checks.push(
      'uninstall-cancel-does-not-delete',
      'uninstall-failure-keeps-entry-and-manual-retry-removes-package',
    );
    await page
      .locator('.pk-toast-region button')
      .evaluateAll((buttons) => buttons.forEach((button) => button.click()));
    for (const theme of ['light', 'dark', 'system']) {
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page
        .getByTestId('theme-select')
        .locator('input[value="' + theme + '"]')
        .check();
      const samples = await page
        .locator('h1,h2,p,span.plugin-row__name,summary,button:not(:disabled),.pk-badge')
        .evaluateAll((nodes) =>
          nodes
            .filter((el) => el.checkVisibility())
            .map((el, index) => {
              const s = getComputedStyle(el),
                backgrounds = [],
                opacities = [];
              for (let parent = el; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                backgrounds.push(style.backgroundColor);
                opacities.push(style.opacity);
              }
              return { id: el.tagName + '-' + index, color: s.color, backgrounds, opacities };
            }),
        );
      const contrast = samples.map((sample) => checkContrast(sample));
      assert.ok(
        contrast.length > 15 && contrast.every((item) => item.passed),
        'Contrast: ' + JSON.stringify(contrast.filter((item) => !item.passed)),
      );
      report.themes.push({
        theme,
        measured: contrast.length,
        minimum: Math.min(...contrast.flatMap((item) => item.cases.map((test) => test.ratio))),
      });
      if (theme === 'dark') await capture('plugin-list-dark');
    }
    await page.getByTestId('theme-select').locator('input[value="light"]').check();
    await (await app.browserWindow(page)).evaluate((window) => window.setSize(760, 560));
    await action(ids.fail, 'uninstall').scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const box = await action(ids.fail, 'uninstall').boundingBox(),
      width = await page.evaluate(() => innerWidth);
    assert.ok(box && box.x >= 0 && box.x + box.width <= width);
    await capture('plugin-minimum');
    report.checks.push(
      'danger-actions-and-three-theme-contrast',
      'minimum-window-actions-remain-reachable',
    );
  }
  const final = await diag();
  assert.equal(final.goodTrusted, false);
  assert.equal(owned(final.snapshot, ids.good).length, 0);
  assert.equal(final.snapshot.plugins.find((p) => p.owner.pluginId === ids.core).state, 'active');
  const retained = await app.evaluate(() => globalThis.m2PluginQA.retainedConfig());
  assert.equal(retained.ok, true);
  assert.deepEqual(retained.value.data, { count: 9 });
  await assert.rejects(fs.stat(path.join(out, 'plugins', ids.good)), { code: 'ENOENT' });
  assert.equal(
    await fs.readFile(path.join(out, 'plugin-data/retained.txt'), 'utf8'),
    'fixture-data',
  );
  assert.equal(
    await fs.readFile(path.join(out, 'vault/retained.txt'), 'utf8'),
    'fixture-vault-marker',
  );
  assert.equal(
    (await app.evaluate(() => globalThis.m2PluginQA.rescan())).includes(ids.good),
    false,
  );
  report.checks.push(
    'uninstall-retains-config-data-vault-and-revokes-trust',
    'removed-code-is-not-rediscovered',
  );
  report.finalSnapshot = final.snapshot;
  const files = [
    'apps/desktop/dist/main/index.mjs',
    'apps/desktop/dist/preload/index.cjs',
    'apps/desktop/dist/renderer/console/index.html',
  ];
  for (const name of await fs.readdir(path.join(root, 'apps/desktop/dist/renderer/console/assets')))
    files.push('apps/desktop/dist/renderer/console/assets/' + name);
  report.artifacts = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash('sha256')
          .update(await fs.readFile(path.join(root, file)))
          .digest('hex'),
      ]),
    ),
  );
  report.shutdown = await app.evaluate(() => globalThis.m2PluginQA.shutdown());
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
      if (!bridgeOnly) await capture('failure');
    } catch {}
    try {
      report.shutdown = await app.evaluate(() => globalThis.m2PluginQA.shutdown());
    } catch {}
  }
} finally {
  if (app) await app.close().catch(() => {});
  await fs.writeFile(
    path.join(
      root,
      bridgeOnly ? 'qa/M2-plugin-bridge-results.json' : 'qa/M2-plugin-management-results.json',
    ),
    JSON.stringify(report, null, 2) + String.fromCharCode(10),
  );
  console.log(JSON.stringify(report));
}
