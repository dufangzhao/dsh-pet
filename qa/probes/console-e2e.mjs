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
const out = path.join(root, '.cache/m2-console-ui');
const shots = path.join(root, 'qa/screenshots/m2');
await fs.mkdir(out, { recursive: true });
await fs.mkdir(shots, { recursive: true });
const require = createRequire(import.meta.url);
const electron = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const sandboxOverride = process.argv.includes('--no-sandbox');
const env = {};
for (const name of ['SystemRoot','WINDIR','TEMP','TMP','PATH','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH']) if (process.env[name]) env[name] = process.env[name];
const report = { status: 'running', at: new Date().toISOString(), sandboxOverride, checks: [], errors: [], screenshots: [], themes: [] };
const launch = entry => _electron.launch({ executablePath: electron, args: [...(sandboxOverride ? ['--no-sandbox'] : []), entry], env, timeout: 20000 });
const watch = page => {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) report.errors.push('Remote request: ' + request.url()); });
};
const capture = async (page, name) => { const file = path.join(shots, name + '.png'); await page.screenshot({ path: file, animations: 'disabled' }); report.screenshots.push(path.relative(root, file).split(path.sep).join('/')); };
const snapshot = page => page.evaluate(() => window.petConsole.getSnapshot());
const refresh = async page => {
  const action = page.getByTestId('console-refresh');
  if (await action.count()) await action.click();
  else await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.getByText('正在读取宿主状态…', { exact: true })).toHaveCount(0);
};
const chooseTheme = async (page, theme) => {
  const option = page.getByTestId('theme-select').locator('input[value="' + theme + '"]');
  await option.check();
  await expect(option).toBeChecked();
};
const nav = [['start','开始'],['pet','桌宠'],['voice','语音输入'],['models','模型'],['plugins','插件'],['permissions','权限与数据'],['about','关于']];
let app, fixture;
try {
  app = await launch(path.join(root, 'apps/desktop'));
  const pet = await app.firstWindow(); watch(pet);
  await expect(pet.getByTestId('pet-settings')).toBeEnabled();
  const opened = app.waitForEvent('window');
  await pet.getByTestId('pet-settings').click();
  const page = await opened; watch(page);
  await page.waitForURL('**/console/index.html');
  await expect(page.getByRole('heading', { level: 1, name: '开始', exact: true })).toBeVisible();
  await expect.poll(async () => { const value = await snapshot(page); return value.ok ? value.value.host.runtime : 'error'; }).toBe('ready');
  await refresh(page);
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, platform: process.platform }));
  assert.equal(report.runtime.electron, '45.0.0');
  report.productionSnapshot = await snapshot(page);
  assert.equal(report.productionSnapshot.ok, true);
  await expect(page.getByTestId('console-stop-all')).toHaveCount(0);
  const titleBottom = await page.getByRole('heading', { level: 1, name: '开始', exact: true }).evaluate(el => el.getBoundingClientRect().bottom);
  const actionTops = await page.getByRole('main').locator('button').evaluateAll(nodes => nodes.filter(el => el.checkVisibility()).map(el => el.getBoundingClientRect().top));
  assert.ok(actionTops.every(top => top > titleBottom), 'Global actions must not sit above or beside the page title');
  report.checks.push('idle-console-has-no-global-actions');
  const bridge = await page.evaluate(() => ({ frozen: Object.isFrozen(window.petConsole), keys: Object.keys(window.petConsole), require: typeof window.require, process: typeof window.process }));
  assert.deepEqual({ ...bridge, keys: [...bridge.keys].sort() }, { frozen: true, keys: ['version','getSnapshot','stopAll','inspectConfig','saveConfig','runPluginAction','getSecurity','setTrust','setPermissionPreset','answerApproval','getAudit','onSecurityChanged','restoreBuiltin'].sort(), require: 'undefined', process: 'undefined' });
  const unauthorized = await pet.evaluate(() => window.petConsole.stopAll());
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.error.code, 'permission-denied');
  report.checks.push('production-pet-button-opens-built-console', 'real-readonly-host-snapshot', 'production-preload-and-source-checks');

  await chooseTheme(page, 'light');
  const themeGroup = page.getByTestId('theme-select');
  await themeGroup.locator('input[value="light"]').press('ArrowRight');
  await expect(themeGroup.locator('input[value="dark"]')).toBeChecked();
  await themeGroup.locator('input[value="dark"]').press('ArrowRight');
  await expect(themeGroup.locator('input[value="system"]')).toBeChecked();
  await themeGroup.locator('input[value="system"]').press('ArrowRight');
  await expect(themeGroup.locator('input[value="light"]')).toBeChecked();
  const segmentFocus = await themeGroup.locator('input:focus + .console-segmented__text').evaluate(el => { const style = getComputedStyle(el); return { width: parseFloat(style.outlineWidth), style: style.outlineStyle }; });
  assert.ok(segmentFocus.width >= 2 && segmentFocus.style !== 'none');
  report.checks.push('theme-segment-native-radio-keyboard-cycle');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const thumb = page.locator('.console-segmented__thumb');
  await expect.poll(() => thumb.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeCloseTo(0, 0);
  const segmentWidth = (await thumb.boundingBox()).width;
  const normalDuration = await thumb.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration));
  assert.ok(normalDuration > 0 && normalDuration <= 0.3);
  await chooseTheme(page, 'dark');
  await expect.poll(() => thumb.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeCloseTo(segmentWidth, 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await chooseTheme(page, 'system');
  const reduced = await thumb.evaluate(el => ({ seconds: parseFloat(getComputedStyle(el).transitionDuration), running: el.getAnimations().filter(a => a.playState === 'running').length }));
  assert.deepEqual(reduced, { seconds: 0, running: 0 });
  report.motion = { normalDuration, movedPixels: segmentWidth, reduced };
  await chooseTheme(page, 'light');
  report.checks.push('theme-segment-motion-and-reduced-motion');
  for (const [id, title] of nav) {
    await page.getByTestId('nav-' + id).click();
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.getByTestId('nav-' + id)).toHaveAttribute('aria-current', 'page');
    assert.equal((await snapshot(page)).ok, true, 'Navigation must preserve IPC source authorization');
    await capture(page, 'console-' + id);
  }
  report.checks.push('seven-pages-with-current-navigation-and-screenshots');
  await page.getByTestId('nav-start').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('nav-pet')).toBeFocused();
  const focus = await page.getByTestId('nav-pet').evaluate(el => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
  assert.ok(focus.width >= 2 && focus.style !== 'none');
  const skip = page.getByRole('button', { name: /跳.*内容/ });
  await skip.focus(); await page.keyboard.press('Enter');
  assert.ok(await page.getByRole('main').evaluate(el => el === document.activeElement || el.contains(document.activeElement)));
  report.checks.push('sidebar-keyboard-order-visible-focus-and-skip-link');

  await page.getByTestId('nav-start').click();
  for (const theme of ['light','dark','system']) {
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark', reducedMotion: 'reduce' });
    await chooseTheme(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    assert.equal(scheme, theme === 'light' ? 'light' : 'dark');
    const samples = await page.locator('h1, h2, p, dt, dd, label, button:not(:disabled), select, .pk-badge, .pk-list__title, .pk-list__description').evaluateAll(nodes => nodes.filter(el => el.checkVisibility()).map((el, i) => { const s = getComputedStyle(el), backgrounds = [], opacities = []; for (let p = el; p; p = p.parentElement) { const cs = getComputedStyle(p); backgrounds.push(cs.backgroundColor); opacities.push(cs.opacity); } return { id: el.tagName + '-' + i, color: s.color, backgrounds, opacities }; }));
    const contrast = samples.map(s => checkContrast(s));
    assert.ok(contrast.length > 10 && contrast.every(s => s.passed), 'Console contrast: ' + JSON.stringify(contrast.filter(s => !s.passed)));
    report.themes.push({ theme, measured: samples.length, minimum: Math.min(...contrast.flatMap(s => s.cases.map(c => c.ratio))) });
    if (theme === 'dark') await capture(page, 'console-start-dark');
  }
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
  await chooseTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('theme-select').locator('input[value="dark"]')).toBeChecked();
  await chooseTheme(page, 'light');
  report.checks.push('light-dark-system-live-change-and-persistence', 'computed-console-text-contrast');

  await page.getByTestId('nav-about').click();
  await expect(page.getByRole('button', { name: '打开对话框', exact: true })).toBeHidden();
  await page.locator('details > summary').first().click();
  await expect(page.getByRole('button', { name: '打开对话框', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开对话框', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, 'console-demo-dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '打开对话框', exact: true })).toBeFocused();
  report.checks.push('about-progressive-disclosure-and-real-component-demo');

  const win = await app.browserWindow(page);
  const initialId = await win.evaluate(w => w.id);
  await pet.getByTestId('pet-settings').click();
  assert.equal(app.windows().length, 2);
  assert.equal(await win.evaluate(w => w.id), initialId);
  await win.evaluate(w => w.setSize(760,560));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(760);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.getByTestId('nav-start').click();
  await capture(page, 'console-minimum-size');
  const sizes = await win.evaluate(w => ({ minimum: w.getMinimumSize(), size: w.getSize() }));
  assert.deepEqual(sizes.minimum, [760,560]);
  await win.evaluate(w => w.close());
  const reopened = app.waitForEvent('window');
  await pet.getByTestId('pet-settings').click();
  const again = await reopened; watch(again);
  await expect(again.getByRole('heading', { level:1, name:'开始', exact:true })).toBeVisible();
  assert.notEqual(await (await app.browserWindow(again)).evaluate(w => w.id), initialId);
  report.checks.push('native-window-reuse-close-reopen-and-minimum-layout');
  const absentBridge = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, entry) => {
    const window = new BrowserWindow({ show:false, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
    await window.loadFile(entry);
  }, path.join(root,'apps/desktop/dist/renderer/console/index.html'));
  const missing = await absentBridge; watch(missing);
  await expect(missing.getByRole('main')).toContainText(/未连.*宿主|不可用|无法读取/);
  await expect(missing.getByTestId('console-refresh')).toHaveCount(0);
  await expect(missing.getByTestId('console-stop-all')).toHaveCount(0);
  await (await app.browserWindow(missing)).evaluate(w => w.destroy());
  report.checks.push('built-console-missing-bridge-state-and-no-host-actions');
  await app.close(); app = undefined;

  for (const name of ['profile','builtin','plugins']) await fs.mkdir(path.join(out, name), { recursive:true });
  const contributes = [
    {id:'run',kind:'command',title:{'zh-CN':'示例命令'},handler:'execute'},
    {id:'quick',kind:'shortcut-button',title:{'zh-CN':'示例按钮'},command:'run'},
    {id:'key',kind:'hotkey',title:{'zh-CN':'示例快捷键'},command:'run'},
    {id:'settings',kind:'settings',title:{'zh-CN':'示例设置'},section:'general'},
    {id:'panel',kind:'panel',title:{'zh-CN':'示例面板'},entry:'panel.html'},
  ];
  for (const [id, name] of [['test.console-ui-one','原生示例一'],['test.console-ui-two','原生示例二']]) {
    const directory = path.join(out, 'plugins', id); await fs.mkdir(directory, { recursive:true });
    await fs.writeFile(path.join(directory,'plugin.json'), JSON.stringify({schemaVersion:1,id,version:'1.0.0',displayName:{'zh-CN':name},description:{'zh-CN':'真实设置台验收夹具'},license:'MIT',host:'^1.0.0',platforms:['win32-x64'],entries:{runtime:'entry.mjs'},contributes}));
    await fs.writeFile(path.join(directory,'panel.html'), '<p>fixture</p>');
    await fs.writeFile(path.join(directory,'entry.mjs'), 'export default {activate(ctx){ctx.contribute("run",async()=>true);for(const id of ["quick","key","settings","panel"])ctx.contribute(id);}};');
  }
  await build({ entryPoints:[path.join(root,'qa/probes/console-ui-host.ts')], outfile:path.join(out,'main.cjs'), bundle:true, platform:'node', format:'cjs', target:'node24', external:['electron'] });
  fixture = await launch(path.join(out,'main.cjs'));
  const controlled = await fixture.firstWindow(); watch(controlled);
  await expect(controlled.getByText(/正在加载|正在读取|加载中/).first()).toBeVisible();
  await fixture.evaluate(() => globalThis.m2ConsoleQA.releaseSnapshot());
  await expect(controlled.getByTestId('console-refresh')).toBeEnabled();
  await controlled.getByTestId('nav-plugins').click();
  await expect(controlled.getByRole('main')).toContainText('原生示例一');
  await expect(controlled.getByRole('main')).toContainText('原生示例二');
  report.fixtureSnapshot = await snapshot(controlled);
  assert.equal(report.fixtureSnapshot.value.plugins.length, 2);
  assert.equal(report.fixtureSnapshot.value.contributions.length, 10);
  await capture(controlled, 'console-real-plugins');
  report.checks.push('real-host-two-active-plugins-and-ten-owned-contributions', 'initial-loading-state');

  await fixture.evaluate(() => globalThis.m2ConsoleQA.setMode('error'));
  await refresh(controlled);
  await expect(controlled.getByRole('main')).toContainText(/失败|无法读取|不可用/);
  await fixture.evaluate(() => globalThis.m2ConsoleQA.setMode('empty'));
  await refresh(controlled);
  await expect(controlled.getByRole('main')).toContainText(/没有.*插件|暂无.*插件|尚未.*插件|还没有.*插件/);
  await fixture.evaluate(() => globalThis.m2ConsoleQA.setMode('real'));
  await refresh(controlled);
  await expect(controlled.getByRole('main')).toContainText('原生示例一');
  report.checks.push('injected-error-and-empty-states-recover-through-refresh');

  await controlled.getByTestId('nav-start').click();
  await fixture.evaluate(() => globalThis.m2ConsoleQA.beginTask());
  await refresh(controlled);
  await controlled.getByTestId('console-stop-all').click();
  await expect(controlled.getByRole('dialog')).toBeVisible();
  await controlled.keyboard.press('Escape');
  assert.equal((await fixture.evaluate(() => globalThis.m2ConsoleQA.diagnostics())).stopCalls, 0);
  await controlled.getByTestId('console-stop-all').click();
  await fixture.evaluate(() => { globalThis.m2ConsoleQA.setMode('error'); globalThis.m2ConsoleQA.holdStop(); });
  const confirm = controlled.getByRole('dialog').getByRole('button', { name:/停止/ });
  await confirm.click();
  if (await controlled.getByRole('dialog').isVisible()) {
    await expect(confirm).toBeDisabled();
  } else {
    await expect(controlled.getByTestId('console-stop-all')).toHaveAttribute('aria-disabled','true');
    await expect(controlled.getByTestId('console-stop-all')).toBeFocused();
    await controlled.keyboard.press('Enter');
    await expect(controlled.getByRole('dialog')).toBeHidden();
  }
  assert.equal((await fixture.evaluate(() => globalThis.m2ConsoleQA.diagnostics())).stopCalls, 1);
  await fixture.evaluate(() => globalThis.m2ConsoleQA.releaseStop());
  await expect(controlled.getByRole('dialog')).toBeHidden();
  const cancelled = await fixture.evaluate(() => globalThis.m2ConsoleQA.diagnostics());
  report.stopAccepted = cancelled;
  assert.equal(cancelled.held.state, 'cancelled');
  assert.equal(cancelled.host.runningTasks, 0);
  assert.equal(cancelled.host.pendingWork, 1);
  assert.equal(cancelled.host.runtime, 'ready');
  await expect(controlled.getByRole('main')).toContainText(/结束|收尾/);
  await capture(controlled, 'console-stopping');
  await fixture.evaluate(async () => { await globalThis.m2ConsoleQA.releaseTask(); globalThis.m2ConsoleQA.setMode('real'); });
  await refresh(controlled);
  report.afterSettlement = await fixture.evaluate(() => globalThis.m2ConsoleQA.diagnostics());
  report.checks.push('stop-result-updates-status-without-followup-snapshot', 'escape-does-not-stop', 'stop-command-busy-state', 'real-task-cancelled-with-pending-work-and-host-still-ready');

  await fixture.evaluate(async () => { await globalThis.m2ConsoleQA.beginTask(); globalThis.m2ConsoleQA.setStopFailure(true); });
  await refresh(controlled);
  await controlled.getByTestId('console-stop-all').click();
  await controlled.getByRole('dialog').getByRole('button',{name:/停止/}).click();
  await expect(controlled.getByRole('alert').last()).toContainText(/失败|无法|不可用/);
  report.failedStop = await fixture.evaluate(() => globalThis.m2ConsoleQA.diagnostics());
  assert.equal(report.failedStop.host.runningTasks, 1);
  await fixture.evaluate(() => globalThis.m2ConsoleQA.setStopFailure(false));
  if (!(await controlled.getByRole('dialog').isVisible())) await controlled.getByTestId('console-stop-all').click();
  await controlled.getByRole('dialog').getByRole('button',{name:/停止/}).click();
  await expect(controlled.getByRole('dialog')).toBeHidden();
  await fixture.evaluate(() => globalThis.m2ConsoleQA.releaseTask());
  await refresh(controlled);
  report.checks.push('stop-failure-keeps-task-live-and-can-be-retried');

  await fixture.evaluate(() => globalThis.m2ConsoleQA.beginTask());
  await refresh(controlled);
  await controlled.getByTestId('console-stop-all').click();
  await fixture.evaluate(() => globalThis.m2ConsoleQA.releaseTask());
  await controlled.getByRole('dialog').getByRole('button', { name: /停止/ }).click();
  await expect(controlled.getByRole('dialog')).toBeHidden();
  await expect(controlled.getByTestId('console-stop-all')).toHaveCount(0);
  assert.ok(await controlled.getByRole('main').evaluate(el => el.contains(document.activeElement)), 'Focus must stay in the task area when the stop action disappears');
  report.checks.push('finished-task-hides-stop-and-retains-keyboard-focus');

  await fixture.evaluate(() => globalThis.m2ConsoleQA.disablePlugin());
  await refresh(controlled);
  const afterDisable = await snapshot(controlled);
  assert.equal(afterDisable.value.contributions.length, 5);
  await controlled.getByTestId('nav-plugins').click();
  await expect(controlled.getByRole('list',{name:'贡献目录'}).getByRole('listitem')).toHaveCount(5);
  report.contributionCleanup = { remaining: afterDisable.value.contributions.length, host: afterDisable.value.host };
  report.checks.push('real-disable-removes-only-owned-contribution-metadata');
  assert.deepEqual(report.errors, []);
  report.shutdown = await fixture.evaluate(() => globalThis.m2ConsoleQA.shutdown());
  assert.equal(report.shutdown.exitConfirmed, true);
  await fixture.close(); fixture = undefined;
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); }
finally {
  if (fixture) {
    try { await fixture.evaluate(() => globalThis.m2ConsoleQA?.shutdown()); await fixture.close(); }
    catch (error) { report.cleanupFailure = String(error); report.status = 'failed'; }
  }
  if (app) {
    try { await app.close(); }
    catch (error) { report.cleanupFailure = String(error); report.status = 'failed'; }
  }
}
report.artifacts = {};
for (const relative of ['apps/desktop/dist/main/index.mjs','apps/desktop/dist/preload/index.cjs','apps/desktop/dist/renderer/console/index.html','pnpm-lock.yaml']) report.artifacts[relative] = createHash('sha256').update(await fs.readFile(path.join(root,relative))).digest('hex');
for (const name of await fs.readdir(path.join(root,'apps/desktop/dist/renderer/console/assets'))) { const relative='apps/desktop/dist/renderer/console/assets/'+name; report.artifacts[relative] = createHash('sha256').update(await fs.readFile(path.join(root,relative))).digest('hex'); }
await fs.writeFile(path.join(root,'qa/M2-console-ui-results.json'), JSON.stringify(report,null,2) + String.fromCharCode(10));
console.log(JSON.stringify(report));
if (report.status !== 'passed') process.exitCode = 1;
