import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

/* global window, document, getComputedStyle, innerWidth, innerHeight, requestAnimationFrame, matchMedia */

// Build/run serially only after the parent relays the complete source freeze.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executablePath = path.join(
  path.dirname(require.resolve('electron/package.json')),
  'dist/electron.exe',
);
const ids = ['precision', 'hearth', 'folio', 'prism', 'workbench'];
const profileId = 'native-' + Date.now() + '-' + randomUUID().slice(0, 8);
const profilePath = path.join(root, '.cache', 'pet-demo-acceptance-' + profileId);
const output = path.join(root, 'qa/screenshots/style-families', profileId);
const reportPath = path.join(output, 'native-report.json');
const fixtureKey = 'QA_FAMILY_KEY_' + randomUUID();
const fixturePrompt = 'QA_FAMILY_PRIVATE_' + randomUUID();
const TOTAL_MS = 540000;
const tokenKeys = [
  'paper',
  'paper-2',
  'sheet',
  'sheet-2',
  'sheet-3',
  'ink',
  'ink-soft',
  'ink-dim',
  'line',
  'line-2',
  'line-strong',
  'accent',
  'accent-2',
  'on-accent',
  'ok',
  'warn',
  'danger',
  'ink-blue',
  'violet',
  'agent-surface',
  'world-bg',
  'world-ink',
  'bubble-bg',
  'bubble-ink',
  'tool-result',
  'chart-hit',
  'chart-miss',
  'chart-output',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
];
const familyInfo = {
  precision: {
    root: 'sf-precision',
    board: 'px-board',
    stage: '[data-testid=pet-stage]',
    hex: 'theme-hex-',
    picker: 'theme-token-',
    name: 'theme-name',
    undo: 'theme-undo',
  },
  folio: {
    root: 'sf-folio',
    board: 'fl-specimen',
    stage: '[data-testid=pet-stage]',
    hex: 'theme-hex-',
    picker: 'theme-token-',
    name: 'theme-name',
    undo: 'theme-undo',
  },
  hearth: {
    root: 'family-hearth',
    board: 'hearth-board',
    stage: '.hth-nook',
    hex: 'theme-token-',
    picker: 'theme-token-',
    name: 'theme-scheme-name',
    undo: 'theme-undo-preview',
  },
  prism: {
    root: 'family-prism',
    board: 'prism-board',
    stage: '.pr-stage',
    hex: 'theme-token-',
    picker: 'theme-token-',
    name: 'theme-scheme-name',
    undo: 'theme-undo-preview',
  },
  workbench: {
    root: 'workbench-window',
    board: 'original-control-board',
    stage: '.pet-bench',
    hex: 'theme-token-',
    picker: 'theme-token-',
    name: 'theme-scheme-name',
    undo: 'theme-undo-preview',
  },
};
const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const redact = (value) =>
  stripVTControlCharacters(String(value?.message ?? value))
    .split(fixtureKey)
    .join('[QA credential]')
    .split(fixturePrompt)
    .join('[QA private text]')
    .replace(/QA_FAMILY_(KEY|PRIVATE)_[A-Za-z0-9_-]+/g, '[QA private input]')
    .replace(/Bearer\s+\S+/gi, '[credential]')
    .slice(-2000);
const report = {
  status: 'running',
  profileId,
  at: new Date().toISOString(),
  checks: [],
  screenshots: [],
  geometry: [],
  identity: [],
  approvals: [],
  families: [],
  themes: [],
  errors: [],
  remoteOrigins: [],
  shutdown: [],
  limitations: [
    'Real unpackaged Electron and real Core, isolated native profile; all product writes use visible controls. Bridges are read only for evidence.',
    'No fake bridge, injected IPC/state, media device, microphone permission bypass, provider fixture, paid request, account sign-in, installation, or server.',
    'Model tests remain disabled without an active connection. Save-and-start exercises the real probe, whose real network approval is denied. No connected/active success is fabricated.',
    'Pointer input does not establish physical desktop hit testing. Microphone availability is read and compared; native audio is not captured.',
    'Renderer request observation is not worker packet capture; actual network permission denial guards model calls.',
  ],
};
let app,
  page,
  pet,
  family = 'precision',
  activeCheck,
  closing,
  expired = false,
  mainLogBytes = 0;
const checkActive = () =>
  assert.equal(expired, false, 'Native probe exceeded its bounded deadline');
const unwrap = (result, label) => {
  assert.ok(result?.ok, label + ': ' + (result?.error?.code ?? 'missing result'));
  return result.value;
};
const application = async () =>
  unwrap(await pet.evaluate(() => window.petApplication.getSnapshot()), 'Application');
const demo = async () => unwrap(await pet.evaluate(() => window.petDemo.getSnapshot()), 'Demo');
const models = async () =>
  unwrap(await page.evaluate(() => window.petModels.getSnapshot()), 'Model metadata');
const security = async () =>
  unwrap(await page.evaluate(() => window.petConsole.getSecurity()), 'Permissions');
const storedTheme = () => page.evaluate(() => localStorage.getItem('pet.console.theme'));
const themeRecord = async () => JSON.parse(await storedTheme());
const globalPaper = () =>
  page
    .locator('html')
    .evaluate((node) => getComputedStyle(node).getPropertyValue('--paper').trim().toLowerCase());
const familyRoot = () => page.getByTestId(familyInfo[family].root);
const desktopControl = (id) =>
  family === 'workbench' ? familyRoot().locator('.wb__rail').getByTestId(id) : page.getByTestId(id);
const hex = (key) =>
  page.getByTestId(
    familyInfo[family].hex + key + (['precision', 'folio'].includes(family) ? '' : '-hex'),
  );
const picker = (key) =>
  page.getByTestId(
    familyInfo[family].picker + key + (['precision', 'folio'].includes(family) ? '' : '-picker'),
  );
async function persist() {
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
async function step(name, action) {
  checkActive();
  activeCheck = { name, status: 'running' };
  report.checks.push(activeCheck);
  const at = Date.now();
  await action();
  checkActive();
  const state = await application();
  assert.equal(state.agent.state, 'ready', name + ' left the real agent unavailable');
  assert.equal(state.error?.code ?? null, null, name + ' left an application error');
  activeCheck.agent = { state: state.agent.state, error: state.error?.code ?? null };
  activeCheck.status = 'passed';
  activeCheck.elapsedMs = Date.now() - at;
  await persist();
  console.log(
    JSON.stringify({ event: 'check', name, status: 'passed', report: relative(reportPath) }),
  );
}
async function filesUnder(directory) {
  const out = [];
  for (const item of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = directory + '/' + item.name;
    if (item.isDirectory()) out.push(...(await filesUnder(file)));
    else if (item.isFile()) out.push(file);
  }
  return out.sort();
}
async function fingerprint() {
  const familyFiles = (await filesUnder('apps/desktop/src/renderer/console/style-families')).filter(
    (file) => !file.includes('.test.') && !file.endsWith('/stub-model.ts'),
  );
  const source = [
    ...familyFiles,
    'qa/probes/start-style-families-e2e.mjs',
    'apps/desktop/src/renderer/console/console-app.tsx',
    'apps/desktop/src/renderer/console/pages/start.tsx',
    'apps/desktop/src/renderer/console/start-designs/use-start-model.ts',
    'apps/desktop/src/renderer/console/start-designs/behavior.ts',
    'apps/desktop/src/renderer/console/start-designs/sections.tsx',
    'apps/desktop/src/renderer/console/original-ui/theme-controller.ts',
    'apps/desktop/src/renderer/console/original-ui/pet-preview.tsx',
    'apps/desktop/src/renderer/console/preview-behavior.ts',
    'apps/desktop/src/renderer/console/theme.ts',
    'apps/desktop/src/main/index.ts',
    'apps/desktop/src/preload/index.ts',
  ];
  const built = [
    ...(await filesUnder('apps/desktop/dist')),
    ...(await filesUnder('plugins')).filter(
      (file) => file.includes('/dist/') || file.endsWith('/plugin.json'),
    ),
    'apps/desktop/src/main/builtin-admission.json',
  ]
    .filter((file) => /\.(mjs|cjs|js|css|html|json)$/.test(file))
    .sort();
  const hash = async (files) => {
    const rows = [];
    for (const file of files) {
      const bytes = await fs.readFile(path.join(root, file));
      rows.push({
        path: file,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    return { digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), files: rows };
  };
  return {
    source: await hash(source),
    build: await hash(built),
    git: {
      branch: execFileSync('git', ['branch', '--show-current'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    },
  };
}
async function nativeWindow(target) {
  return app.evaluate(({ BrowserWindow }, target) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/' + target + '/index.html'),
    );
    if (!w) throw new Error('Missing window ' + target);
    return {
      visible: w.isVisible(),
      bounds: w.getBounds(),
      content: w.getContentBounds(),
      minimum: w.getMinimumSize(),
      zoom: w.webContents.getZoomFactor(),
    };
  }, target);
}
async function resize(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('/console/index.html'),
      );
      w.setContentSize(size.width, size.height);
      w.webContents.setZoomFactor(1);
    },
    { width, height },
  );
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  assert.equal((await nativeWindow('console')).zoom, 1);
}
async function launch() {
  checkActive();
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
    executablePath,
    args: [
      '--no-sandbox',
      path.join(root, 'apps/desktop'),
      '--demo-acceptance=' + profileId,
      '--start-design-lab',
      '--show-settings',
    ],
    env,
    timeout: 30000,
  });
  closing = undefined;
  const child = app.process(),
    shutdown = { pid: child.pid, exitConfirmed: false, code: null, signal: null, forced: false };
  report.shutdown.push(shutdown);
  child.once('exit', (code, signal) =>
    Object.assign(shutdown, { exitConfirmed: true, code, signal }),
  );
  child.stderr?.on('data', (chunk) => {
    mainLogBytes += chunk.byteLength;
  });
  const seen = new Set();
  const observe = (target) => {
    if (seen.has(target)) return;
    seen.add(target);
    target.setDefaultTimeout(8000);
    target.on('pageerror', (error) => report.errors.push(redact(error)));
    target.on('console', (msg) => {
      if (msg.type() === 'error') report.errors.push(redact(msg.text()));
    });
    target.on('request', (req) => {
      if (/^https?:/.test(req.url())) report.remoteOrigins.push(new URL(req.url()).origin);
    });
  };
  app.context().on('page', observe);
  app.context().pages().forEach(observe);
  await expect
    .poll(() => app.windows().some((w) => w.url().includes('/console/index.html')), {
      timeout: 20000,
    })
    .toBe(true);
  page = app.windows().find((w) => w.url().includes('/console/index.html'));
  pet = app.windows().find((w) => w.url().includes('/pet/index.html'));
  await expect(page.getByTestId('style-family-gallery')).toBeVisible();
  await expect
    .poll(async () => (await application()).agent.state, { timeout: 20000 })
    .toBe('ready');
  const identity = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    userData: app.getPath('userData'),
    versions: process.versions,
    platform: process.platform,
  }));
  assert.equal(identity.packaged, false);
  assert.equal(path.resolve(identity.userData).toLowerCase(), profilePath.toLowerCase());
  report.identity.push({ ...identity, userData: relative(identity.userData) });
  const state = await application();
  if (state.dialog?.choices.some((c) => c.id === 'later'))
    await pet.getByTestId('pet-dialog-choice-later').click();
  await resize(1200, 800);
  await page.bringToFront();
}
async function close() {
  if (!app) return;
  if (closing) return closing;
  const owned = app,
    child = owned.process(),
    shutdown = report.shutdown.at(-1);
  closing = (async () => {
    let timer;
    const normal = owned.close();
    try {
      await Promise.race([
        normal,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Native close exceeded 20 seconds')), 20000);
        }),
      ]);
      await expect.poll(() => shutdown.exitConfirmed, { timeout: 5000 }).toBe(true);
      assert.equal(shutdown.code, 0);
      assert.equal(shutdown.signal, null);
    } catch (error) {
      if (!shutdown.exitConfirmed && child.pid) {
        shutdown.forced = true;
        shutdown.treeKillCode = await new Promise((resolve, reject) => {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.once('error', reject);
          killer.once('exit', resolve);
        });
        await expect.poll(() => shutdown.exitConfirmed, { timeout: 5000 }).toBe(true);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      void normal.catch(() => {});
      app = undefined;
    }
  })();
  return closing;
}
async function pick(id) {
  await page.bringToFront();
  await page.getByTestId('style-pick-' + id).click();
  family = id;
  await expect(page.getByTestId('style-family-gallery')).toHaveAttribute('data-family', id);
  await expect(familyRoot()).toBeVisible();
  await page.getByTestId('style-view-start').click();
}
async function reveal(part) {
  await page.getByTestId('style-view-start').click();
  if (family === 'precision')
    await page
      .getByTestId('px-panel-' + { connect: 'connect', pet: 'presence', theme: 'palette' }[part])
      .click();
  if (family === 'folio')
    await page
      .getByTestId(
        'fl-leaf-' +
          ({ connect: 'entry', provider: 'provider', pet: 'presence', theme: 'palette' }[part] ??
            part),
      )
      .click();
  const id = {
    connect: 'start-connect-form',
    provider: 'start-provider',
    pet: 'start-pet',
    theme: family === 'workbench' ? 'theme-studio' : 'start-theme',
  }[part];
  if (id) await page.getByTestId(id).scrollIntoViewIfNeeded();
}
async function resetScroll() {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const node of document.querySelectorAll(
      '.sf-stage,main,.sf-root,.px-body,.fl-body,.wb__main,.hth-main,.pr-stack',
    ))
      node.scrollTo(0, 0);
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function geometry(label) {
  const rows = await page.evaluate((testid) => {
    const nodes = [
      document.documentElement,
      document.body,
      document.querySelector('[data-testid=style-family-gallery]'),
      document.querySelector('[data-testid=style-family-stage]'),
      document.querySelector('[data-testid=' + testid + ']'),
    ];
    return nodes.map((n) => {
      if (!n) throw new Error('Missing layout node');
      const r = n.getBoundingClientRect();
      return {
        node: n.dataset.testid ?? n.tagName,
        client: n.clientWidth,
        scroll: n.scrollWidth,
        left: Math.round(r.left),
        right: Math.round(r.right),
      };
    });
  }, familyInfo[family].root);
  const failed = rows.filter((r) => r.scroll > r.client + 1);
  report.geometry.push({ label, rows, pass: failed.length === 0 });
  return failed;
}
async function capture(label) {
  checkActive();
  assert.ok(report.screenshots.length < 70, 'Screenshot budget');
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const privateMasks = page.locator('input').filter({ visible: true });
  const mask = [];
  for (const input of await privateMasks.all()) {
    const value = await input.inputValue().catch(() => '');
    if (value.includes('QA_FAMILY_')) mask.push(input);
  }
  for (const node of await page.locator('p, [role=status]').filter({ hasText: 'QA_FAMILY_' }).all())
    if (await node.isVisible()) mask.push(node);
  const file = path.join(output, label + '.png');
  await page.screenshot({ path: file, mask, maskColor: '#858b91' });
  report.screenshots.push({
    family,
    label,
    path: relative(file),
    ...size,
    zoom: (await nativeWindow('console')).zoom,
    privateMasks: mask.length,
  });
}
async function chooseMode(mode) {
  await reveal('theme');
  const control = page.getByTestId('theme-mode-' + mode);
  const tag = await control.evaluate((n) => n.tagName);
  if (tag === 'INPUT') {
    await control.focus();
    await control.press('Space');
  } else await control.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
}
async function chooseScheme(id) {
  await reveal('theme');
  if (['precision', 'folio'].includes(family))
    await page.getByTestId('theme-scheme-select').selectOption(id);
  else {
    const n = page.getByTestId('theme-scheme-' + id);
    if (await n.evaluate((n) => n.tagName === 'INPUT'))
      await n.locator('xpath=ancestor::label[1]').click();
    else await n.click();
  }
  await expect.poll(async () => (await themeRecord()).selectedId).toBe(id);
}
async function providerOpen() {
  if (family === 'folio') await reveal('provider');
  else await reveal('connect');
  if (family === 'prism') await page.getByTestId('model-provider-open').click();
}
async function selectProvider(id) {
  await providerOpen();
  await page.getByTestId('model-provider-search').fill('');
  if (family === 'precision') await page.getByTestId('model-provider-select').selectOption(id);
  else if (family === 'prism') {
    await page.getByTestId('model-provider-search').fill(id);
    await page.getByTestId('model-provider-search').press('Enter');
    await expect(page.getByTestId('model-provider-dialog')).not.toBeVisible();
  } else {
    const n = page.getByTestId('model-pick-' + id);
    if (await n.evaluate((n) => n.tagName === 'INPUT'))
      await n.locator('xpath=ancestor::label[1]').click();
    else await n.click();
  }
  await reveal('connect');
}
async function keyboardToggle(control) {
  await expect(control).toBeEnabled();
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect(control).toBeFocused();
  await control.press('Space');
}
async function denyNetwork() {
  const deadline = Date.now() + 15000;
  let denied = false;
  while (!denied) {
    checkActive();
    assert.ok(Date.now() < deadline, 'Real network approval did not arrive');
    const prompt = (await security()).pending[0];
    if (!prompt) {
      await page.waitForTimeout(40);
      continue;
    }
    assert.equal(prompt.owner.pluginId, 'pet.llm-provider');
    const dialog = (await application()).dialog;
    assert.ok(dialog && dialog.id === prompt.requestId && dialog.step === prompt.permissionDigest);
    await expect(pet.getByTestId('pet-dialog')).toHaveAttribute('data-busy', 'false');
    const permission = prompt.permission;
    if (permission.kind === 'capability-use' && permission.capability === 'llm.responses@1') {
      await pet.getByTestId('pet-dialog-choice-allow').click();
      report.approvals.push({ family, kind: permission.kind, approved: true });
      await expect
        .poll(async () =>
          (await security()).pending.some((item) => item.requestId === prompt.requestId),
        )
        .toBe(false);
    } else {
      assert.equal(permission.kind, 'network');
      assert.deepEqual(permission.origins, ['https://api.deepseek.com']);
      await pet.getByTestId('pet-dialog-choice-deny').click();
      report.approvals.push({ family, kind: 'network', approved: false });
      denied = true;
    }
  }
  await expect.poll(async () => (await security()).pending.length).toBe(0);
  await page.bringToFront();
}
async function visualMatrix() {
  const identity = {};
  for (const id of ids) {
    await pick(id);
    identity[id] = {};
    for (const [width, height] of [
      [1200, 800],
      [880, 600],
    ]) {
      await resize(width, height);
      for (const mode of ['light', 'dark']) {
        await chooseMode(mode);
        identity[id][mode] = await familyRoot().evaluate((n) => ({
          paper: getComputedStyle(n).getPropertyValue('--paper').trim().toLowerCase(),
          font: getComputedStyle(n).fontFamily,
          background: getComputedStyle(n).backgroundColor,
        }));
        if (family === 'folio') await reveal('provider');
        else await reveal('connect');
        await resetScroll();
        await geometry(id + ' ' + mode + ' ' + width + ' start');
        await capture(id + '-' + mode + '-start-' + width + 'x' + height);
        await page.getByTestId('style-view-board').click();
        await expect(page.getByTestId(familyInfo[id].board)).toBeVisible();
        await resetScroll();
        await geometry(id + ' ' + mode + ' ' + width + ' board');
        await capture(id + '-' + mode + '-board-' + width + 'x' + height);
        await page.getByTestId('style-view-start').click();
      }
    }
  }
  report.visualIdentity = identity;
  for (const id of ids.slice(0, 4))
    assert.notEqual(
      identity[id].light.paper,
      identity[id].dark.paper,
      id + ' light/dark must preserve its family seed design',
    );
  for (const mode of ['light', 'dark'])
    assert.ok(
      new Set(ids.map((id) => identity[id][mode].paper)).size >= 4,
      'Family seeds collapsed to one global palette',
    );
  await persist();
  console.log(
    JSON.stringify({
      event: 'all-five-visual-captures-ready',
      screenshots: report.screenshots.length,
      report: relative(reportPath),
    }),
  );
  assert.ok(
    report.geometry.every((g) => g.pass),
    'Horizontal overflow recorded in visual matrix',
  );
  await resize(1200, 800);
}
async function boardInteractions() {
  for (const id of ids) {
    await pick(id);
    await page.getByTestId('style-view-board').click();
    const before = await storedTheme(),
      revision = (await models()).revision;
    if (id === 'precision') {
      await page.getByTestId('px-board-select').selectOption('slate');
      await expect(page.getByTestId('px-board-select')).toHaveValue('slate');
      await keyboardToggle(page.getByTestId('px-board-switch'));
      await expect(page.getByTestId('px-board-switch')).not.toBeChecked();
      await page.getByTestId('px-board-btn-pending').click();
      await expect(page.getByTestId('px-board-btn-pending')).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByTestId('px-board-btn-disabled')).toBeDisabled();
    }
    if (id === 'folio') {
      await page.getByTestId('fl-board-field').fill('folio specimen');
      await expect(page.getByTestId('fl-board-field')).toHaveValue('folio specimen');
      await keyboardToggle(page.getByTestId('fl-board-check'));
      await expect(page.getByTestId('fl-board-check')).not.toBeChecked();
      await page.getByTestId('fl-board-pending').click();
      await expect(page.getByTestId('fl-board-pending')).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByTestId('fl-board-disabled')).toBeDisabled();
    }
    if (id === 'hearth') {
      await page.getByTestId('board-field-input').fill('ab');
      await expect(page.getByTestId('board-key-input')).toHaveAttribute('aria-invalid', 'true');
      await keyboardToggle(page.getByTestId('board-pause'));
      await expect(page.getByTestId('board-pause')).toBeChecked();
      await page.getByRole('button', { name: '点我演示等待', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '正在写入这台机器…', exact: true }),
      ).toBeDisabled();
    }
    if (id === 'prism') {
      await page.getByTestId('board-summon').click();
      await expect(page.getByTestId('board-command')).toBeVisible();
      await expect(page.getByTestId('board-search')).toBeFocused();
      await page.getByTestId('board-search').press('Escape');
      await expect(page.getByTestId('board-command')).not.toBeVisible();
      await expect(page.getByTestId('board-summon')).toBeFocused();
      await keyboardToggle(page.getByTestId('board-pause'));
      await expect(page.getByTestId('board-pause')).toHaveAttribute('aria-pressed', 'true');
    }
    if (id === 'workbench') {
      const input = page
        .getByTestId('original-control-board')
        .getByRole('textbox', { name: '模型名称', exact: true });
      await input.fill('workbench specimen');
      await expect(input).toHaveValue('workbench specimen');
      const toggle = page
        .getByTestId('original-control-board')
        .getByRole('switch', { name: '开机后自己出现在桌面', exact: true });
      await keyboardToggle(toggle);
      await expect(toggle).not.toBeChecked();
    }
    assert.equal(await storedTheme(), before, 'State board wrote theme preferences');
    assert.equal(
      (await models()).revision,
      revision,
      'State board changed real model configuration',
    );
  }
}
async function pickerChecks() {
  await providerOpen();
  const search = page.getByTestId('model-provider-search');
  const field = await search.boundingBox();
  assert.ok(
    field && field.width >= 160 && field.height >= 20,
    family + ' provider search collapsed',
  );
  report.geometry.push({
    label: family + ' readable provider search',
    width: field.width,
    height: field.height,
    pass: true,
  });
  if (family === 'prism') {
    await expect(page.getByTestId('model-provider-dialog')).toHaveJSProperty('open', true);
    await expect(search).toBeFocused();
    await search.press('Shift+Tab');
    await expect(page.getByTestId('model-provider-close')).toBeFocused();
    await page.getByTestId('model-provider-close').press('Tab');
    await expect(search).toBeFocused();
  }
  await search.fill('qa-no-such-family-service');
  await expect(page.getByTestId('model-provider-empty')).toBeVisible();
  await search.fill('DeepSeek');
  await expect(page.getByTestId('model-pick-deepseek')).toBeVisible();
  if (family === 'prism') await capture('prism-native-provider-command-search-1200x800');
  await search.fill('');
  if (family === 'precision') {
    await expect(page.getByTestId('model-provider-select')).toHaveJSProperty('tagName', 'SELECT');
    await expect(page.getByTestId('start-provider').locator('table')).toBeVisible();
  }
  if (family === 'folio')
    await expect(page.getByTestId('fl-index')).toHaveJSProperty('tagName', 'OL');
  if (family === 'hearth')
    await expect(page.getByTestId('model-pick-deepseek')).toHaveAttribute('type', 'radio');
  if (family === 'prism') {
    const before = await search.getAttribute('aria-activedescendant');
    await search.press('ArrowDown');
    assert.notEqual(await search.getAttribute('aria-activedescendant'), before);
    await search.press('Escape');
    await expect(page.getByTestId('model-provider-dialog')).not.toBeVisible();
    await expect(page.getByTestId('model-provider-open')).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(search).toBeFocused();
    await search.press('Escape');
  }
  await selectProvider('qwen');
  await expect(page.getByTestId('model-region')).toBeVisible();
  await page.getByTestId('key-input').fill(fixtureKey);
  await page.getByTestId('model-region').click();
  await expect(page.getByTestId('key-input')).toHaveValue('');
  await selectProvider('chatgpt');
  await expect(page.getByTestId('model-signin')).toBeVisible();
  await expect(page.getByTestId('key-input')).toHaveCount(0);
  await selectProvider('deepseek');
  await expect(page.getByTestId('model-test')).toBeDisabled();
}
async function saveModel() {
  const before = await models();
  assert.equal(before.credentialStorageAvailable, true);
  assert.equal(before.active, null);
  await page.getByTestId('model-input').fill('qa-denied-' + family);
  await page.getByTestId('key-input').fill(fixtureKey);
  await expect(page.getByTestId('model-save')).toBeEnabled();
  await page.getByTestId('model-save').click();
  await denyNetwork();
  await expect(page.getByTestId('model-save')).toHaveText('保存并开始');
  await expect(page.getByTestId('key-input')).toHaveValue('');
  const after = await models();
  assert.ok(after.revision > before.revision);
  const saved = after.endpoints.find((e) => e.id === 'deepseek');
  assert.equal(saved.keyConfigured, true);
  assert.equal(saved.model, 'qa-denied-' + family);
  assert.equal(after.active, null);
  assert.ok(
    after.endpoints
      .filter((endpoint) => endpoint.id !== 'deepseek')
      .every((endpoint) => !endpoint.keyConfigured),
    'Another service falsely reports a configured Key',
  );
  assert.ok(!JSON.stringify(after).includes(fixtureKey));
  assert.equal((await demo()).settings.replyMode, 'demo');
  await expect(page.getByTestId('model-receipt')).toContainText(/没通过|未通过|失败/);
  await expect(page.getByTestId('model-receipt')).toContainText('当前没有在用连接');
  await expect(page.getByTestId('model-test')).toBeDisabled();
  report.families.push({
    id: family,
    providerStructure:
      family === 'precision'
        ? 'native select + table'
        : family === 'hearth'
          ? 'native radio cards'
          : family === 'folio'
            ? 'text index'
            : family === 'prism'
              ? 'native command dialog'
              : 'retained tiles',
    modelRevision: after.revision,
    keyConfigured: true,
    active: false,
    testDisabledWithoutActive: true,
    networkDenied: true,
  });
}
async function previewChecks() {
  await reveal('pet');
  const poke = page.getByTestId('pet-poke');
  await expect(poke).toHaveJSProperty('tagName', 'BUTTON');
  await expect(poke.locator('[data-testid=pet-avatar]')).toHaveCount(1);
  const before = await application(),
    cursor = before.history.at(-1)?.cursor ?? 0;
  await poke.click();
  await expect
    .poll(
      async () =>
        (await application()).history.filter((e) => e.cursor > cursor && e.reaction === 'poke')
          .length,
    )
    .toBe(1);
  const box = await poke.boundingBox();
  const sceneBefore = await page.locator(familyInfo[family].stage).first().boundingBox();
  assert.ok(box && sceneBefore);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 38, box.y + box.height / 2 + 16, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await application()).history.filter((e) => e.cursor > cursor && e.reaction === 'drag')
          .length,
    )
    .toBe(1);
  assert.equal(
    (await application()).history.filter((e) => e.cursor > cursor && e.reaction === 'poke').length,
    1,
    'Drag emitted a duplicate poke',
  );
  const movedBox = await poke.boundingBox();
  const sceneAfter = await page.locator(familyInfo[family].stage).first().boundingBox();
  assert.ok(movedBox && sceneAfter);
  const dragPixels = {
    x: Math.round(movedBox.x - sceneAfter.x - box.x + sceneBefore.x),
    y: Math.round(movedBox.y - sceneAfter.y - box.y + sceneBefore.y),
  };
  assert.ok(
    dragPixels.x >= 24 && dragPixels.x <= 70,
    family + ' avatar did not visibly move with the real drag',
  );
  const composer = page.getByTestId('pet-composer-input');
  if (!(await composer.isVisible())) {
    if (family === 'precision') {
      await page.getByTestId('pet-menu').click();
      await page.getByTestId('pet-chat-toggle').click();
    } else await keyboardToggle(page.getByTestId('pet-chat-toggle'));
  }
  const text = fixturePrompt + '-' + family;
  await composer.fill(text);
  await page.getByTestId('pet-composer-send').click();
  await expect
    .poll(
      async () =>
        (await application()).history.filter((e) => e.cursor > cursor && e.kind === 'user').length,
    )
    .toBe(1);
  await expect
    .poll(
      async () =>
        (await application()).history.filter((e) => e.cursor > cursor && e.kind === 'pet').length,
    )
    .toBe(1);
  const history = (await application()).history.filter((e) => e.cursor > cursor),
    user = history.find((e) => e.kind === 'user'),
    reply = history.find((e) => e.kind === 'pet'),
    delivery = await demo();
  assert.equal(user.text, text);
  assert.equal(reply.mode, 'demo');
  assert.ok(
    delivery.messages.some((m) => m.text === user.text) &&
      delivery.messages.some((m) => m.text === reply.text),
  );
  // The accepted reply may close transient chat when pointer/focus leaves its stage.
  if (!(await composer.isVisible())) {
    assert.ok(['hearth', 'prism', 'workbench'].includes(family), 'Missing persistent composer');
    await keyboardToggle(page.getByTestId('pet-chat-toggle'));
  }
  await expect(composer).toHaveValue('');
  const mic = page.getByTestId('pet-mic-toggle');
  await expect(mic).toBeVisible();
  assert.equal(await mic.isDisabled(), !delivery.canRecord);
  assert.equal(delivery.recordingStartedAt, null);
  const rootMode = await page.locator('html').getAttribute('data-theme');
  const themeBeforeLamp = await storedTheme();
  const profileBeforeLamp = (await application()).profile.revision;
  const stage = page.locator(familyInfo[family].stage).first(),
    light = await stage.getAttribute('data-light');
  await keyboardToggle(page.getByTestId('pet-light-toggle'));
  await expect(stage).toHaveAttribute('data-light', light === 'night' ? 'day' : 'night');
  assert.equal(await page.locator('html').getAttribute('data-theme'), rootMode);
  assert.equal(
    await storedTheme(),
    themeBeforeLamp,
    'Preview lamp changed global theme preferences',
  );
  assert.equal(
    (await application()).profile.revision,
    profileBeforeLamp,
    'Preview lamp wrote native pet preferences',
  );
  await poke.focus();
  await poke.press('Shift+F10');
  const menu =
    family === 'workbench'
      ? page.getByRole('menu', { name: '桌宠预览菜单' })
      : family === 'precision'
        ? page.getByTestId('px-menu-body')
        : family === 'folio'
          ? page.getByTestId('fl-note-card')
          : page.getByTestId('pet-menu-body');
  await expect(menu).toBeVisible();
  if (family === 'precision') {
    const chatAction = page.getByTestId('pet-chat-toggle');
    const before = await chatAction.innerText();
    await chatAction.click();
    await expect(menu).toBeVisible();
    await expect(chatAction).not.toHaveText(before);
  }
  await capture(family + '-native-context-menu-1200x800');
  if (['hearth', 'prism', 'workbench'].includes(family)) {
    assert.equal(await page.getByTestId('pet-menu-mic').isDisabled(), !delivery.canRecord);
    await page.getByTestId('pet-menu-light').click();
    await expect(menu).not.toBeVisible();
    await expect(stage).toHaveAttribute('data-light', light);
    assert.equal(await storedTheme(), themeBeforeLamp);
    await poke.focus();
    await poke.press('Shift+F10');
    await expect(menu).toBeVisible();
  }
  await page.getByTestId('style-family-note').click();
  await expect(menu).not.toBeVisible();
  await keyboardToggle(desktopControl('pet-pause'));
  await expect.poll(async () => (await models()).paused).toBe(true);
  assert.equal((await demo()).canSend, false);
  await keyboardToggle(desktopControl('pet-pause'));
  await expect.poll(async () => (await models()).paused).toBe(false);
  if (family === 'folio') await keyboardToggle(page.getByTestId('pet-visible'));
  else await desktopControl('pet-hide').click();
  await expect.poll(async () => (await nativeWindow('pet')).visible).toBe(false);
  if (family === 'folio') await keyboardToggle(page.getByTestId('pet-visible'));
  else await desktopControl('pet-show').click();
  await expect.poll(async () => (await nativeWindow('pet')).visible).toBe(true);
  await reveal('pet');
  await routeFromPreview('appearance');
  await routeFromPreview('voice');
  await capture(family + '-real-Core-preview-1200x800');
  Object.assign(
    report.families.find((f) => f.id === family),
    {
      history: { poke: 1, drag: 1, user: 1, pet: 1, sharedCore: true },
      dragPixels,
      mic: { canRecord: delivery.canRecord, disabled: !delivery.canRecord, captured: false },
      pauseAndVisibility: true,
      localNightOnly: true,
      keyboardMenu: true,
      realRoutes: ['appearance', 'voice'],
    },
  );
}
async function routeFromPreview(view) {
  const selectedFamily = family;
  const action = view === 'appearance' ? 'dress' : 'voice';
  const actionId = ['hearth', 'prism', 'workbench'].includes(family)
    ? 'pet-menu-' + action
    : 'pet-' + action;
  if (!(await page.getByTestId(actionId).isVisible())) {
    await page.getByTestId('pet-poke').focus();
    await page.getByTestId('pet-poke').press('Shift+F10');
  }
  const pages = (await application()).pages;
  const target = pages.find((page) => page.owner.pluginId === 'pet.page-' + view);
  const start = pages.find((page) => page.owner.pluginId === 'pet.page-start');
  assert.ok(target && start, 'Real route missing');
  await page.getByTestId(actionId).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.title);
  await page
    .getByRole('navigation', { name: '设置页导航', exact: true })
    .getByRole('button', { name: start.title, exact: true })
    .click();
  await expect(page.getByTestId('style-family-gallery')).toBeVisible();
  await pick(selectedFamily);
  await reveal('pet');
}
async function themeChecks() {
  await chooseMode('light');
  await reveal('theme');
  const beforeStored = await storedTheme();
  if (family === 'workbench' && !(await hex('paper').isVisible()))
    await page.locator('details.theme-studio__palette > summary').click();
  const fieldIds = await page
    .locator('input[data-testid]')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => n.dataset.testid)
        .filter(
          (id) =>
            id.startsWith('theme-hex-') || (id.startsWith('theme-token-') && id.endsWith('-hex')),
        ),
    );
  assert.equal(fieldIds.length, 36);
  for (const key of tokenKeys) {
    await expect(hex(key)).toHaveCount(1);
    await expect(picker(key)).toHaveAttribute('type', 'color');
  }
  const original = await hex('paper').inputValue();
  // Distinct bindings must update their own token, not silently target the paper field.
  const editedTokens = {};
  for (const [index, key] of tokenKeys.entries()) {
    const value = '#' + (0x304050 + index * 257).toString(16);
    editedTokens[key] = value;
    await hex(key).fill(value);
  }
  const painted = await page.locator('html').evaluate(
    (node, keys) =>
      Object.fromEntries(
        keys.map((key) => [
          key,
          getComputedStyle(node)
            .getPropertyValue('--' + key)
            .trim()
            .toLowerCase(),
        ]),
      ),
    tokenKeys,
  );
  assert.deepEqual(painted, editedTokens, 'Some theme fields update the wrong real token');
  assert.equal(await storedTheme(), beforeStored, 'Editing 36 tokens persisted a preview');
  await picker('accent').fill('#596A7B');
  await expect(hex('accent')).toHaveValue('#596A7B');
  await page.getByTestId(familyInfo[family].undo).click();
  await expect(hex('paper')).toHaveValue(original.toUpperCase());
  await hex('paper').fill('#GGGGGG');
  await expect(hex('paper')).toHaveAttribute('aria-invalid', 'true');
  assert.equal(await storedTheme(), beforeStored);
  await hex('paper').fill('#234567');
  await expect.poll(globalPaper).toBe('#234567');
  assert.equal(await storedTheme(), beforeStored, 'Preview must not persist');
  await page.getByTestId(familyInfo[family].undo).click();
  await expect(hex('paper')).toHaveValue(original.toUpperCase());
  const name = 'QA ' + family + ' palette';
  await page.getByTestId(familyInfo[family].name).fill(name);
  await page.getByTestId('theme-copy').click();
  let record = await themeRecord();
  const custom = record.custom.find((c) => c.name.startsWith(name));
  assert.ok(custom);
  await chooseScheme(custom.id);
  await hex('paper').fill('#234567');
  await page.getByTestId('theme-save').click();
  await chooseMode('dark');
  await hex('paper').fill('#1A2B3C');
  await page.getByTestId('theme-save').click();
  await chooseMode('light');
  await expect(hex('paper')).toHaveValue('#234567');
  await chooseMode('dark');
  await expect(hex('paper')).toHaveValue('#1A2B3C');
  await hex('paper').fill('#445566');
  await page.getByTestId(familyInfo[family].undo).click();
  await expect.poll(globalPaper).toBe('#1a2b3c');
  await expect(hex('paper')).toHaveValue('#1A2B3C');
  const saved = await storedTheme();
  await hex('paper').fill('#556677');
  const current = family;
  await pick(ids[(ids.indexOf(family) + 1) % ids.length]);
  await expect.poll(globalPaper).toBe('#1a2b3c');
  assert.equal(await storedTheme(), saved, 'Family switch persisted an unsaved palette');
  await pick(current);
  await reveal('theme');
  await chooseScheme(custom.id);
  await expect(hex('paper')).toHaveValue('#1A2B3C');
  await page.getByTestId('theme-copy').click();
  record = await themeRecord();
  const disposable = record.selectedId;
  assert.notEqual(disposable, custom.id);
  await page.getByTestId('theme-delete').click();
  assert.equal((await themeRecord()).selectedId, disposable);
  await page.getByTestId('theme-delete').click();
  await expect
    .poll(async () => (await themeRecord()).custom.some((c) => c.id === disposable))
    .toBe(false);
  await chooseScheme(custom.id);
  report.themes.push({
    family,
    customId: custom.id,
    name: custom.name,
    tokens: 36,
    actualHexEditsReadBack: 36,
    nativePickerAction: true,
    invalidExcluded: true,
    previewOnly: true,
    undo: true,
    variants: { light: '#234567', dark: '#1A2B3C' },
    leaveRolledBack: true,
    doubleDelete: true,
  });
  await capture(family + '-theme-actions-1200x800');
}
async function guideCheck() {
  await pick('folio');
  await reveal('pet');
  await keyboardToggle(page.getByTestId('pet-visible'));
  await expect.poll(async () => (await nativeWindow('pet')).visible).toBe(false);
  const before = (await application()).profile.revision;
  await page.getByTestId('start-guide').click();
  await expect.poll(async () => (await application()).profile.data.visible).toBe(true);
  await expect.poll(async () => (await application()).dialog?.step).toBe('welcome');
  await expect.poll(async () => (await nativeWindow('console')).visible).toBe(false);
  assert.ok((await application()).profile.revision > before);
  await pet.getByTestId('pet-dialog-choice-later').click();
  await pet.getByTestId('pet-settings').click();
  await expect.poll(async () => (await nativeWindow('console')).visible).toBe(true);
  await page.bringToFront();
  report.guide = { realDialog: true, savedVisible: true, settingsHidden: true };
}
async function motionChecks() {
  await resize(880, 600);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
  );
  report.motion = [];
  for (const id of ids) {
    await pick(id);
    await reveal('pet');
    await geometry(id + ' minimum reduced-motion pet');
    const sample = await familyRoot().evaluate((n) =>
      [...n.querySelectorAll('*')]
        .filter((e) => {
          const s = getComputedStyle(e);
          return (
            (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.01) ||
            parseFloat(s.transitionDuration) > 0.01
          );
        })
        .map((n) => ({
          tag: n.tagName,
          class: typeof n.className === 'string' ? n.className : '',
          duration: getComputedStyle(n).animationDuration,
          transition: getComputedStyle(n).transitionDuration,
        }))
        .slice(0, 8),
    );
    report.motion.push({ family: id, longMotion: sample });
    assert.equal(sample.length, 0, id + ' ignores reduced motion');
    await page.getByTestId('style-pick-' + id).focus();
    await page.getByTestId('style-pick-' + id).press('Enter');
    await expect(page.getByTestId('style-pick-' + id)).toBeFocused();
    const actualButton = page.getByTestId('pet-poke');
    await actualButton.scrollIntoViewIfNeeded();
    await actualButton.focus();
    await expect(actualButton).toBeFocused();
    await capture(id + '-minimum-native-focus-reduced-motion-880x600');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await resize(1200, 800);
}
async function restartChecks() {
  const history = (await application()).history.map(({ id, cursor, kind, mode }) => ({
      id,
      cursor,
      kind,
      mode,
    })),
    model = await models(),
    stored = await storedTheme();
  await close();
  await launch();
  assert.equal(await storedTheme(), stored);
  const after = (await application()).history;
  assert.ok(
    history.every((e) =>
      after.some(
        (n) => n.id === e.id && n.cursor === e.cursor && n.kind === e.kind && n.mode === e.mode,
      ),
    ),
  );
  const meta = await models();
  assert.equal(meta.revision, model.revision);
  assert.equal(meta.active, null);
  assert.equal(meta.endpoints.find((e) => e.id === 'deepseek').keyConfigured, true);
  assert.equal((await demo()).settings.replyMode, 'demo');
  for (const entry of report.themes) {
    await pick(entry.family);
    await chooseScheme(entry.customId);
    await chooseMode('dark');
    await expect(hex('paper')).toHaveValue('#1A2B3C');
    await chooseMode('light');
    await expect(hex('paper')).toHaveValue('#234567');
  }
  report.restart = {
    historyEntries: history.length,
    identityRetained: true,
    modelRevision: meta.revision,
    customPalettes: report.themes.length,
    credentialPresentWithoutActivation: true,
  };
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  report.fingerprint = await fingerprint();
  assert.equal(report.fingerprint.git.branch, 'feat/start-style-families');
  await launch();
  await step('five-delivered-real-profile-and-pure-family-switch', async () => {
    await expect(page.getByTestId('style-family-count')).toContainText('5 / 5');
    const stored = await storedTheme(),
      metadata = await models();
    assert.equal(metadata.active, null);
    assert.ok(
      metadata.endpoints.every((e) => !e.keyConfigured),
      'Isolated profile unexpectedly has configured credentials',
    );
    for (const id of ids) {
      await expect(page.getByTestId('style-pick-' + id)).toBeEnabled();
      await pick(id);
      assert.equal(await storedTheme(), stored, 'Review seed wrote preferences');
    }
    assert.equal((await application()).agent.state, 'ready');
  });
  await step('all-five-whole-frames-boards-light-dark-1200-880', visualMatrix);
  await step('five-state-boards-real-local-interactions', boardInteractions);
  await step('model-key-draft-cross-family', async () => {
    await pick('precision');
    await selectProvider('deepseek');
    await page.getByTestId('model-input').fill('cross-family-draft');
    await page.getByTestId('key-input').fill(fixtureKey);
    for (const id of ids) {
      await pick(id);
      await reveal('connect');
      await expect(page.getByTestId('model-input')).toHaveValue('cross-family-draft');
      await expect(page.getByTestId('key-input')).toHaveValue(fixtureKey);
    }
    await page.getByTestId('key-input').fill('');
  });
  for (const id of ids) {
    await step(id + '-picker-and-denied-model-save', async () => {
      await pick(id);
      await pickerChecks();
      await saveModel();
    });
    await step(id + '-real-Core-preview-pause-visibility', previewChecks);
    await step(id + '-36-theme-fields-preview-undo-custom-variants', themeChecks);
  }
  await step('native-guide-from-hidden-pet', guideCheck);
  await step('minimum-focus-reduced-motion', motionChecks);
  await step('restart-history-model-and-five-custom-palettes', restartChecks);
  const after = await fingerprint();
  report.finalFingerprint = { sourceDigest: after.source.digest, buildDigest: after.build.digest };
  assert.equal(
    after.source.digest,
    report.fingerprint.source.digest,
    'Source changed during native run',
  );
  assert.equal(
    after.build.digest,
    report.fingerprint.build.digest,
    'Build changed during native run',
  );
  assert.equal(report.errors.length, 0, 'Renderer errors observed');
  assert.equal(report.remoteOrigins.length, 0, 'Remote renderer request observed');
  assert.ok(
    report.geometry.every((g) => g.pass),
    'Horizontal overflow observed',
  );
  assert.equal((await application()).agent.state, 'ready');
  report.status = 'passed';
}
let timer;
try {
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error('Native family probe exceeded ' + TOTAL_MS + ' ms'));
    }, TOTAL_MS);
  });
  await Promise.race([run(), timeout]);
} catch (error) {
  report.status = 'failed';
  report.failure = redact(error);
  if (activeCheck?.status === 'running')
    Object.assign(activeCheck, { status: 'failed', error: report.failure });
  if (page && !page.isClosed() && !expired) {
    try {
      await capture('failure-' + (activeCheck?.name ?? 'startup'));
      const state = await application(),
        delivery = await demo(),
        meta = await models();
      report.failureState = {
        family,
        agent: state.agent.state,
        error: state.error?.code ?? null,
        dialog: state.dialog?.step ?? null,
        desktop: state.desktop,
        history: state.history.map(({ kind, mode, reaction, cursor }) => ({
          kind,
          mode,
          reaction,
          cursor,
        })),
        model: { active: meta.active?.id ?? null, paused: meta.paused, revision: meta.revision },
        delivery: {
          phase: delivery.phase,
          canRecord: delivery.canRecord,
          canSend: delivery.canSend,
          error: delivery.error?.code ?? null,
        },
      };
    } catch (diagnostic) {
      report.diagnosticError = redact(diagnostic);
    }
  }
} finally {
  clearTimeout(timer);
  try {
    await close();
  } catch (error) {
    report.status = 'failed';
    report.cleanupError = redact(error);
  }
  if (
    report.errors.length ||
    report.remoteOrigins.length ||
    report.shutdown.some((s) => !s.exitConfirmed || s.forced || s.code !== 0 || s.signal !== null)
  )
    report.status = 'failed';
  report.mainLogBytes = mainLogBytes;
  const serialized = JSON.stringify(report);
  assert.ok(
    !serialized.includes(fixtureKey) && !serialized.includes(fixturePrompt),
    'Private fixture leaked into report',
  );
  await fs.mkdir(output, { recursive: true });
  await persist();
  console.log(
    JSON.stringify({
      status: report.status,
      failure: report.failure,
      report: relative(reportPath),
      checks: report.checks.map(({ name, status }) => ({ name, status })),
      screenshots: report.screenshots.length,
      shutdown: report.shutdown,
    }),
  );
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
