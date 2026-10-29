import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Parent builds and runs this serially. --source-check only reads source and never launches Electron.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executablePath = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const profileId = 'coop-start-' + Date.now() + '-' + randomUUID().slice(0, 8);
const profilePath = path.join(root, '.cache', 'pet-demo-acceptance-' + profileId);
const output = path.join(root, 'qa/screenshots/coopanion-start', profileId);
const TOTAL_MS = 240000;
const fixtureKey = 'QA_UI_MODEL_KEY_' + randomUUID();
const fixturePrompt = 'UI acceptance offline message ' + randomUUID();
const customName = 'QA Start palette';
const customLabel = customName + ' 自定义';
const disposableLabel = customLabel + ' 副本';
const privateText = [fixtureKey, fixturePrompt];
const redact = value => {
  let text = String(value?.message ?? value);
  for (const secret of privateText) text = text.split(secret).join('[redacted QA input]');
  return text.replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/QA_UI_MODEL_KEY_[A-Za-z0-9_-]+/g, '[redacted QA credential]')
    .replace(/\u001b\[[0-9;]*m/g, '').slice(-1600);
};
const sourceFiles = {
  start: 'apps/desktop/src/renderer/console/pages/start.tsx',
  shell: 'apps/desktop/src/renderer/console/settings-shell.tsx',
  shellCss: 'apps/desktop/src/renderer/console/settings-shell.css',
  preview: 'apps/desktop/src/renderer/console/pet-preview.tsx',
  composer: 'apps/desktop/src/renderer/pet/PetComposer.tsx',
  avatar: 'apps/desktop/src/renderer/pet/PetAvatar.tsx',
  petDialog: 'apps/desktop/src/renderer/pet/PetDialog.tsx',
  petMenu: 'apps/desktop/src/renderer/pet/PetMenu.tsx',
  theme: 'apps/desktop/src/renderer/console/theme-editor.tsx',
  console: 'apps/desktop/src/renderer/console/console-app.tsx',
  reference: 'Coopanion/console/features/home/index.ts',
  referenceCss: 'Coopanion/console/features/home/home.css',
  referenceStrings: 'Coopanion/console/features/home/strings.ts',
};
async function inspectSource() {
  const contents = {}, fingerprints = {};
  for (const [name, relative] of Object.entries(sourceFiles)) {
    const bytes = await fs.readFile(path.join(root, relative));
    contents[name] = bytes.toString('utf8');
    fingerprints[name] = { path: relative, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const version = JSON.parse(await fs.readFile(path.join(root, 'Coopanion/package.json'), 'utf8')).version;
  const selectors = [
    ['shell', '设置页导航'], ['shell', '收起侧栏'], ['shell', '展开侧栏'],
    ['start', 'start-guide'], ['start', 'pet-hide'], ['start', 'pet-show'], ['start', 'pet-dress'],
    ['start', 'model-pick-'], ['start', 'model-save'], ['start', 'model-test'], ['start', 'model-signin'],
    ['preview', '桌宠预览'], ['avatar', 'pet-avatar'], ['composer', 'pet-composer-input'],
    ['composer', 'pet-composer-send'], ['petDialog', 'pet-dialog-choice-'], ['petMenu', 'pet-settings'],
    ['theme', '调色盘'], ['theme', '明暗挡位'], ['theme', '方案名'], ['theme', 'theme-color__hex'],
    ['theme', '复制为新方案'], ['theme', '保存当前方案'], ['theme', '再次点击确认删除'],
  ].map(([owner, selector]) => ({ owner, selector, present: contents[owner].includes(selector) }));
  return { referenceVersion: version, fingerprints, selectors,
    dependencies: {
      startThemeMounted: /<ThemeEditor\b/.test(contents.start + contents.console),
      previewComposerMounted: /<PetComposer\b/.test(contents.preview),
      startContainsRequiredHeadings: ['连接模型', '我的桌宠'].every(label => contents.start.includes(label)),
    } };
}

const names = ['source-and-real-profile', 'shell-order-geometry-and-rail', 'vendor-regions-and-browser-pick',
  'theme-presets-and-review-screenshots', 'palette-invalid-copy-save-and-variants',
  'palette-four-second-delete-and-leave-undo', 'minimum-layout-and-native-zoom',
  'model-key-save-with-real-network-denial', 'native-show-hide-and-dress',
  'preview-poke-and-chat-share-Core-history', 'guide-from-hidden-pet', 'restart-keeps-user-preferences'];
const report = { status: 'running', at: new Date().toISOString(), profileId,
  checks: names.map(name => ({ name, status: 'not-run' })), screenshots: [], shutdown: [],
  errors: [], rendererRemoteOrigins: [], approvals: [], geometry: [],
  assumptions: [
    'Parent built the current Main, worker, builtin admission and renderer before this serial run.',
    'This launches the unpackaged application with a unique real userData under .cache.',
    '--no-sandbox is the existing native QA exception; this is not OS-sandbox evidence.',
    'No fake media device, fake UI, scripted provider, fake bridge, localStorage write, or external sign-in is used.',
    'The synthetic model Key is saved only to the isolated native credential store; its network permission is denied through the real pet dialog.',
    'Model success and OAuth callback behavior are covered by separate offline probes; this runner does not fabricate them.',
  ],
  limitations: [
    'Playwright pointer input does not prove physical desktop hit testing or native microphone capture.',
    'Renderer request observation is not a packet capture of worker traffic; the model guard is the actual network approval denial.',
    'Screenshots use the same recorded content viewport at zoom 1; visual parity still requires reference review.',
  ] };
let app, pet, page, activeCheck, closing, timedOut = false;
let nativeDeadline = Infinity;
let mainLogBytes = 0;
let restartExpected;
const ensureActive = () => assert.equal(timedOut, false, 'Overall UI acceptance deadline expired');
const unwrap = (result, label) => {
  assert.ok(result?.ok, label + ': ' + (result?.error?.code ?? 'missing result'));
  return result.value;
};
const application = async () => unwrap(await pet.evaluate(() => window.petApplication.getSnapshot()), 'Application snapshot');
const demo = async () => unwrap(await pet.evaluate(() => window.petDemo.getSnapshot()), 'Demo snapshot');
const modelState = async () => unwrap(await page.evaluate(() => window.petModels.getSnapshot()), 'Model metadata');
const security = async () => unwrap(await page.evaluate(() => window.petConsole.getSecurity()), 'Actual pending approval snapshot');
const section = title => page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name: title, exact: false }) }).first();
const theme = () => page.locator('.theme-editor');
const preview = () => page.getByRole('region', { name: '桌宠预览', exact: true });
const paper = () => page.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--paper').trim().toLowerCase());
const paletteHex = () => theme().getByRole('textbox', { name: '页面背景十六进制颜色', exact: true });
const selectedScheme = () => theme().getByRole('group', { name: '配色方案', exact: true }).locator('button[aria-pressed="true"] .theme-scheme__name').innerText();
async function step(name, run) {
  ensureActive();
  activeCheck = report.checks.find(check => check.name === name);
  activeCheck.status = 'running';
  const at = Date.now();
  await run();
  ensureActive();
  activeCheck.status = 'passed';
  activeCheck.elapsedMs = Date.now() - at;
}
async function windowState(target) {
  return app.evaluate(({ BrowserWindow }, target) => {
    const win = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('/' + target + '/index.html'));
    if (!win) throw new Error('Missing owned native window: ' + target);
    return { visible: win.isVisible(), bounds: win.getBounds(), contentBounds: win.getContentBounds(),
      minimum: win.getMinimumSize(), zoom: win.webContents.getZoomFactor() };
  }, target);
}
async function resizeContent(width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('/console/index.html'));
    if (!win) throw new Error('Missing settings window');
    win.setContentSize(size.width, size.height);
  }, { width, height });
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  await expect.poll(async () => (await windowState('console')).zoom).toBe(1);
}
async function nativeZoomKey(keyCode) {
  await app.evaluate(({ BrowserWindow }, keyCode) => {
    const win = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('/console/index.html'));
    if (!win) throw new Error('Missing settings window');
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
  }, keyCode);
}
async function navigate(view) {
  const item = (await application()).pages.find(candidate => candidate.owner.pluginId === 'pet.page-' + view);
  assert.ok(item, 'Missing real plugin page: ' + view);
  const button = page.getByRole('navigation', { name: '设置页导航', exact: true }).getByRole('button', { name: item.title, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.title);
}
async function settingsFromPet() {
  await pet.getByTestId('pet-settings').click();
  await expect.poll(() => app.windows().some(target => target.url().includes('/console/index.html'))).toBe(true);
  page = app.windows().find(target => target.url().includes('/console/index.html'));
  await expect.poll(async () => (await windowState('console')).visible).toBe(true);
  await page.bringToFront();
}
async function paletteOpen() {
  const details = theme().locator('details.theme-fold');
  if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
  await expect(paletteHex()).toBeVisible();
}
async function chooseMode(mode) {
  const label = { light: '浅色', dark: '黑夜', system: '跟随系统' }[mode];
  await theme().getByRole('radiogroup', { name: '明暗挡位', exact: true }).getByRole('radio', { name: label, exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
}
async function chooseScheme(label) {
  await theme().getByRole('group', { name: '配色方案', exact: true }).getByRole('button').filter({ has: page.locator('.theme-scheme__name', { hasText: label }) }).click();
  await expect.poll(selectedScheme).toBe(label);
}
async function noOverflow(label) {
  const dimensions = await page.evaluate(() => ['html', 'body', '.pk-settings', '.pk-settings__main', '.pk-settings__pane'].map(selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error('Missing real layout node: ' + selector);
    return { selector, client: node.clientWidth, scroll: node.scrollWidth };
  }));
  report.geometry.push({label,dimensions});
  if(!dimensions.every(item=>item.scroll<=item.client+1))report.overflowOffenders=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(node=>node.clientWidth>0&&node.scrollWidth>node.clientWidth+1).slice(0,20).map(node=>({tag:node.tagName,class:typeof node.className==='string'?node.className:'',client:node.clientWidth,scroll:node.scrollWidth,right:node.getBoundingClientRect().right,minWidth:getComputedStyle(node).minWidth,overflowX:getComputedStyle(node).overflowX})));
  assert.ok(dimensions.every(item => item.scroll <= item.client + 1), 'Horizontal overflow: ' + label);
}
async function capture(name) {
  ensureActive();
  if(name.startsWith('light-')||name.startsWith('dark-')||name.startsWith('rail-collapsed-')){
    await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.pk-settings__main')?.scrollTo(0,0);});
    await expect.poll(()=>page.evaluate(()=>Math.round(window.scrollY+(document.querySelector('.pk-settings__main')?.scrollTop??0)))).toBe(0);
  }
  assert.ok(report.screenshots.length < 16, 'Screenshot budget exceeded');
  assert.equal((await windowState('console')).zoom, 1, 'Review screenshots require native zoom 1');
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }));
  const file = path.join(output, name + '.png');
  // No tracing/HAR/full-page dumps: model inputs and conversation text are never recorded as metadata.
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  report.screenshots.push({ name, file: path.relative(root, file).split(path.sep).join('/'), ...size, zoom: 1 });
}
async function launch() {
  ensureActive();
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
    if (process.env[key]) env[key] = process.env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  const remaining = nativeDeadline - Date.now();
  assert.ok(remaining > 35000, 'Insufficient time for another launch and bounded shutdown');
  app = await _electron.launch({ executablePath,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), '--demo-acceptance=' + profileId, '--show-settings'],
    env, timeout: 30000 });
  closing = undefined;
  const child = app.process();
  const shutdown = { exitConfirmed: false, code: null, signal: null, forced: false, treeKillCode: null };
  report.shutdown.push(shutdown);
  child.once('exit', (code, signal) => Object.assign(shutdown, { exitConfirmed: true, code, signal }));
  child.stderr?.on('data', chunk => { mainLogBytes += chunk.byteLength; });
  const observed = new Set();
  const observe = target => {
    if (observed.has(target)) return;
    observed.add(target);
    target.setDefaultTimeout(10000);
    target.on('pageerror', error => { if (report.errors.length < 16) report.errors.push(redact(error)); });
    target.on('console', message => {
      if (message.type() === 'error' && report.errors.length < 16) report.errors.push(redact(message.text()));
    });
    target.on('request', request => {
      if (/^https?:/.test(request.url()) && report.rendererRemoteOrigins.length < 16)
        report.rendererRemoteOrigins.push(new URL(request.url()).origin);
    });
  };
  app.context().on('page', observe);
  app.context().pages().forEach(observe);
  await expect.poll(() => app.windows().some(target => target.url().includes('/pet/index.html')), { timeout: 20000 }).toBe(true);
  await expect.poll(() => app.windows().some(target => target.url().includes('/console/index.html')), { timeout: 20000 }).toBe(true);
  pet = app.windows().find(target => target.url().includes('/pet/index.html'));
  page = app.windows().find(target => target.url().includes('/console/index.html'));
  await expect(pet.getByTestId('pet-stage')).toBeVisible();
  await expect.poll(async () => (await application()).agent.state, { timeout: 20000 }).toBe('ready');
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData') }));
  assert.equal(identity.packaged, false, 'This QA must use the unpackaged checkout');
  assert.equal(path.resolve(identity.userData).toLowerCase(), path.resolve(profilePath).toLowerCase(), 'Unexpected userData: isolated profile required');
}
async function killOwnedTree(child, shutdown) {
  if (shutdown.exitConfirmed || child.exitCode !== null || !child.pid) return;
  shutdown.forced = true;
  const exitCode = await new Promise((resolve, reject) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { killer.kill(); reject(new Error('Owned process-tree cleanup timed out')); }, 8000);
    killer.once('error', error => { clearTimeout(timer); reject(error); });
    killer.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  shutdown.treeKillCode = exitCode;
}
async function close() {
  if (!app) return;
  if (closing) return closing;
  const owned = app, child = owned.process(), shutdown = report.shutdown.at(-1);
  closing = (async () => {
    let timer;
    const normalClose = owned.close();
    try {
      await Promise.race([normalClose, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron close exceeded 20 seconds')), 20000); })]);
      await expect.poll(() => shutdown.exitConfirmed, { timeout: 5000 }).toBe(true);
      assert.ok(shutdown.code === 0 && shutdown.signal === null && !shutdown.forced, 'Electron did not exit cleanly');
    } catch (error) {
      await killOwnedTree(child, shutdown);
      await expect.poll(() => shutdown.exitConfirmed, { timeout: 5000 }).toBe(true);
      throw error;
    } finally {
      clearTimeout(timer);
      void normalClose.catch(() => {});
      app = undefined;
    }
  })();
  return closing;
}
async function denyRealModelNetwork() {
  const deadline = Date.now() + 15000;
  let deniedNetwork = false;
  while (!deniedNetwork) {
    ensureActive();
    assert.ok(Date.now() < deadline, 'A real model network approval did not arrive');
    const prompt = (await security()).pending[0];
    if (!prompt) { await page.waitForTimeout(30); continue; }
    assert.equal(prompt.owner.pluginId, 'pet.llm-provider', 'Unexpected permission owner');
    const dialog = (await application()).dialog;
    assert.ok(dialog && dialog.id === prompt.requestId && dialog.step === prompt.permissionDigest, 'Pet UI does not represent the real pending request');
    await expect(pet.getByTestId('pet-dialog')).toHaveAttribute('data-busy', 'false');
    const permission = prompt.permission;
    if (permission.kind === 'capability-use' && permission.capability === 'llm.responses@1') {
      report.approvals.push({ kind: permission.kind, approved: true });
      await pet.getByTestId('pet-dialog-choice-allow').click();
    } else {
      await pet.getByTestId('pet-dialog-choice-deny').click();
      report.approvals.push({ kind: permission.kind, approved: false });
      assert.equal(permission.kind, 'network', 'Only capability use may be allowed before network denial');
      assert.deepEqual(permission.origins, ['https://api.deepseek.com']);
      deniedNetwork = true;
    }
  }
  await expect.poll(async () => (await security()).pending.length).toBe(0);
}
async function run() {
  assert.equal(process.platform, 'win32', 'This UI acceptance targets Windows x64');
  assert.equal(process.arch, 'x64');
  for (const relative of ['apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/runtime/worker.cjs',
    'apps/desktop/dist/preload/index.cjs', 'apps/desktop/dist/renderer/console/index.html']) await fs.access(path.join(root, relative));
  await fs.access(executablePath);
  await fs.mkdir(output, { recursive: true });
  await step('source-and-real-profile', async () => {
    report.source = await inspectSource();
    assert.equal(report.source.referenceVersion, '0.2.10', 'Current source reference version changed');
    assert.ok(report.source.selectors.every(item => item.present), 'A real control selector is absent from current source');
    await launch();
    const state = await application();
    if (state.dialog) {
      assert.ok(state.dialog.choices.some(choice => choice.id === 'later'), 'Initial guide needs a real defer choice');
      await pet.getByTestId('pet-dialog-choice-later').click();
      await expect.poll(async () => (await application()).dialog).toBeNull();
    }
    assert.equal((await modelState()).active, null);
    assert.equal((await demo()).settings.replyMode, 'demo');
    await navigate('start');
    await nativeZoomKey('0');
    await resizeContent(1200, 800);
  });
  await step('shell-order-geometry-and-rail', async () => {
    await expect(page.locator('.pk-settings__body').getByRole('heading', { level: 2 })).toHaveText([/^连接模型/, /^我的桌宠/, /^界面配色/]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('开始');
    const title = await page.getByRole('heading', { level: 1 }).boundingBox();
    const guide = await page.getByTestId('start-guide').boundingBox();
    assert.ok(title && guide && guide.x > title.x + title.width && Math.abs((guide.y + guide.height / 2) - (title.y + title.height / 2)) < 16,
      'Guide must be on the heading right-hand side');
    await expect.poll(async () => Math.round((await page.locator('.pk-settings__sidebar').boundingBox()).width)).toBe(248);
    const icons = await page.getByRole('navigation', { name: '设置页导航', exact: true }).getByRole('button').evaluateAll(buttons => buttons.map(button => ({
      named: Boolean(button.getAttribute('title')?.trim()), icons: button.querySelectorAll('svg').length,
      stroke: button.querySelector('svg')?.getAttribute('stroke'),
    })));
    assert.ok(icons.length >= 5 && icons.every(icon => icon.named && icon.icons === 1 && icon.stroke === 'currentColor'), 'Every navigation item needs its real linear icon and name');
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await expect(page.locator('.pk-settings')).toHaveAttribute('data-rail', 'collapsed');
    await expect.poll(async () => Math.round((await page.locator('.pk-settings__sidebar').boundingBox()).width)).toBe(72);
    await noOverflow('collapsed 1200x800');
    const runToggle=page.getByTestId('model-pause');
    await expect(runToggle).toBeVisible();await expect(runToggle).toBeEnabled();
    await runToggle.click();await expect.poll(async()=>(await modelState()).paused).toBe(true);
    const paused=await demo();assert.equal(paused.paused,true);assert.equal(paused.canSend,false);assert.equal(paused.canRecord,false);
    await runToggle.click();await expect.poll(async()=>(await modelState()).paused).toBe(false);await expect.poll(async()=>(await demo()).canSend).toBe(true);
    report.pausedInput={pausedBlocksSend:true,pausedBlocksCapture:true,collapsedRunAccessible:true};
    await capture('rail-collapsed-1200x800');
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await expect.poll(async () => Math.round((await page.locator('.pk-settings__sidebar').boundingBox()).width)).toBe(248);
    report.geometry.push({ viewport: [1200, 800], openRail: 248, foldedRail: 72, guideOnRight: true, icons: icons.length });
  });
  await step('vendor-regions-and-browser-pick', async () => {
    await page.getByTestId('model-manage').click();await expect(page.getByRole('heading',{level:1})).toHaveText('扩展');await navigate('start');
    const state = await modelState();
    const groups = new Map();
    for (const service of state.services) if (!groups.has(service.service)) groups.set(service.service, service);
    assert.equal(groups.size, 15, 'Expected current 15 vendor groups');
    await expect(section('连接模型').locator('[data-testid^="model-pick-"]')).toHaveCount(15);
    await expect(section('连接模型').getByRole('button', { name: '更多', exact: true })).toHaveCount(0);
    for (const service of groups.values()) await expect(page.getByTestId('model-pick-' + service.id)).toBeVisible();
    const logos=section('连接模型').locator('[data-testid^="model-pick-"] img');await expect(logos).toHaveCount(15);await expect.poll(()=>logos.evaluateAll(nodes=>nodes.every(node=>node.complete&&node.naturalWidth>0))).toBe(true);
    await page.getByTestId('model-pick-qwen').click();
    await expect(section('连接模型').getByRole('button', { name: '改用国际平台', exact: true })).toBeVisible();
    await section('连接模型').getByRole('button', { name: '改用国际平台', exact: true }).click();
    await expect(section('连接模型').getByRole('button', { name: '改用中国大陆平台', exact: true })).toBeVisible();
    await expect(section('连接模型').getByLabel('模型', { exact: true })).toHaveValue(state.services.find(service => service.id === 'qwen-intl').defaultModel);
    await section('连接模型').getByRole('button', { name: '改用中国大陆平台', exact: true }).click();
    await expect(section('连接模型').getByRole('button', { name: '改用国际平台', exact: true })).toBeVisible();
    await expect(section('连接模型').locator('[data-testid^="model-pick-"]')).toHaveCount(15);
    await page.getByTestId('model-pick-chatgpt').click();
    await expect(section('连接模型').getByLabel('模型', { exact: true })).toHaveCount(0);
    await expect(section('连接模型').locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByTestId('model-signin')).toHaveText('登录并连接');
    await expect(page.getByTestId('model-signin')).toBeEnabled();
    const signIn = unwrap(await page.evaluate(() => window.petModels.getSignInState()), 'Read-only sign-in state');
    assert.equal(signIn.signedIn, false);
    assert.equal(signIn.phase, 'idle', 'Choosing a vendor must not open external authentication');
    await page.getByTestId('model-pick-deepseek').click();
    await expect(section('连接模型').getByLabel('模型', { exact: true })).toHaveAttribute('list', 'start-model-list');
    await expect(section('连接模型').locator('input[type="password"]')).toHaveAttribute('autocomplete', 'off');
    await expect(page.getByTestId('model-save')).toBeDisabled();
    await expect(page.getByTestId('model-test')).toBeDisabled();
    report.vendors = { groups: groups.size, regionalToggle: true, browserFieldsHidden: true, externalSignInStarted: false };
  });
  await step('theme-presets-and-review-screenshots', async () => {
    await expect(theme().getByRole('group', { name: '配色方案', exact: true }).locator('.theme-scheme__name')).toHaveText(['脑皮质薄荷', '未来领航员', '螃蟹和雏菊']);
    assert.equal(await theme().locator('details').evaluate(node => node.open), false);
    const seen = new Set();
    for (const name of ['脑皮质薄荷', '未来领航员', '螃蟹和雏菊']) {
      await chooseScheme(name);
      seen.add(await paper());
    }
    assert.equal(seen.size, 3, 'Preset selection must change the actual palette');
    await chooseScheme('脑皮质薄荷');
    await chooseMode('light');
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await capture('light-1200x800');
    const light = await paper();
    await chooseMode('dark');
    const dark = await paper();
    assert.notEqual(light, dark, 'Modes must paint different real CSS colors');
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await capture('dark-1200x800');
    await chooseMode('system');
    await chooseMode('light');
  });
  await step('palette-invalid-copy-save-and-variants', async () => {
    await paletteOpen();
    await expect(theme().locator('.theme-color__hex')).toHaveCount(36);
    await expect(theme().locator('.theme-color input[type="color"]')).toHaveCount(36);
    await expect(theme().locator('.theme-color-group__title').filter({ hasNotText: '组件试色' })).toHaveText(['背景层级', '文字与边界', '交互与状态', '控制台时间线', '图表系列']);
    const original = await paletteHex().inputValue();
    const originalPaper = await paper();
    await paletteHex().fill('#GGGGGG');
    await expect(paletteHex()).toHaveAttribute('aria-invalid', 'true');
    assert.equal(await paper(), originalPaper, 'Invalid hex must not enter the preview draft');
    await expect(theme().getByLabel('页面背景颜色', { exact: true })).toHaveValue(original.toLowerCase());
    await theme().getByRole('textbox', { name: '方案名', exact: true }).fill(customName);
    await theme().getByRole('button', { name: '复制为新方案', exact: true }).click();
    await expect.poll(selectedScheme).toBe(customLabel);
    await expect(paletteHex()).toHaveValue(original.toUpperCase());
    await expect(paletteHex()).toHaveAttribute('aria-invalid', 'false');
    await paletteHex().fill('#234567');
    await expect.poll(paper).toBe('#234567');
    await theme().getByRole('button', { name: '保存当前方案', exact: true }).click();
    await chooseMode('dark');
    await paletteHex().fill('#1A2B3C');
    await theme().getByRole('button', { name: '保存当前方案', exact: true }).click();
    await chooseMode('light');
    await expect(paletteHex()).toHaveValue('#234567');
    await chooseMode('dark');
    await expect(paletteHex()).toHaveValue('#1A2B3C');
    await theme().locator('summary').scrollIntoViewIfNeeded();
    await capture('palette-1200x800');
    report.palette = { tokens: 36, groups: 5, invalidHexExcluded: true, variantsSavedIndependently: true };
  });
  await step('palette-four-second-delete-and-leave-undo', async () => {
    await theme().getByRole('button', { name: '复制为新方案', exact: true }).click();
    await expect.poll(selectedScheme).toBe(disposableLabel);
    const armedAt = Date.now();
    await theme().getByRole('button', { name: '删除方案', exact: true }).click();
    await expect(theme().getByRole('button', { name: '再次点击确认删除', exact: true })).toBeVisible();
    await expect(theme().getByRole('button', { name: '删除方案', exact: true })).toBeVisible({ timeout: 6500 });
    const elapsed = Date.now() - armedAt;
    assert.ok(elapsed >= 3800 && elapsed < 6500, 'Delete confirmation must expire after the real four-second interval');
    assert.equal(await selectedScheme(), disposableLabel);
    await theme().getByRole('button', { name: '删除方案', exact: true }).click();
    await theme().getByRole('button', { name: '再次点击确认删除', exact: true }).click();
    await expect(theme().locator('.theme-scheme__name').filter({ hasText: disposableLabel })).toHaveCount(0);
    await chooseScheme(customLabel);
    await paletteHex().fill('#445566');
    await expect.poll(paper).toBe('#445566');
    await navigate('persona');
    await expect.poll(paper).toBe('#1a2b3c');
    await navigate('start');
    await paletteOpen();
    await expect(paletteHex()).toHaveValue('#1A2B3C');
    await expect.poll(selectedScheme).toBe(customLabel);
    report.palette.deleteConfirmationMs = elapsed;
    report.palette.leaveRevertedUnsavedPreview = true;
  });
  await step('minimum-layout-and-native-zoom', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('/console/index.html'));
      if (!win) throw new Error('Missing settings window');
      win.setSize(500, 400);
    });
    const minimum = await windowState('console');
    assert.deepEqual(minimum.minimum, [880, 600]);
    assert.equal(minimum.bounds.width, 880);
    assert.equal(minimum.bounds.height, 600);
    report.geometry.push({ kind: 'native-minimum', ...minimum });
    await resizeContent(880, 600);
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await noOverflow('880x600 at 100%');
    await capture('minimum-880x600');
    await nativeZoomKey('+');
    await expect.poll(async () => (await windowState('console')).zoom).toBeGreaterThan(1);
    await noOverflow('minimum native zoom in');
    await nativeZoomKey('-');
    await nativeZoomKey('0');
    await expect.poll(async () => (await windowState('console')).zoom).toBe(1);
    await resizeContent(1200, 800);
    report.zoom = { nativeSendInputEvent: true, reset: 1 };
  });
  await step('model-key-save-with-real-network-denial', async () => {
    await page.getByTestId('model-pick-deepseek').click();
    const before = await modelState();
    assert.equal(before.credentialStorageAvailable, true, 'Native credential storage is required; UI QA never emulates it');
    assert.equal(before.active, null);
    await expect(section('连接模型').getByLabel(/DeepSeek 的 API Key/)).toHaveAccessibleName('DeepSeek 的 API Key');
    await section('连接模型').getByLabel('模型', { exact: true }).fill('qa-ui-denied-model');
    await section('连接模型').locator('input[type="password"]').fill(fixtureKey);
    await page.getByTestId('model-save').click();
    await denyRealModelNetwork();
    await expect(page.getByTestId('model-save')).toHaveText('保存并开始');
    await expect.poll(async () => (await modelState()).endpoints.find(endpoint => endpoint.id === 'deepseek')?.keyConfigured).toBe(true);
    const saved = await modelState();
    assert.equal(saved.active, null, 'Denying the real probe must not activate a model');
    assert.equal(saved.endpoints.find(endpoint => endpoint.id === 'deepseek').model, 'qa-ui-denied-model');
    assert.ok(saved.revision > before.revision);
    assert.equal((await demo()).settings.replyMode, 'demo');
    assert.ok(!JSON.stringify(saved).includes(fixtureKey), 'Model metadata exposed the synthetic credential');
    await expect(section('连接模型').getByText('暂未连接', { exact: true })).toBeVisible();
    await expect(section('连接模型').getByText('已连接，桌宠开始接话。', { exact: true })).toHaveCount(0);
    await expect(section('连接模型').getByRole('status').filter({ hasText: /连接.*(失败|没有|未)/ })).toBeVisible();
    report.model = { savedKeyPresent: true, active: false, offlineModePreserved: true, deniedNetworkApprovals: report.approvals.filter(item => item.kind === 'network' && !item.approved).length };
  });
  await step('native-show-hide-and-dress', async () => {
    await expect(preview()).toBeVisible();
    const previewBounds = await preview().boundingBox();
    const hideBounds = await page.getByTestId('pet-hide').boundingBox();
    assert.ok(previewBounds && hideBounds && previewBounds.y + previewBounds.height <= hideBounds.y + 2, 'Preview must sit above desktop controls');
    await page.getByTestId('pet-hide').click();
    await expect.poll(async () => (await windowState('pet')).visible).toBe(false);
    await expect.poll(async () => (await application()).desktop.shown).toBe(false);
    await expect.poll(async () => (await application()).profile.data.visible).toBe(false);
    await expect(section('我的桌宠').getByText('已隐藏', { exact: true })).toBeVisible();
    await expect(preview()).toBeVisible();
    await expect(preview().getByTestId('pet-avatar')).toBeVisible();
    await page.getByTestId('pet-show').click();
    await expect.poll(async () => (await windowState('pet')).visible).toBe(true);
    await expect.poll(async () => (await application()).desktop.shown).toBe(true);
    await page.getByTestId('pet-dress').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText((await application()).pages.find(item => item.owner.pluginId === 'pet.page-appearance').title);
    await navigate('start');
    report.desktop = { nativeHide: true, nativeShow: true, previewRemainsVisible: true, dressUsesOwnedPage: true };
  });
  await step('preview-poke-and-chat-share-Core-history', async () => {
    await preview().scrollIntoViewIfNeeded();
    const avatarBox=await preview().getByTestId('pet-avatar').boundingBox();const floorBox=await preview().locator('.pet-preview__floor').boundingBox();
    assert.ok(avatarBox&&floorBox&&avatarBox.y+avatarBox.height<=floorBox.y+2,'The preview floor must not cover the avatar');
    const themeBefore=await page.locator('html').getAttribute('data-theme');const lightBefore=await preview().getAttribute('data-light');
    await preview().getByTestId('pet-light-toggle').click();await expect(preview()).toHaveAttribute('data-light',lightBefore==='day'?'night':'day');assert.equal(await page.locator('html').getAttribute('data-theme'),themeBefore);
    await preview().getByTestId('pet-light-toggle').click();await expect(preview()).toHaveAttribute('data-light',lightBefore);
    await preview().getByTestId('pet-mic-toggle').hover();await expect(preview().getByTestId('pet-mic-toggle')).toBeDisabled();assert.ok((await preview().getByTestId('pet-mic-toggle').getAttribute('title'))?.trim());
    await preview().getByTestId('pet-poke').focus();await page.keyboard.press('Shift+F10');await expect(preview().getByRole('menu')).toBeVisible();await page.keyboard.press('Escape');await expect(preview().getByRole('menu')).toHaveCount(0);
    await preview().click({button:'right'});await preview().getByTestId('pet-menu-voice').click();await expect(page.getByRole('heading',{level:1})).toHaveText((await application()).pages.find(item=>item.owner.pluginId==='pet.page-voice').title);await navigate('start');
    await preview().getByTestId('pet-poke').scrollIntoViewIfNeeded();const dragCursor=(await application()).cursor;const start=await preview().getByTestId('pet-poke').boundingBox();assert.ok(start);
    await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(start.x+start.width/2+24,start.y+start.height/2-8,{steps:4});await page.mouse.up();
    await expect.poll(async()=>(await application()).history.filter(item=>item.cursor>dragCursor&&item.reaction==='drag').length).toBe(1);assert.equal((await application()).history.filter(item=>item.cursor>dragCursor&&item.reaction==='poke').length,0);
    report.previewControls={fullAvatar:true,independentDayNight:true,keyboardMenu:true,sharedVoiceConfiguration:true,unavailableMicDisabled:true,boundedDrag:true};
    const before = (await application()).cursor;
    await expect(preview().getByTestId('pet-avatar')).toBeVisible();
    await preview().getByTestId('pet-avatar').click();
    await expect(preview().getByTestId('pet-avatar')).toHaveAttribute('data-expression','blush');
    await expect.poll(async () => (await application()).history.filter(item => item.cursor > before && item.reaction === 'poke').length, { timeout: 15000 }).toBe(1);
    const poke = (await application()).history.find(item => item.cursor > before && item.reaction === 'poke');
    const chatCursor = (await application()).cursor;
    await preview().getByTestId('pet-chat-toggle').click();
    await preview().getByRole('textbox', { name: '要说的话', exact: true }).fill(fixturePrompt);
    await preview().getByTestId('pet-composer-send').click();
    await expect.poll(async () => (await application()).history.filter(item => item.cursor > chatCursor && item.kind === 'pet' && item.mode === 'demo').length, { timeout: 20000 }).toBe(1);
    const history = (await application()).history.filter(item => item.cursor > chatCursor);
    const user = history.filter(item => item.kind === 'user'), reply = history.filter(item => item.kind === 'pet');
    assert.ok(user.length === 1 && user[0].text === fixturePrompt && reply.length === 1, 'Preview chat duplicated or lost actual Core history entries');
    const messages = (await demo()).messages;
    assert.ok(messages.some(item => item.text === user[0].text) && messages.some(item => item.text === reply[0].text), 'Preview and native pet must project the same history');
    await expect(preview().getByRole('textbox', { name: '要说的话', exact: true })).toHaveValue('');
    assert.equal(await preview().getByTestId('demo-record').count(), 0, 'Preview must not create a second recorder');
    await expect(page.getByTestId('demo-record')).toHaveCount(0);
    assert.equal((await demo()).recordingStartedAt, null);
    await navigate('appearance');await page.locator('.pk-row').filter({has:page.getByText('允许拖动',{exact:true})}).getByRole('checkbox').click();await expect.poll(async()=>(await application()).profile.data.draggable).toBe(false);await navigate('start');
    const noDragCursor=(await application()).cursor;await preview().getByTestId('pet-avatar').click();await expect.poll(async()=>(await application()).history.filter(item=>item.cursor>noDragCursor&&item.reaction==='poke').length).toBe(1);
    const keyboardCursor=(await application()).cursor;await preview().getByTestId('pet-poke').focus();await page.keyboard.press('Enter');await expect.poll(async()=>(await application()).history.filter(item=>item.cursor>keyboardCursor&&item.reaction==='poke').length).toBe(1);
    await navigate('appearance');await page.locator('.pk-row').filter({has:page.getByText('允许拖动',{exact:true})}).getByRole('checkbox').click();await expect.poll(async()=>(await application()).profile.data.draggable).toBe(true);
    report.previewControls.keyboardPoke=true;report.previewControls.pokeWithDragDisabled=true;
    await navigate('conversation');
    const timeline = page.getByRole('list', { name: '日常互动记录', exact: true });
    const totalPokes=(await application()).history.filter(item=>item.reaction==='poke'&&item.text===poke.text).length;assert.ok(totalPokes>=3);
    await expect(timeline.getByText(poke.text, { exact: true })).toHaveCount(totalPokes);
    await expect(timeline.getByText(user[0].text, { exact: true })).toHaveCount(1);
    await expect(timeline.getByText(reply[0].text, { exact: true })).toHaveCount(1);
    report.history = { pokeEntries: totalPokes, explicitPokeActions:3, userEntries: user.length, replyEntries: reply.length, mode: 'demo', secondRecorder: false };
    await navigate('start');
  });
  await step('guide-from-hidden-pet', async () => {
    await page.getByTestId('pet-hide').click();
    await expect.poll(async () => (await windowState('pet')).visible).toBe(false);
    const revision = (await application()).profile.revision;
    await page.getByTestId('start-guide').click();
    await expect.poll(async () => (await application()).profile.data.visible).toBe(true);
    await expect.poll(async () => (await application()).desktop.shown).toBe(true);
    await expect.poll(async () => (await windowState('pet')).visible).toBe(true);
    await expect.poll(async () => (await windowState('console')).visible).toBe(false);
    await expect.poll(async () => (await application()).dialog?.step).toBe('welcome');
    assert.ok((await application()).profile.revision > revision, 'Guide must save hidden pet visibility through Main');
    await pet.getByTestId('pet-dialog-choice-later').click();
    await expect.poll(async () => (await application()).dialog).toBeNull();
    await settingsFromPet();
    await navigate('start');
    report.guide = { savedVisible: true, nativePetShown: true, settingsHidden: true, actualDialog: true };
  });
  await step('restart-keeps-user-preferences', async () => {
    await chooseMode('dark');
    await chooseScheme(customLabel);
    if (await page.getByRole('button', { name: '收起侧栏', exact: true }).count()) await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    const before = await application();
    restartExpected = { profile: before.profile, ids: before.history.map(item => item.id), modelRevision: (await modelState()).revision };
    await close();
    await launch();
    await expect.poll(async () => (await application()).dialog).toBeNull();
    const after = await application();
    assert.ok(JSON.stringify(after.profile) === JSON.stringify(restartExpected.profile), 'Saved profile preferences changed across the real application restart');
    assert.deepEqual(after.history.map(item => item.id), restartExpected.ids);
    await navigate('start');
    await expect(page.locator('.pk-settings')).toHaveAttribute('data-rail', 'collapsed');
    await expect.poll(async () => Math.round((await page.locator('.pk-settings__sidebar').boundingBox()).width)).toBe(72);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(selectedScheme).toBe(customLabel);
    await paletteOpen();
    await expect(paletteHex()).toHaveValue('#1A2B3C');
    const models = await modelState();
    assert.equal(models.revision, restartExpected.modelRevision);
    assert.equal(models.active, null);
    assert.equal(models.endpoints.find(endpoint => endpoint.id === 'deepseek').keyConfigured, true);
    assert.equal((await demo()).settings.replyMode, 'demo');
    assert.equal((await windowState('console')).zoom, 1);
    report.persistence = { retainedHistoryEntries: after.history.length, profileRevision: after.profile.revision,
      themeMode: 'dark', customVariant: true, railCollapsed: true, keyPresentWithoutActivation: true };
  });
  assert.equal(report.errors.length, 0, 'Renderer errors were observed');
  assert.equal(report.rendererRemoteOrigins.length, 0, 'Unexpected renderer network requests were observed');
  report.status = 'passed';
}

if (process.argv.includes('--source-check')) {
  const source = await inspectSource();
  console.log(JSON.stringify({ mode: 'source-only', ...source }));
  if (source.referenceVersion !== '0.2.10' || source.selectors.some(item => !item.present) || Object.values(source.dependencies).some(value => !value)) process.exitCode = 1;
} else {
  nativeDeadline = Date.now() + TOTAL_MS;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Overall Start UI acceptance exceeded ' + TOTAL_MS + ' ms')); }, TOTAL_MS); });
  try {
    await Promise.race([run(), timeout]);
  } catch (error) {
    report.status = 'failed'; report.failure = redact(error);
    if (activeCheck?.status === 'running') { activeCheck.status = 'failed'; activeCheck.error = report.failure; }
    if (pet && !pet.isClosed()) {
      let diagnosticTimer;
      try {
        const [state,delivery,model,permissions] = await Promise.race([Promise.all([application(),demo(),modelState(),security()]), new Promise((_, reject) => {
          diagnosticTimer = setTimeout(() => reject(new Error('Read-only failure snapshot timed out')), 3000);
        })]);
        report.failureState = { agent: state.agent.state, code: state.error?.code ?? null,
          dialogStep: state.dialog?.step ?? null, desktop: state.desktop, profileRevision: state.profile?.revision ?? null,
          delivery:{phase:delivery.phase,error:delivery.error?.code??null,mode:delivery.settings.replyMode,paused:delivery.paused,canSend:delivery.canSend,messages:delivery.messages.map(item=>({kind:item.kind,mode:item.mode,via:item.via})),history:state.history.map(item=>({kind:item.kind,mode:item.mode,reaction:item.reaction,via:item.via,cursor:item.cursor}))},
          model:{active:model.active?.id??null,paused:model.paused},pending:permissions.pending.map(item=>({kind:item.permission.kind}))};
      } catch (diagnosticError) { report.diagnosticError = redact(diagnosticError); }
      finally { clearTimeout(diagnosticTimer); }
    }
  } finally {
    clearTimeout(timer);
    try { await close(); } catch (error) { report.status = 'failed'; report.cleanupError = redact(error); }
    if (report.errors.length || report.rendererRemoteOrigins.length || report.shutdown.some(item => !item.exitConfirmed || item.forced || item.code !== 0 || item.signal !== null)) report.status = 'failed';
    report.mainLogBytes = mainLogBytes; // Raw Main logs can contain prompts; retain only the byte count.
    const serialized = JSON.stringify(report);
    const privateSafe = privateText.every(secret => !serialized.includes(secret));
    const bounded = Buffer.byteLength(serialized) <= 96 * 1024;
    let finalReport = report;
    if (!privateSafe || !bounded) {
      report.status = 'failed';
      finalReport = { status: 'failed', profileId, shutdown: report.shutdown,
        failure: privateSafe ? 'UI report exceeded 96 KiB' : 'UI report failed private input exclusion' };
    }
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'acceptance-report.json'), JSON.stringify(finalReport, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, report: path.relative(root, path.join(output, 'acceptance-report.json')),
      checks: report.checks.map(({ name, status }) => ({ name, status })), shutdown: report.shutdown }));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
}
