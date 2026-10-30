import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

/* global window, document, getComputedStyle, innerWidth, innerHeight, requestAnimationFrame, matchMedia */

// Run serially only after Parent relays the complete source freeze and closes old native jobs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executablePath = path.join(
  path.dirname(require.resolve('electron/package.json')),
  'dist/electron.exe',
);
const site = 'apps/desktop/src/renderer/console/site-ui';
const research = '.trellis/tasks/archive/2026-10/10-30-site-sourced-controls/research';
const boardMilestone = process.argv.includes('--board-milestone');
const fullNormal = process.argv.includes('--frozen') && !boardMilestone;
const visualFollowup = process.argv.includes('--visual-frozen');
const functionalBaselinePath =
  'qa/screenshots/site-sourced-controls/site-1793368428622-2b2027bd/native-report.json';
let sourceSchemeId = '';
const profileId = 'site-' + Date.now() + '-' + randomUUID().slice(0, 8);
const profilePath = path.join(root, '.cache', 'pet-demo-acceptance-' + profileId);
const output = path.join(root, 'qa/screenshots/site-sourced-controls', profileId);
const reportPath = path.join(output, 'native-report.json');
const fixtureKey = 'QA_SITE_KEY_' + randomUUID();
const fixturePrompt = 'QA_SITE_PRIVATE_' + randomUUID();
const TOTAL_MS = 540000;
const sourcePins = [
  [
    'Buttons',
    'afraid-squid-51',
    '11cfdd7d14b5b7c3268f8baa33298dac310ad81916cc129ee50fe3d30691f7f0',
  ],
  [
    'Inputs',
    'polite-stingray-67',
    '02e77dbd3c0a45d5beff3c249fcc066b1914fb10951dca95983643fc48e7401e',
  ],
  [
    'Toggle-switches',
    'empty-penguin-100',
    '4a3cb08d7e4684838d47c56aec476432f54f1715bc9ab09d9256dbdd4731c4c7',
  ],
  [
    'Radio-buttons',
    'stupid-seahorse-9',
    'd0b435d6c672d2aec197fa54810d5cfd944881263fb6acd65f7e0c75a5262a05',
  ],
  ['Forms', 'afraid-cougar-9', '791fda9edbce04a8e5d6a70279db2851340708074ce3af69fe38ce766192a338'],
];
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
const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const redact = (value) =>
  stripVTControlCharacters(String(value?.message ?? value))
    .split(fixtureKey)
    .join('[QA credential]')
    .split(fixturePrompt)
    .join('[QA private text]')
    .replace(/QA_SITE_(KEY|PRIVATE)_[A-Za-z0-9_-]+/g, '[QA private input]')
    .replace(/Bearer\s+\S+/gi, '[credential]')
    .slice(-3000);
const report = {
  status: 'prepared',
  phase: boardMilestone
    ? 'source-board-milestone'
    : visualFollowup
      ? 'normal-source-visual-followup'
      : fullNormal
        ? 'normal-source-full'
        : 'preparation',
  normalStartAdoptionVerified: false,
  sharedSourceShellVerified: false,
  profileId,
  at: new Date().toISOString(),
  checks: [],
  screenshots: [],
  fidelity: [],
  geometry: [],
  identity: [],
  approvals: [],
  themes: [],
  errors: [],
  remoteOrigins: [],
  shutdown: [],
  limitations: [
    'Real unpackaged Electron and actual Core in an isolated profile. Product writes use visible controls; bridge reads provide evidence only.',
    'No fake bridge/IPC, forced click, direct route bypass, media auto-consent, live account, installation or paid model call.',
    'Raw sources are the frozen official Galaxy archive; the website returned Cloudflare 403 in an ordinary browser. No access-control bypass.',
    'Upstream has no dark, disabled, busy or ARIA design. These are labelled adapters/extensions; exact source geometry is compared in default light mode.',
    'Pointer input verifies renderer geometry and real drag receipts, not physical desktop hit testing. Microphone availability is checked without recording.',
    'Renderer request observation is not packet capture. Full normal checks deny the actual model network permission, start/cancel auth without entering an account, and never record audio or call a paid provider.',
  ],
};
let app,
  page,
  pet,
  activeCheck,
  closing,
  expired = false,
  mainLogBytes = 0;
const checkActive = () => assert.equal(expired, false, 'Native probe exceeded its deadline');
const unwrap = (result, label) => {
  assert.ok(result?.ok, label + ': ' + (result?.error?.code ?? 'missing result'));
  return result.value;
};
const application = async () =>
  unwrap(await pet.evaluate(() => window.petApplication.getSnapshot()), 'Application');
const demo = async () => unwrap(await pet.evaluate(() => window.petDemo.getSnapshot()), 'Demo');
const models = async () =>
  unwrap(await page.evaluate(() => window.petModels.getSnapshot()), 'Models');
const security = async () =>
  unwrap(await page.evaluate(() => window.petConsole.getSecurity()), 'Permissions');
const storedTheme = () => page.evaluate(() => localStorage.getItem('pet.console.theme'));
const themeRecord = async () => JSON.parse(await storedTheme());
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
  if (pet) {
    const state = await application();
    assert.equal(state.agent.state, 'ready');
    assert.equal(state.error?.code ?? null, null);
  }
  Object.assign(activeCheck, { status: 'passed', elapsedMs: Date.now() - at });
  await persist();
  console.log(
    JSON.stringify({ event: 'check', name, status: 'passed', report: relative(reportPath) }),
  );
}
async function filesUnder(directory) {
  const rows = [];
  for (const item of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    if (['node_modules', '.cache', '.git'].includes(item.name)) continue;
    const file = directory + '/' + item.name;
    if (item.isDirectory()) rows.push(...(await filesUnder(file)));
    else if (item.isFile()) rows.push(file);
  }
  return rows.sort();
}
async function digestFiles(files) {
  const rows = [];
  for (const file of [...new Set(files)].sort()) {
    const bytes = await fs.readFile(path.join(root, file));
    rows.push({ path: file, bytes: bytes.length, sha256: hash(bytes) });
  }
  return { digest: hash(JSON.stringify(rows)), files: rows };
}
async function fingerprint() {
  const source = [
    ...(await filesUnder('apps/desktop/src')),
    ...(await filesUnder('packages')),
    ...(await filesUnder('plugins')),
  ].filter((file) => !file.includes('/dist/'));
  source.push(
    'package.json',
    'pnpm-lock.yaml',
    'apps/desktop/build.mjs',
    'qa/probes/site-sourced-controls-e2e.mjs',
  );
  const built = [
    ...(await filesUnder('apps/desktop/dist')),
    ...(await filesUnder('plugins')),
  ].filter(
    (file) =>
      file.startsWith('apps/desktop/dist/') ||
      file.includes('/dist/') ||
      file.endsWith('/plugin.json'),
  );
  built.push('apps/desktop/src/main/builtin-admission.json');
  return {
    source: await digestFiles(source),
    build: await digestFiles(built),
    git: {
      branch: execFileSync('git', ['branch', '--show-current'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    },
  };
}
async function sourceAudit() {
  const rows = [];
  for (const [category, slug, sha256] of sourcePins) {
    const name = category + '/andrew-demchenk0_' + slug + '.html';
    const upstream = await fs.readFile(path.join(root, research, 'upstream/raw', name));
    const vendor = await fs.readFile(path.join(root, site, 'upstream', name));
    assert.equal(hash(upstream), sha256, slug + ' upstream pin');
    assert.equal(hash(vendor), sha256, slug + ' runtime bytes');
    const notice = await fs.readFile(
      path.join(root, site, 'upstream/notices', slug + '.md'),
      'utf8',
    );
    assert.match(notice, /andrew-demchenk0/);
    assert.match(notice, /MIT/);
    assert.match(notice, new RegExp(slug));
    rows.push({ slug, sha256, vendorBytes: vendor.length, byteExact: true, notice: true });
  }
  const originalLicense = await fs.readFile(
    path.join(root, research, 'upstream/galaxy/LICENSE.md'),
  );
  assert.equal(
    hash(await fs.readFile(path.join(root, site, 'upstream/LICENSE.md'))),
    hash(originalLicense),
  );
  const iconManifest = JSON.parse(
    await fs.readFile(path.join(root, research, 'morphicons/manifest.json'), 'utf8'),
  );
  assert.equal(iconManifest.morphiconsVersion, '2.0.2');
  assert.equal(iconManifest.icons.length, 17);
  for (const icon of iconManifest.icons) {
    const bytes = await fs.readFile(path.join(root, site, 'assets/icons', icon.name + '.svg'));
    assert.equal(hash(bytes), icon.sha256);
    assert.equal(bytes.length, icon.bytes);
  }
  for (const file of [
    'MORPHICONS-LICENSE.txt',
    'TABLER-LICENSE.txt',
    'tabler-icon-data.json',
    'tabler-revision.json',
  ]) {
    assert.equal(
      hash(await fs.readFile(path.join(root, site, 'assets', file))),
      hash(await fs.readFile(path.join(root, research, 'morphicons', file))),
    );
  }
  const badImports = [];
  for (const file of (await filesUnder(site)).filter((f) => /\.(tsx?|css)$/.test(f))) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    if (/(?:from|import|url\()\s*['"][^'"]*\.trellis[\\/]/.test(text)) badImports.push(file);
  }
  assert.deepEqual(badImports, [], 'Runtime imports task research');
  if (fullNormal || visualFollowup) {
    const mapping = JSON.parse(
      await fs.readFile(path.join(root, site, 'source-manifest.json'), 'utf8'),
    );
    const mapped = [];
    for (const [, slug] of sourcePins) {
      const item = mapping.controls.items.find((entry) => entry.slug === slug);
      assert.ok(item?.adapter?.reactFile, slug + ' source mapping omits the implemented adapter');
      assert.ok(
        item.adapter.cssSelectors.length > 0,
        slug + ' source mapping has no actual selectors',
      );
      assert.doesNotMatch(item.adapter.status, /not yet|not adopted/i);
      const adapter = await fs.readFile(path.join(root, site, item.adapter.reactFile), 'utf8');
      assert.ok(adapter.length > 0);
      mapped.push({ slug, actualAdapter: item.adapter.reactFile, adapterSha256: hash(adapter) });
    }
    report.declaredSourceMapping = mapped;
  }
  report.sourceAudit = {
    revision: 'adbd2adde0a299a3956ea288fb444ec01891ca41',
    controls: rows,
    completeMitPreserved: true,
    icons: 17,
    iconVersion: '2.0.2',
    noResearchRuntimeImports: true,
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
      if (!w) throw new Error('Missing settings window');
      w.setContentSize(size.width, size.height);
      w.webContents.setZoomFactor(1);
    },
    { width, height },
  );
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  assert.equal((await nativeWindow('console')).zoom, 1);
}
async function launch(lab = boardMilestone) {
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
  const args = [
    '--no-sandbox',
    path.join(root, 'apps/desktop'),
    '--demo-acceptance=' + profileId,
    ...(lab ? ['--start-design-lab'] : []),
    '--show-settings',
  ];
  app = await _electron.launch({
    executablePath,
    args,
    env,
    timeout: 30000,
  });
  closing = undefined;
  const child = app.process();
  const shutdown = {
    pid: child.pid,
    exitConfirmed: false,
    code: null,
    signal: null,
    forced: false,
  };
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
    target.on('pageerror', (e) => report.errors.push(redact(e)));
    target.on('console', (m) => {
      if (m.type() === 'error') report.errors.push(redact(m.text()));
    });
    target.on('request', (r) => {
      if (/^https?:/.test(r.url())) report.remoteOrigins.push(new URL(r.url()).origin);
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
  assert.ok(pet);
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
  report.identity.push({
    ...identity,
    userData: relative(identity.userData),
    args,
    normalStart: !lab,
    labMilestone: lab,
  });
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
async function capture(label, target = page) {
  checkActive();
  const mask = [];
  for (const input of await target.locator('input').all()) {
    if (!(await input.isVisible())) continue;
    const value = await input.inputValue();
    if (value.includes('QA_SITE_')) mask.push(input);
  }
  for (const n of await target.getByText(/QA_SITE_/).all()) if (await n.isVisible()) mask.push(n);
  const file = path.join(output, label + '.png');
  await target.screenshot({ path: file, mask, maskColor: '#858b91' });
  report.screenshots.push({
    label,
    path: relative(file),
    ...(await target.evaluate(() => ({ width: innerWidth, height: innerHeight }))),
    privateMasks: mask.length,
  });
  await persist();
}
async function settle() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
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
    assert.ok(Date.now() < deadline, 'Actual network approval did not arrive');
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
      report.approvals.push({ kind: permission.kind, approved: true });
      await expect
        .poll(async () => (await security()).pending.some((n) => n.requestId === prompt.requestId))
        .toBe(false);
    } else {
      assert.equal(permission.kind, 'network');
      assert.deepEqual(permission.origins, ['https://api.deepseek.com']);
      await pet.getByTestId('pet-dialog-choice-deny').click();
      report.approvals.push({ kind: 'network', approved: false });
      denied = true;
    }
  }
  await expect.poll(async () => (await security()).pending.length).toBe(0);
  await page.bringToFront();
}
async function style(locator, pseudo = null) {
  return locator.evaluate((node, pseudo) => {
    const s = getComputedStyle(node, pseudo),
      box = node.getBoundingClientRect();
    const names = [
      'borderTopWidth',
      'borderTopStyle',
      'borderTopColor',
      'borderRadius',
      'boxShadow',
      'backgroundColor',
      'color',
      'transform',
      'fontSize',
      'fontWeight',
      'padding',
      'boxSizing',
      'width',
      'height',
      'content',
      'outlineColor',
      'outlineWidth',
      'outlineStyle',
      'transitionDuration',
    ];
    return {
      ...Object.fromEntries(names.map((name) => [name, s[name]])),
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  }, pseudo);
}
function parity(label, raw, adapter, properties) {
  const comparisons = properties.map((property) => ({
    property,
    raw: raw[property],
    adapter: adapter[property],
    equal: raw[property] === adapter[property],
  }));
  report.fidelity.push({ label, raw, adapter, comparisons });
  assert.ok(
    comparisons.every((c) => c.equal),
    label +
      ': ' +
      comparisons
        .filter((c) => !c.equal)
        .map((c) => c.property)
        .join(', '),
  );
}

const coreProperties = [
  'borderTopWidth',
  'borderTopStyle',
  'borderTopColor',
  'borderRadius',
  'boxShadow',
  'backgroundColor',
  'color',
  'fontSize',
  'fontWeight',
];
async function pressStyle(locator, screenshot) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    const value = await style(locator);
    if (screenshot) await capture(screenshot);
    return value;
  } finally {
    await page.mouse.up();
  }
}
async function rawRendering() {
  report.rawRendering = [];
  for (const [category, slug, sha256] of sourcePins) {
    const source = await fs.readFile(
      path.join(root, site, 'upstream', category, 'andrew-demchenk0_' + slug + '.html'),
      'utf8',
    );
    const host = page.getByTestId('raw-' + slug);
    await expect(host).toBeVisible();
    const observed = await host.evaluate((node, source) => {
      if (!node.shadowRoot) throw new Error('Raw source has no rendered shadow boundary');
      // Detached parsing canonicalizes browser HTML serialization, without modifying the actual raw sample.
      const template = document.createElement('template');
      template.innerHTML = source;
      return {
        equalMarkup: node.shadowRoot.innerHTML === template.innerHTML,
        styles: [...node.shadowRoot.querySelectorAll('style')].map((n) => n.textContent),
        elements: node.shadowRoot.querySelectorAll('*').length,
      };
    }, source);
    assert.equal(observed.equalMarkup, true, slug + ' altered rendered source');
    assert.ok(observed.elements > 1);
    report.rawRendering.push({
      slug,
      sha256,
      browserCanonicalMarkupEqual: true,
      styleSha256: hash(observed.styles.join('')),
      elements: observed.elements,
      isolation: 'open shadow root (current CSP forbids frames)',
    });
  }
}
async function rawTrustedUrlCheck() {
  const trustedUrl = page.url();
  const form = page.getByTestId('raw-afraid-cougar-9');
  await form.locator('button').first().click();
  await settle();
  assert.equal(page.url(), trustedUrl, 'Raw form submit navigated the trusted settings window');
  const link = page.getByTestId('raw-afraid-squid-51').locator('..').getByRole('link');
  await expect(link).toHaveAttribute('target', '_blank');
  assert.equal((await models()).active, null);
  report.trustedUrl = {
    rawFormSubmitStayed: true,
    sourceLinksDeclareBlankTarget: true,
    exact: trustedUrl,
  };
}
async function compareButton(raw, adapter) {
  const restRaw = await style(raw),
    restAdapter = await style(adapter);
  parity('button/rest', restRaw, restAdapter, coreProperties);
  assert.equal(restRaw.borderRadius, '5px');
  assert.equal(restRaw.borderTopWidth, '2px');
  assert.equal(restRaw.boxShadow, 'rgb(50, 50, 50) 4px 4px 0px 0px');
  const pressedRaw = await pressStyle(raw, '02-button-raw-pointer-pressed'),
    pressedAdapter = await pressStyle(adapter, '03-button-adapter-pointer-pressed');
  parity('button/pointer-pressed', pressedRaw, pressedAdapter, [...coreProperties, 'transform']);
  assert.equal(pressedRaw.transform, 'matrix(1, 0, 0, 1, 3, 3)');
  assert.equal(pressedRaw.boxShadow, 'rgb(50, 50, 50) 0px 0px 0px 0px');
  await adapter.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(adapter).toBeFocused();
  const keyboardFocus = await style(adapter);
  assert.equal(keyboardFocus.outlineWidth, '2px');
  assert.equal(keyboardFocus.outlineColor, 'rgb(45, 140, 240)');
  report.adapterKeyboardFocus = {
    outlineWidth: keyboardFocus.outlineWidth,
    outlineColor: keyboardFocus.outlineColor,
  };
  report.controlAdaptations = [
    {
      role: 'button',
      raw: { width: restRaw.width, height: restRaw.height },
      adapter: { width: restAdapter.width, height: restAdapter.height },
      changes: [
        'Chinese label and intrinsic width/padding',
        'native disabled/busy and keyboard focus extension',
      ],
    },
  ];
}
async function compareInput(raw, adapter) {
  await adapter.fill('');
  await raw.focus();
  const focusRaw = await style(raw);
  await page
    .getByTestId('source-pair-polite-stingray-67')
    .evaluate((n) => n.scrollIntoView({ block: 'start' }));
  await capture('04-input-raw-password-empty-focus');
  await adapter.focus();
  const focusAdapter = await style(adapter);
  await page
    .getByTestId('source-pair-polite-stingray-67')
    .evaluate((n) => n.scrollIntoView({ block: 'start' }));
  await capture('05-input-adapter-text-empty-focus');
  parity('input/focus', focusRaw, focusAdapter, coreProperties);
  assert.equal(focusRaw.borderTopColor, 'rgb(45, 140, 240)');
  await page.getByRole('heading', { level: 1 }).click();
  const restRaw = await style(raw),
    restAdapter = await style(adapter);
  parity('input/rest', restRaw, restAdapter, [...coreProperties, 'padding']);
  const placeholderRaw = await style(raw, '::placeholder'),
    placeholderAdapter = await style(adapter, '::placeholder');
  parity('input/placeholder', placeholderRaw, placeholderAdapter, ['color']);
  report.inputSemantics = {
    rawType: await raw.evaluate((n) => n.type),
    adapterType: await adapter.evaluate((n) => n.type),
    comparedState: 'both empty; sequential focus/rest',
    typeDifference: 'Application-purpose adaptation; not semantic equivalence.',
  };
  report.controlAdaptations.push({
    role: 'input',
    raw: {
      width: restRaw.width,
      height: restRaw.height,
      boxSizing: restRaw.boxSizing,
      outerWidth: restRaw.box.width,
      outerHeight: restRaw.box.height,
    },
    adapter: {
      width: restAdapter.width,
      height: restAdapter.height,
      boxSizing: restAdapter.boxSizing,
      outerWidth: restAdapter.box.width,
      outerHeight: restAdapter.box.height,
    },
    changes: [
      'Responsive width and Chinese label',
      'Native label/describedBy, invalid and disabled extension',
    ],
  });
}
async function compareSwitch(rawHost, adapterHost) {
  const rawInput = rawHost.locator('input[type=checkbox]'),
    adapterInput = adapterHost.locator('input[type=checkbox]');
  for (const checked of [true, false]) {
    if ((await rawInput.isChecked()) !== checked) await rawHost.locator('label').click();
    if ((await adapterInput.isChecked()) !== checked) await adapterHost.click();
    await expect(rawInput).toBeChecked({ checked });
    await expect(adapterInput).toBeChecked({ checked });
    const rawTrack = rawHost.locator('.slider'),
      adapterTrack = adapterHost.locator('.su-slider');
    const expectedTrack = checked ? 'matrix(1, 0, 0, 1, -32, 0)' : 'none';
    const expectedKnob = checked ? 'matrix(1, 0, 0, 1, 32, 0)' : 'none';
    await expect.poll(async () => (await style(rawTrack)).transform).toBe(expectedTrack);
    await expect.poll(async () => (await style(adapterTrack)).transform).toBe(expectedTrack);
    const trackRaw = await style(rawTrack),
      trackAdapter = await style(adapterTrack);
    parity('switch/' + (checked ? 'checked' : 'unchecked') + '/track', trackRaw, trackAdapter, [
      ...coreProperties.filter((p) => !['color', 'fontSize', 'fontWeight'].includes(p)),
      'transform',
      'width',
      'height',
    ]);
    const knobRaw = await style(rawTrack, '::before'),
      knobAdapter = await style(adapterTrack, '::before');
    parity('switch/' + (checked ? 'checked' : 'unchecked') + '/knob', knobRaw, knobAdapter, [
      ...coreProperties,
      'transform',
      'width',
      'height',
    ]);
    assert.equal(trackRaw.borderRadius, '100px');
    assert.equal(knobRaw.width, '30px');
    assert.equal(knobRaw.height, '30px');
    assert.equal(knobRaw.transform, expectedKnob);
    await adapterHost.scrollIntoViewIfNeeded();
    await capture(
      checked ? '06-switch-both-checked-track-knob' : '07-switch-both-unchecked-track-knob',
    );
    report.controlAdaptations.push({
      role: 'switch',
      state: checked ? 'on' : 'off',
      rawKnobText: knobRaw.content,
      adapterKnobText: knobAdapter.content,
      labelledChanges: [
        'Chinese knob text',
        'native label/description and focus/disabled extension',
      ],
    });
  }
  await keyboardToggle(adapterInput);
  await expect(adapterInput).toBeChecked();
}

async function glyphMorph(toggle, from, to, reduced) {
  const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
  const { canonicalD } = await import(pathToFileURL(desktopRequire.resolve('morphicons/dom')).href);
  const glyphs = JSON.parse(
    await fs.readFile(path.join(root, research, 'morphicons/tabler-icon-data.json'), 'utf8'),
  );
  const expectedFrom = canonicalD(glyphs[from]),
    expectedTo = canonicalD(glyphs[to]);
  const svg = toggle.locator('svg'),
    node = svg.locator('path');
  await expect(svg).toHaveAttribute('stroke-width', '2');
  await expect.poll(() => node.getAttribute('d')).toBe(expectedFrom);
  const identity = await svg.elementHandle();
  const observation = node.evaluate(
    (n) =>
      new Promise((resolve) => {
        const samples = [];
        const tick = () => {
          samples.push(n.getAttribute('d'));
          if (samples.length === 48) resolve(samples);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await toggle.click();
  const samples = await observation;
  await expect.poll(() => node.getAttribute('d')).toBe(expectedTo);
  assert.equal(
    await svg.evaluate((n, previous) => n === previous, identity),
    true,
    'Morph replaced its SVG instead of changing its actual path',
  );
  await identity.dispose();
  const intermediate = samples.filter((d) => d !== expectedFrom && d !== expectedTo);
  if (reduced) assert.equal(intermediate.length, 0, 'Reduced motion interpolated icon geometry');
  else
    assert.ok(intermediate.length > 0, 'Normal motion never rendered intermediate icon geometry');
  report.glyphs ??= [];
  report.glyphs.push({
    from,
    to,
    reduced,
    sameSvg: true,
    frames: samples.length,
    distinct: new Set(samples).size,
    intermediateFrames: intermediate.length,
    endpointSha256: hash(expectedTo),
    actualUpstreamGlyph: true,
  });
}

async function milestoneBoardStates() {
  const board = page.getByTestId('site-source-board');
  await expect(page.getByTestId('source-adapted-input')).toHaveAccessibleName('模型名');
  await expect(page.getByTestId('source-adapted-input')).toHaveAccessibleDescription(
    '可以直接打，也可以从这家列出的名字里挑。',
  );
  const pause = page.getByTestId('source-adapted-switch');
  await expect(pause).toHaveAttribute('type', 'checkbox');
  await expect(pause).toHaveAccessibleName('暂时不回应');
  await expect(pause).toHaveAccessibleDescription('只是让它先不开口，录音与预览还在这里。');
  await expect(board.getByRole('checkbox', { name: '跟随日落换夜相', exact: true })).toBeDisabled();
  await expect(board.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled();
  await expect(board.getByRole('textbox', { name: '读不到的配置', exact: true })).toBeDisabled();
  const invalid = board.getByLabel('这家服务的 API Key', { exact: true });
  await expect(invalid).toHaveAttribute('aria-invalid', 'true');
  await expect(invalid).toHaveAccessibleDescription(/Key|密钥/);
  await expect(invalid).not.toHaveAccessibleDescription(/模型名/);
  await board.getByRole('button', { name: '点一下看等待', exact: true }).click();
  const busy = board.getByRole('button', { name: '正在写入这台机器…', exact: true });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  const busyStyle = await style(busy);
  assert.equal(busyStyle.boxShadow, 'rgb(50, 50, 50) 0px 0px 0px 0px');
  assert.equal(busyStyle.transform, 'matrix(1, 0, 0, 1, 3, 3)');
  await expect(board.getByRole('button', { name: '点一下看等待', exact: true })).toBeEnabled();
  report.boardStates = {
    nativeLabelsAndDescriptions: true,
    disabled: true,
    invalid: true,
    busy: true,
    localDemonstrationOnly: true,
  };
}
async function actualGlyphInventory() {
  const desktopRequire = createRequire(path.join(root, 'apps/desktop/package.json'));
  const { canonicalD } = await import(pathToFileURL(desktopRequire.resolve('morphicons/dom')).href);
  const glyphs = JSON.parse(
    await fs.readFile(path.join(root, research, 'morphicons/tabler-icon-data.json'), 'utf8'),
  );
  const inventory = page.getByTestId('source-glyphs-all');
  await expect(inventory.getByRole('img')).toHaveCount(17);
  report.renderedGlyphs = [];
  for (const [name, nodes] of Object.entries(glyphs)) {
    const icon = inventory.getByRole('img', { name, exact: true });
    await expect(icon).toHaveAttribute('stroke-width', '2');
    const actual = await icon.locator('path').getAttribute('d'),
      expected = canonicalD(nodes);
    assert.equal(actual, expected, name + ' rendered a different glyph');
    report.renderedGlyphs.push({ name, canonicalPathSha256: hash(expected), matches: true });
  }
  await inventory.scrollIntoViewIfNeeded();
  await capture('09-seventeen-real-tabler-glyphs');
}
async function milestoneReducedMotion() {
  await resize(880, 600);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
  );
  await glyphMorph(page.getByTestId('source-glyph-demo'), 'eye-off', 'eye', true);
  const track = page.getByTestId('source-adapted-switch').locator('..').locator('.su-slider');
  const trackStyle = await style(track),
    knobStyle = await style(track, '::before');
  assert.equal(trackStyle.transitionDuration, '0s');
  assert.equal(knobStyle.transitionDuration, '0s');
  const width = await page.getByTestId('site-source-board').evaluate((n) => ({
    client: n.clientWidth,
    scroll: n.scrollWidth,
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
  }));
  report.geometry.push({
    label: 'source-board 880x600 reduced-motion',
    ...width,
    pass: width.scroll <= width.client + 1 && width.documentScroll <= width.documentClient + 1,
  });
  await page.getByTestId('source-glyph-demo').scrollIntoViewIfNeeded();
  await capture('10-minimum-source-glyph-reduced-motion');
  report.reducedMotion = {
    actualGlyphSnapsToEndpoint: true,
    sourceSwitchTransitionRemoved: true,
    rawSourceUnchanged: true,
  };
}
// Final normal scope: one product basis, one owner, visible writes only.
const hexField = (key) => page.getByTestId('theme-token-' + key + '-hex');
const pickerField = (key) => page.getByTestId('theme-token-' + key + '-picker');
const canonicalHex = (hex) => {
  const raw = hex.trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(raw)
    ? '#' +
        raw
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
    : raw;
};
const rgb = (hex) => {
  const value = canonicalHex(hex).replace('#', '');
  return 'rgb(' + [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)).join(', ') + ')';
};
const signInState = async () =>
  unwrap(await page.evaluate(() => window.petModels.getSignInState()), 'Sign in state');
async function reveal(part) {
  await page
    .getByTestId(
      {
        connect: 'start-connect-form',
        provider: 'start-provider',
        pet: 'start-pet',
        theme: 'theme-studio',
      }[part],
    )
    .scrollIntoViewIfNeeded();
}
async function chooseMode(mode) {
  await reveal('theme');
  await page.getByTestId('theme-mode-' + mode).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
}
async function chooseScheme(id) {
  await reveal('theme');
  await page.getByTestId('theme-scheme-' + id).click();
  await expect.poll(async () => (await themeRecord()).selectedId).toBe(id);
}
async function editorPalette() {
  const values = {};
  for (const key of tokenKeys) values[key] = canonicalHex(await hexField(key).inputValue());
  return values;
}
async function paintedPalette() {
  return page
    .locator('html')
    .evaluate(
      (n, keys) =>
        Object.fromEntries(
          keys.map((key) => [
            key,
            getComputedStyle(n)
              .getPropertyValue('--' + key)
              .trim()
              .toLowerCase(),
          ]),
        ),
      tokenKeys,
    )
    .then((palette) =>
      Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, canonicalHex(value)])),
    );
}
async function assertEffectivePalette(expected, label) {
  await expect.poll(paintedPalette).toEqual(expected);
  const actualEditor = await editorPalette();
  assert.deepEqual(actualEditor, expected, label + ': editor and effective palette differ');
  // Inspect the current controls themselves, including surfaces in components still named Original*.
  await page.getByRole('heading', { level: 1 }).click();
  const field = await style(page.getByTestId('model-input'));
  assert.equal(field.backgroundColor, rgb(expected.sheet), label + ': model field ignores sheet');
  assert.equal(
    field.borderTopColor,
    rgb(expected['line-strong']),
    label + ': model field ignores line-strong',
  );
  assert.equal(field.color, rgb(expected.ink), label + ': model field ignores ink');
  const shell = await style(page.getByTestId('settings-shell'));
  assert.equal(shell.backgroundColor, rgb(expected.sheet), label + ': shared shell ignores sheet');
  const hex = await style(hexField('sheet'));
  assert.equal(
    hex.backgroundColor,
    rgb(expected.sheet),
    label + ': theme hex uses a separate palette',
  );
  await expect(pickerField('sheet')).toHaveValue(expected.sheet);
  report.themes.push({
    label,
    editorMatchesAllTokens: 36,
    controlBackground: field.backgroundColor,
    controlBorder: field.borderTopColor,
    shellBackground: shell.backgroundColor,
    sheetPicker: expected.sheet,
  });
}
async function assertSourceMaterial(locator, label) {
  const material = await style(locator);
  assert.equal(material.borderTopWidth, '2px', label + ' outline');
  assert.equal(material.borderRadius, '5px', label + ' radius');
  assert.equal(material.boxShadow, 'rgb(50, 50, 50) 4px 4px 0px 0px', label + ' hard shadow');
  return material;
}
async function normalStartup() {
  await launch(false);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await expect(page.getByTestId('settings-shell')).toBeVisible();
  await expect(page.getByTestId('style-family-gallery')).toHaveCount(0);
  await expect(page.getByTestId('start-design-lab')).toHaveCount(0);
  await expect(page.getByTestId('site-source-open')).toHaveCount(0);
  await expect(page.getByTestId('model-input')).toBeVisible();
  await page.getByTestId('settings-main').evaluate((n) => {
    n.scrollTop = 0;
  });
  await capture('normal-first-1200-startup');
  console.log(
    JSON.stringify({
      event: 'normal-first-frame-ready',
      report: relative(reportPath),
      frame: relative(path.join(output, 'normal-first-1200-startup.png')),
    }),
  );
  await reveal('theme');
  const selected = page.locator('.theme-studio__schemes [data-selected=true]');
  await expect(selected).toHaveCount(1);
  sourceSchemeId = (await selected.getAttribute('data-testid')).slice('theme-scheme-'.length);
  const initial = await editorPalette();
  await assertEffectivePalette(initial, 'startup before user edits');
  await chooseMode('light');
  const light = await editorPalette();
  assert.equal(light.sheet, '#ffffff');
  assert.equal(light.ink, '#323232');
  assert.equal(light['line-strong'], '#323232');
  assert.equal(light.accent, '#2d8cf0');
  await assertEffectivePalette(light, 'default source light');
  report.normalSourceRoles = {};
  for (const id of ['model-input', 'key-input', 'model-save']) {
    await expect(page.getByTestId(id)).toHaveClass(/su-(input|button)/);
    report.normalSourceRoles[id] = await assertSourceMaterial(page.getByTestId(id), id);
  }
  const panel = page.locator('.su-panel').first();
  report.normalSourceRoles.panel = await assertSourceMaterial(panel, 'normal panel');
  report.normalSourceRoles.choice = await style(
    page.getByTestId('theme-select').locator('.su-choice'),
  );
  report.normalSourceRoles.choiceSelected = await style(
    page.getByTestId('theme-select').locator('.su-choice__input:checked + .su-choice__btn'),
  );
  assert.equal(report.normalSourceRoles.choice.borderRadius, '34px');
  assert.equal(report.normalSourceRoles.choiceSelected.borderRadius, '50px');
  await reveal('pet');
  if (!(await page.getByTestId('pet-composer-input').isVisible()))
    await keyboardToggle(page.getByTestId('pet-chat-toggle'));
  await expect(page.getByTestId('pet-composer-input')).toBeVisible();
  report.normalSourceRoles.composer = await assertSourceMaterial(
    page.getByTestId('pet-composer-input'),
    'preview composer',
  );
  report.normalSourceRoles.hex = await assertSourceMaterial(hexField('sheet'), 'theme hex');
  await expect(pickerField('sheet')).toHaveAttribute('type', 'color');
  const current = await application();
  assert.equal(current.agent.owner.pluginId, 'pet.agent-cortico');
  const meta = await models();
  assert.equal(meta.active, null);
  assert.ok(meta.endpoints.every((e) => !e.keyConfigured));
  report.normalStartup = {
    noLabFlag: true,
    sourceSchemeId,
    editorAndCurrentControlsAgree: true,
    defaultLight: light,
    agentOwner: current.agent.owner,
  };
  report.normalStartAdoptionVerified = true;
  report.sharedSourceShellVerified = true;
}
async function assertSourceVisualFit(label) {
  const rail = await page.getByTestId('settings-sidebar').evaluate((n) => {
    const boundary = n.getBoundingClientRect();
    const controls = [
      ...n.querySelectorAll('[data-testid=model-pause], .su-choice, .su-choice__btn'),
    ].map((control) => {
      const box = control.getBoundingClientRect(),
        css = getComputedStyle(control);
      const shadowRight = css.boxShadow === 'none' ? 0 : 4;
      return {
        class: control.className,
        testid: control.dataset.testid ?? null,
        left: box.left,
        right: box.right,
        width: box.width,
        shadowRight,
        fits: box.left >= boundary.left - 1 && box.right + shadowRight <= boundary.right + 1,
      };
    });
    const visibleCaptions = [
      ...n.querySelectorAll('.pb-modes__label, [data-testid=theme-select] legend'),
    ]
      .filter((caption) => {
        const css = getComputedStyle(caption),
          box = caption.getBoundingClientRect();
        return (
          css.display !== 'none' &&
          css.visibility !== 'hidden' &&
          box.width > 1 &&
          box.height > 1 &&
          css.clipPath === 'none'
        );
      })
      .map((caption) => caption.textContent.trim());
    return {
      left: boundary.left,
      right: boundary.right,
      width: boundary.width,
      controls,
      visibleCaptions,
    };
  });
  const selectedTiles = await page.locator('.su-tile[data-selected=true]').evaluateAll((tiles) =>
    tiles.map((tile) => {
      const title = tile.querySelector('.su-tile__name'),
        note = tile.querySelector('.su-tile__note');
      return {
        title: title?.textContent ?? '',
        titleColor: title ? getComputedStyle(title).color : null,
        noteColor: note ? getComputedStyle(note).color : null,
        note: note?.textContent ?? null,
      };
    }),
  );
  const pass =
    rail.controls.every((n) => n.fits) &&
    rail.visibleCaptions.length === 1 &&
    selectedTiles.every((n) => n.noteColor === null || n.noteColor === n.titleColor);
  report.geometry.push({ label, rail, selectedTiles, pass });
  assert.ok(
    rail.controls.every((n) => n.fits),
    label + ': sidebar clips a source control or its hard shadow',
  );
  assert.equal(rail.visibleCaptions.length, 1, label + ': duplicated theme caption/legend');
  assert.ok(
    selectedTiles.every((n) => n.noteColor === null || n.noteColor === n.titleColor),
    label + ': selected tile note ignores the source inverted text color',
  );
}
async function normalFrames() {
  for (const [width, height] of [
    [1200, 800],
    [880, 600],
  ]) {
    await resize(width, height);
    for (const mode of ['light', 'dark']) {
      await chooseMode(mode);
      await reveal('connect');
      await page.getByTestId('settings-main').evaluate((n) => {
        n.scrollTop = 0;
      });
      await capture('normal-' + mode + '-start-' + width);
      await assertSourceVisualFit('expanded source sidebar ' + mode + ' ' + width);
      await reveal('pet');
      await capture('normal-' + mode + '-preview-' + width);
      await reveal('theme');
      await capture('normal-' + mode + '-theme-' + width);
      const rows = await page
        .locator('html,body,[data-testid=settings-shell],[data-testid=settings-main]')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            tag: n.tagName,
            testid: n.dataset.testid ?? null,
            client: n.clientWidth,
            scroll: n.scrollWidth,
          })),
        );
      const pass = rows.every((n) => n.scroll <= n.client + 1);
      report.geometry.push({ label: 'normal ' + mode + ' ' + width, rows, pass });
      assert.equal(pass, true, 'Normal source frame horizontal overflow');
    }
  }
  await resize(1200, 800);
  await chooseMode('light');
  const footerModes = page.getByTestId('theme-select');
  const lightRadio = footerModes.getByRole('radio', { name: '浅色', exact: true });
  await lightRadio.focus();
  await lightRadio.press('ArrowRight');
  await expect(footerModes.getByRole('radio', { name: '深色', exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await footerModes.getByRole('radio', { name: '深色', exact: true }).press('ArrowLeft');
  await expect(lightRadio).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  report.footerNativeRadio = { keyboardArrowsReachActualThemeOwner: true };
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(page.getByTestId('settings-shell')).toHaveAttribute('data-rail', 'collapsed');
  await expect(page.getByTestId('model-pause')).toHaveAccessibleName(/回应|运行|暂停/);
  await capture('normal-collapsed-source-shell');
  await assertSourceVisualFit('collapsed source sidebar');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
}
async function selectProvider(id) {
  await reveal('provider');
  await page.getByTestId('model-provider-search').fill('');
  await page.getByTestId('model-pick-' + id).click();
  await reveal('connect');
}
async function normalProviderDrafts() {
  await selectProvider('deepseek');
  const model = page.getByTestId('model-input'),
    key = page.getByTestId('key-input');
  await model.fill('normal-source-draft');
  await key.fill(fixtureKey);
  await page.getByTestId('model-provider-toggle').click();
  await expect(model).toHaveValue('normal-source-draft');
  await expect(key).toHaveValue(fixtureKey);
  const search = page.getByTestId('model-provider-search');
  await search.fill('no-such-qa-service');
  await expect(page.getByTestId('model-provider-empty')).toBeVisible();
  await search.fill('deepseek');
  await expect(page.getByTestId('model-pick-deepseek')).toBeVisible();
  await search.fill('');
  await expect(model).toHaveValue('normal-source-draft');
  await expect(key).toHaveValue(fixtureKey);
  await selectProvider('qwen');
  await key.fill(fixtureKey);
  await page.getByTestId('model-region').click();
  await expect(key).toHaveValue('');
  await expect(page.getByTestId('start-connect-form')).toContainText(/国际平台|中国大陆平台/);
  await selectProvider('deepseek');
  await expect(page.getByTestId('model-test')).toBeDisabled();
  report.modelDraft = {
    listAndSearchRetainDraft: true,
    regionSwitchClearsKey: true,
    inactiveTestDisabled: true,
  };
}
async function normalAuthCancel() {
  await selectProvider('chatgpt');
  await expect(page.getByTestId('key-input')).toHaveCount(0);
  const before = await models();
  assert.equal((await signInState()).signedIn, false);
  await page.getByTestId('model-signin').click();
  await expect(page.getByTestId('model-signin-cancel')).toBeVisible();
  await expect.poll(async () => (await signInState()).phase).toBe('waiting');
  await page.getByTestId('model-signin-cancel').click();
  await expect.poll(async () => (await signInState()).phase).toBe('idle');
  await expect(page.getByTestId('model-signin')).toBeEnabled();
  assert.equal((await signInState()).signedIn, false);
  const after = await models();
  assert.equal(after.revision, before.revision);
  assert.equal(after.active, null);
  report.authCancel = {
    realUiStartAndCancel: true,
    accountEntered: false,
    signedIn: false,
    activated: false,
  };
  await selectProvider('deepseek');
}
async function normalSaveDenial() {
  const before = await models();
  assert.equal(before.credentialStorageAvailable, true);
  assert.equal(before.active, null);
  await page.getByTestId('model-input').fill('qa-source-denied-model');
  await page.getByTestId('key-input').fill(fixtureKey);
  await page.getByTestId('model-save').click();
  await denyNetwork();
  await expect(page.getByTestId('model-save')).toHaveText('保存并开始');
  await expect(page.getByTestId('key-input')).toHaveValue('');
  const after = await models(),
    saved = after.endpoints.find((e) => e.id === 'deepseek');
  assert.ok(after.revision > before.revision);
  assert.equal(saved.keyConfigured, true);
  assert.equal(saved.model, 'qa-source-denied-model');
  assert.equal(after.active, null);
  assert.ok(!JSON.stringify(after).includes(fixtureKey));
  assert.ok(after.endpoints.filter((e) => e.id !== 'deepseek').every((e) => !e.keyConfigured));
  await expect(page.getByTestId('model-receipt')).toContainText(/没通过|未通过|失败/);
  await expect(page.getByTestId('model-receipt')).toContainText('当前没有在用连接');
  await expect(page.getByTestId('model-test')).toBeDisabled();
  assert.equal((await demo()).settings.replyMode, 'demo');
  report.modelSave = {
    revision: after.revision,
    savedKey: true,
    networkDenied: true,
    active: false,
    testDisabled: true,
  };
  await capture('normal-model-saved-but-not-active');
}
async function normalCorePreview() {
  await reveal('pet');
  const poke = page.getByTestId('pet-poke');
  await expect(poke).toHaveJSProperty('tagName', 'BUTTON');
  const before = await application(),
    cursor = before.cursor;
  await poke.click();
  await expect
    .poll(
      async () =>
        (await application()).history.filter((e) => e.cursor > cursor && e.reaction === 'poke')
          .length,
    )
    .toBe(1);
  const box = await poke.boundingBox(),
    stage = page.locator('.pet-bench__top'),
    stageBefore = await stage.boundingBox();
  assert.ok(box && stageBefore);
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
  );
  const afterBox = await poke.boundingBox(),
    stageAfter = await stage.boundingBox();
  const dx = afterBox.x - stageAfter.x - box.x + stageBefore.x;
  assert.ok(dx >= 24 && dx <= 70, 'Real drag did not move the visible avatar');
  const composer = page.getByTestId('pet-composer-input');
  if (!(await composer.isVisible())) await keyboardToggle(page.getByTestId('pet-chat-toggle'));
  await composer.fill(fixturePrompt);
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
  const state = await application(),
    entries = state.history.filter((e) => e.cursor > cursor),
    user = entries.find((e) => e.kind === 'user'),
    reply = entries.find((e) => e.kind === 'pet'),
    delivery = await demo();
  assert.equal(user.text, fixturePrompt);
  assert.equal(reply.mode, 'demo');
  assert.deepEqual(state.agent.owner, before.agent.owner);
  assert.ok(
    delivery.messages.some((m) => m.text === user.text) &&
      delivery.messages.some((m) => m.text === reply.text),
  );
  const consoleState = unwrap(
    await page.evaluate(() => window.petApplication.getSnapshot()),
    'Console shared Core',
  );
  assert.deepEqual(consoleState.agent.owner, state.agent.owner);
  assert.ok(
    consoleState.history.some((e) => e.id === user.id) &&
      consoleState.history.some((e) => e.id === reply.id),
    'Console and pet windows do not share the actual history identities',
  );
  report.core = {
    consoleAndPetShareAgentAndHistoryIds: true,
    poke: 1,
    drag: 1,
    user: 1,
    pet: 1,
    visibleDragX: Math.round(dx),
    sameAgentOwner: true,
    applicationAndDemoShareMessages: true,
  };
  await capture('normal-actual-Core-preview');
}
async function navigatePage(view) {
  const state = await application(),
    target = state.pages.find((p) => p.owner.pluginId === 'pet.page-' + view);
  assert.ok(target, 'Real page missing: ' + view);
  await page
    .getByRole('navigation', { name: '设置页导航', exact: true })
    .getByRole('button', { name: target.title, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.title);
}
async function normalMenuPresence() {
  await reveal('pet');
  const poke = page.getByTestId('pet-poke'),
    menu = page.getByRole('menu', { name: '桌宠预览菜单', exact: true }),
    delivery = await demo();
  assert.equal(await page.getByTestId('pet-mic-toggle').isDisabled(), !delivery.canRecord);
  assert.equal(delivery.recordingStartedAt, null);
  const theme = await storedTheme(),
    profileRevision = (await application()).profile.revision,
    stage = page.locator('.pet-bench'),
    light = await stage.getAttribute('data-light');
  await keyboardToggle(page.getByTestId('pet-light-toggle'));
  await expect(stage).not.toHaveAttribute('data-light', light);
  assert.equal(await storedTheme(), theme);
  assert.equal((await application()).profile.revision, profileRevision);
  await poke.focus();
  await poke.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('pet-menu-dress')).toHaveClass(/su-button/);
  assert.equal(await page.getByTestId('pet-menu-mic').isDisabled(), !delivery.canRecord);
  report.normalSourceRoles.menuAction = await style(page.getByTestId('pet-menu-dress'));
  await page.getByTestId('pet-menu-light').click();
  await expect(menu).not.toBeVisible();
  await expect(stage).toHaveAttribute('data-light', light);
  for (const [action, view] of [
    ['dress', 'appearance'],
    ['voice', 'voice'],
  ]) {
    await poke.focus();
    await poke.press('Shift+F10');
    await expect(menu).toBeVisible();
    const pages = (await application()).pages,
      target = pages.find((p) => p.owner.pluginId === 'pet.page-' + view);
    assert.ok(target);
    await page.getByTestId('pet-menu-' + action).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.title);
    await navigatePage('start');
    await reveal('pet');
  }
  await keyboardToggle(page.getByTestId('pet-pause'));
  await expect.poll(async () => (await models()).paused).toBe(true);
  assert.equal((await demo()).canSend, false);
  await keyboardToggle(page.getByTestId('pet-pause'));
  await expect.poll(async () => (await models()).paused).toBe(false);
  await page.getByTestId('pet-hide').click();
  await expect.poll(async () => (await nativeWindow('pet')).visible).toBe(false);
  await page.getByTestId('pet-show').click();
  await expect.poll(async () => (await nativeWindow('pet')).visible).toBe(true);
  report.presence = {
    nativeMicDisabledMatchesAvailability: true,
    audioCaptured: false,
    localLampOnly: true,
    realMenuRoutes: ['appearance', 'voice'],
    pauseResume: true,
    nativeHideShow: true,
  };
}

async function sourceThemePreviewUndo() {
  await chooseMode('light');
  await chooseScheme(sourceSchemeId);
  const original = await editorPalette(),
    stored = await storedTheme();
  await assertEffectivePalette(original, 'source editor initial values');
  await hexField('sheet').fill('#DCEAF4');
  await hexField('accent').fill('#1678C8');
  const preview = { ...original, sheet: '#dceaf4', accent: '#1678c8' };
  await assertEffectivePalette(preview, 'direct builtin source preview');
  assert.equal(await storedTheme(), stored);
  await page.getByTestId('model-input').focus();
  assert.equal((await style(page.getByTestId('model-input'))).borderTopColor, 'rgb(22, 120, 200)');
  await page.getByTestId('theme-undo-preview').click();
  await assertEffectivePalette(original, 'source undo restores actual white and blue');
  await expect(pickerField('sheet')).toHaveValue('#ffffff');
  await page.getByTestId('model-input').focus();
  assert.equal((await style(page.getByTestId('model-input'))).borderTopColor, 'rgb(45, 140, 240)');
  assert.equal(await storedTheme(), stored);
  report.directBuiltinPreview = {
    currentControlsChanged: true,
    focusChanged: true,
    previewDidNotPersist: true,
    undoRestoredSource: true,
  };
}
async function builtinPaletteSelections() {
  await reveal('theme');
  const ids = await page
    .locator('.theme-studio__schemes button[data-testid]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.testid.slice('theme-scheme-'.length)));
  for (const id of ['slate-harbor', 'jade-dawn', 'clay-ember'])
    assert.ok(ids.includes(id), 'Existing builtin disappeared: ' + id);
  const variants = [];
  for (const id of ids) {
    await chooseScheme(id);
    const palette = await editorPalette();
    await assertEffectivePalette(palette, 'selected builtin ' + id);
    variants.push({ id, palette });
  }
  assert.equal(
    new Set(variants.map((v) => JSON.stringify(v.palette))).size,
    ids.length,
    'Builtin choices collapse to one source override',
  );
  const retained = variants.find((v) => v.id === 'jade-dawn');
  assert.ok(retained);
  await chooseScheme(retained.id);
  const record = await storedTheme();
  await close();
  await launch(false);
  // Observe before any palette/mode action so a startup seed cannot conceal a retained-builtin regression.
  assert.equal(await storedTheme(), record);
  await assertEffectivePalette(retained.palette, 'retained builtin at startup before edits');
  report.builtins = {
    ids,
    distinctEffectivePalettes: variants.length,
    retainedAtStartup: retained.id,
    startupOverridden: false,
  };
}
async function themeCrudAndThirtySixBindings() {
  await chooseMode('light');
  await reveal('theme');
  const before = await storedTheme(),
    original = await editorPalette();
  for (const key of tokenKeys) {
    await expect(hexField(key)).toHaveCount(1);
    await expect(pickerField(key)).toHaveAttribute('type', 'color');
  }
  const bindings = {};
  for (const [index, key] of tokenKeys.entries()) {
    bindings[key] = '#' + (0x304050 + index * 257).toString(16);
    await hexField(key).fill(bindings[key]);
  }
  assert.deepEqual(
    await paintedPalette(),
    bindings,
    'A token field edits a different effective token',
  );
  assert.equal(await storedTheme(), before);
  await pickerField('accent').fill('#596a7b');
  await expect(hexField('accent')).toHaveValue('#596A7B');
  await page.getByTestId('theme-undo-preview').click();
  await assertEffectivePalette(original, 'all 36 binding previews undone');
  await hexField('paper').fill('#GGGGGG');
  await expect(hexField('paper')).toHaveAttribute('aria-invalid', 'true');
  assert.deepEqual(await paintedPalette(), original);
  assert.equal(await storedTheme(), before);
  await hexField('paper').fill('#334455');
  await page.getByTestId('theme-undo-preview').click();
  await assertEffectivePalette(original, 'invalid hex excluded and undone');
  await page.getByTestId('theme-scheme-name').fill('QA source retained palette');
  await page.getByTestId('theme-copy').click();
  let record = await themeRecord();
  const custom = record.custom.find((c) => c.id === record.selectedId);
  assert.ok(custom);
  const light = {
    ...(await editorPalette()),
    sheet: '#e6f2ed',
    paper: '#e1ece7',
    ink: '#263c35',
    'line-strong': '#315a4a',
    accent: '#087d64',
  };
  for (const key of ['sheet', 'paper', 'ink', 'line-strong', 'accent'])
    await hexField(key).fill(light[key]);
  await page.getByTestId('theme-save').click();
  await assertEffectivePalette(light, 'saved custom light actual controls');
  await chooseMode('dark');
  const dark = {
    ...(await editorPalette()),
    sheet: '#172a24',
    paper: '#10221d',
    ink: '#dcefe6',
    'line-strong': '#a6d0bd',
    accent: '#6fdbc0',
  };
  for (const key of ['sheet', 'paper', 'ink', 'line-strong', 'accent'])
    await hexField(key).fill(dark[key]);
  await page.getByTestId('theme-save').click();
  await assertEffectivePalette(dark, 'saved custom dark actual controls');
  await chooseMode('light');
  await assertEffectivePalette(light, 'custom light remains independent');
  await chooseMode('dark');
  await assertEffectivePalette(dark, 'custom dark remains independent');
  const saved = await storedTheme();
  await hexField('sheet').fill('#334a42');
  await page.getByTestId('theme-undo-preview').click();
  await assertEffectivePalette(dark, 'custom undo');
  assert.equal(await storedTheme(), saved);
  await hexField('sheet').fill('#445b53');
  await navigatePage('appearance');
  await navigatePage('start');
  await assertEffectivePalette(dark, 'leaving Start rolls preview back');
  assert.equal(await storedTheme(), saved);
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
  await page.getByTestId('theme-scheme-name').fill('QA source renamed retained palette');
  await page.getByTestId('theme-save').click();
  record = await themeRecord();
  assert.equal(
    record.custom.find((c) => c.id === custom.id).name,
    'QA source renamed retained palette',
  );
  report.customTheme = {
    id: custom.id,
    light,
    dark,
    editedBindings: 36,
    nativePicker: true,
    invalidExcluded: true,
    previewOnly: true,
    undo: true,
    leaveRollback: true,
    duplicateDeletedAfterTwoClicks: true,
    renamed: true,
  };
  await capture('normal-custom-source-theme-saved');
}
async function normalGuide() {
  await reveal('pet');
  await page.getByTestId('pet-hide').click();
  await expect.poll(async () => (await nativeWindow('pet')).visible).toBe(false);
  const revision = (await application()).profile.revision;
  await page.getByTestId('start-guide').click();
  await expect.poll(async () => (await application()).profile.data.visible).toBe(true);
  await expect.poll(async () => (await application()).dialog?.step).toBe('welcome');
  await expect.poll(async () => (await nativeWindow('console')).visible).toBe(false);
  assert.ok((await application()).profile.revision > revision);
  await pet.getByTestId('pet-dialog-choice-later').click();
  await pet.getByTestId('pet-settings').click();
  await expect.poll(async () => (await nativeWindow('console')).visible).toBe(true);
  await page.bringToFront();
  report.guide = {
    actualNativeDialog: true,
    hiddenPetWasPersistentlyShown: true,
    consoleHiddenAndReopened: true,
  };
}
async function normalRestart() {
  const record = await storedTheme(),
    model = await models(),
    before = (await application()).history.map(({ id, cursor, kind, mode }) => ({
      id,
      cursor,
      kind,
      mode,
    }));
  await close();
  await launch(false);
  assert.equal(await storedTheme(), record);
  assert.equal((await themeRecord()).selectedId, report.customTheme.id);
  await assertEffectivePalette(
    report.customTheme.dark,
    'existing selected custom on startup before editing',
  );
  const after = (await application()).history;
  assert.ok(
    before.every((e) =>
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
  await chooseMode('light');
  await assertEffectivePalette(report.customTheme.light, 'restarted custom light');
  await chooseMode('dark');
  await assertEffectivePalette(report.customTheme.dark, 'restarted custom dark');
  await capture('normal-startup-retained-custom-not-seeded');
  report.restart = {
    savedHistoryIdentities: before.length,
    customId: report.customTheme.id,
    allCustomValuesPreserved: true,
    modelRevision: meta.revision,
    keyPresentWithoutActivation: true,
    startupSeedOverride: false,
  };
}
async function openSourceBoardForProof() {
  await chooseMode('light');
  await chooseScheme(sourceSchemeId);
  await close();
  await launch(true);
  await page.getByTestId('style-open-layouts').click();
  await expect(page.getByTestId('start-design-lab')).toBeVisible();
  await chooseMode('light');
  await chooseScheme(sourceSchemeId);
  await page.getByTestId('site-source-open').click();
  await expect(page.getByTestId('site-source-board')).toBeVisible();
}
async function sourceMaterialAndCanvasProof() {
  await page.getByTestId('source-pair-afraid-squid-51').scrollIntoViewIfNeeded();
  await capture('01-button-paired-source-rest');
  await compareButton(
    page.getByTestId('raw-afraid-squid-51').locator('.button'),
    page.getByTestId('source-adapted-button'),
  );
  await compareInput(
    page.getByTestId('raw-polite-stingray-67').locator('.input'),
    page.getByTestId('source-adapted-input'),
  );
  await expect(page.getByTestId('source-pair-polite-stingray-67')).toContainText('54');
  await expect(page.getByTestId('source-pair-polite-stingray-67')).toContainText('border-box');
  await compareSwitch(
    page.getByTestId('raw-empty-penguin-100'),
    page.getByTestId('source-adapted-switch').locator('xpath=ancestor::label[1]'),
  );
  await rawTrustedUrlCheck();
  const host = page.getByTestId('raw-afraid-cougar-9'),
    card = host.locator('.flip-card__front');
  await host.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const canvas = await host.boundingBox(),
    rendered = await card.boundingBox();
  assert.ok(canvas && rendered);
  const contained =
    rendered.x >= canvas.x &&
    rendered.y >= canvas.y &&
    rendered.x + rendered.width + 4 <= canvas.x + canvas.width &&
    rendered.y + rendered.height + 4 <= canvas.y + canvas.height;
  report.rawFormCanvas = { canvas, rendered, contained };
  assert.equal(contained, true, 'Raw form still overlaps caption/source notes outside its host');
  await capture('08-raw-form-contained-canvas-and-source-notes');
  const rawChoice = await style(page.getByTestId('raw-stupid-seahorse-9').locator('.wrapper'));
  parity('normal/footer-radio/source-shape', rawChoice, report.normalSourceRoles.choice, [
    'borderTopWidth',
    'borderTopStyle',
    'borderTopColor',
    'borderRadius',
    'boxShadow',
    'backgroundColor',
  ]);
  parity(
    'normal/footer-radio/source-selected-pill',
    await style(page.getByTestId('raw-stupid-seahorse-9').locator('.btn').first()),
    report.normalSourceRoles.choiceSelected,
    ['borderRadius', 'backgroundColor'],
  );
  parity('normal/panel/source-material-only', await style(card), report.normalSourceRoles.panel, [
    'borderTopWidth',
    'borderTopStyle',
    'borderTopColor',
    'borderRadius',
    'boxShadow',
    'padding',
  ]);
  report.actualSourceMapping = {
    wholeControls: ['afraid-squid-51', 'polite-stingray-67', 'empty-penguin-100'],
    adaptedRadio: 'stupid-seahorse-9',
    panelMaterialOnly: 'afraid-cougar-9',
    panelLoginAndFlipNotAdopted: true,
    nativePickerNotSourced: true,
    localExtensions: ['tile', 'menu', 'status', 'busy', 'invalid', 'dark variant'],
  };
}
async function sourceGlyphProof() {
  await glyphMorph(page.getByTestId('source-glyph-demo'), 'eye', 'eye-off', false);
  await actualGlyphInventory();
  await milestoneReducedMotion();
  assert.ok(report.geometry.every((g) => g.pass));
}
async function finalSourceBoardProof() {
  await openSourceBoardForProof();
  await rawRendering();
  await sourceMaterialAndCanvasProof();
  await milestoneBoardStates();
  await sourceGlyphProof();
}
async function runVisualFollowup() {
  const baseline = JSON.parse(await fs.readFile(path.join(root, functionalBaselinePath), 'utf8'));
  assert.equal(baseline.status, 'passed');
  assert.equal(baseline.phase, 'normal-source-full');
  assert.equal(baseline.checks.length, 14);
  report.functionalBaseline = {
    report: functionalBaselinePath,
    passedCases: 14,
    sourceDigest: baseline.finalFingerprint.sourceDigest,
    buildDigest: baseline.finalFingerprint.buildDigest,
    functionalFlowsRerunOnCurrentSource: false,
  };
  const previous = new Map(baseline.fingerprint.source.files.map((row) => [row.path, row.sha256]));
  const changes = report.fingerprint.source.files
    .filter((row) => previous.get(row.path) !== row.sha256)
    .map((row) => row.path);
  report.changedSinceFunctionalBaseline = changes;
  const allowed = new Set([
    'apps/desktop/src/renderer/console/settings-shell.css',
    'apps/desktop/src/renderer/console/console-app.tsx',
    site + '/source-controls.css',
    site + '/source-extensions.css',
    site + '/source-board.tsx',
    site + '/source-manifest.json',
  ]);
  const unexpected = changes.filter(
    (file) =>
      /\.(tsx?|css|mjs|cjs|js|json)$/.test(file) &&
      !file.includes('.test.') &&
      !file.startsWith('qa/') &&
      !allowed.has(file),
  );
  assert.deepEqual(
    unexpected,
    [],
    'Changes beyond the reviewed CSS/copy fixes require a fresh full functional run',
  );
  await step('normal-source-default-editor-controls-after-visual-fixes', normalStartup);
  await step('source-local-containment-contrast-single-label-all-widths-and-modes', normalFrames);
  await step('actual-lab-raw-five-and-Key-field-specific-state', async () => {
    await openSourceBoardForProof();
    await rawRendering();
    await milestoneBoardStates();
  });
  await step(
    'five-source-role-material-signatures-and-contained-raw-form',
    sourceMaterialAndCanvasProof,
  );
  await step('seventeen-actual-glyphs-native-morph-and-reduced-motion', sourceGlyphProof);
}
async function runFullNormal() {
  await step('normal-start-source-default-controls-editor-and-shared-shell', normalStartup);
  await step('one-source-basis-normal-1200-880-light-dark-and-collapsed-shell', normalFrames);
  await step('normal-provider-search-draft-and-region-key-boundary', normalProviderDrafts);
  await step('real-auth-start-cancel-without-account-or-activation', normalAuthCancel);
  await step('real-model-save-network-denial-keeps-active-truth', normalSaveDenial);
  await step('real-single-Core-poke-drag-one-user-and-one-pet', normalCorePreview);
  await step('source-preview-menu-real-routes-pause-visibility-and-mic', normalMenuPresence);
  await step('builtin-source-direct-editor-preview-and-real-control-undo', sourceThemePreviewUndo);
  await step('retained-builtin-selection-effective-palette-and-startup', builtinPaletteSelections);
  await step(
    'all-36-theme-bindings-preview-invalid-picker-CRUD-and-variants',
    themeCrudAndThirtySixBindings,
  );
  await step('native-guide-from-hidden-pet-and-settings-reopen', normalGuide);
  await step('normal-restart-retains-existing-custom-model-key-and-history', normalRestart);
  await step('five-source-role-adoption-raw-canvas-and-actual-glyph-proof', finalSourceBoardProof);
}
async function runNative() {
  if (boardMilestone) return runBoardMilestone();
  if (visualFollowup) return runVisualFollowup();
  assert.equal(fullNormal, true, 'Full normal suite requires Parent final freeze and --frozen.');
  return runFullNormal();
}

async function runBoardMilestone() {
  assert.equal(
    boardMilestone,
    true,
    'Complete normal-Start native suite awaits its own final freeze; use the authorized --board-milestone scope only.',
  );
  let before;
  await step('source-board-reachable-through-actual-lab-controls', async () => {
    await launch();
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await expect(page.getByTestId('style-family-gallery')).toBeVisible();
    await page.getByTestId('style-open-layouts').click();
    await expect(page.getByTestId('start-design-lab')).toBeVisible();
    await page.getByTestId('model-input').fill('source-board-milestone-draft');
    await page.getByTestId('key-input').fill(fixtureKey);
    const state = await application();
    before = {
      theme: await storedTheme(),
      modelRevision: (await models()).revision,
      profileRevision: state.profile.revision,
      cursor: state.cursor,
      agentOwner: state.agent.owner,
      url: page.url(),
    };
    await page.getByTestId('site-source-open').click();
    await expect(page.getByTestId('site-source-board')).toBeVisible();
    report.entry = {
      labFlag: true,
      visibleRoute: ['style-open-layouts', 'site-source-open'],
      normalStartBodyImplemented: false,
      sharedShellImplemented: false,
    };
  });
  await step('five-actual-raw-shadow-samples-match-pinned-source', rawRendering);
  await step('button-same-rest-and-pointer-pressed-material', async () => {
    await page.getByTestId('source-pair-afraid-squid-51').scrollIntoViewIfNeeded();
    await capture('01-button-paired-source-rest');
    await compareButton(
      page.getByTestId('raw-afraid-squid-51').locator('.button'),
      page.getByTestId('source-adapted-button'),
    );
  });
  await step('input-empty-same-focus-rest-and-placeholder-material', async () => {
    await compareInput(
      page.getByTestId('raw-polite-stingray-67').locator('.input'),
      page.getByTestId('source-adapted-input'),
    );
    report.inputSemantics = {
      rawType: await page
        .getByTestId('raw-polite-stingray-67')
        .locator('.input')
        .getAttribute('type'),
      adapterType: await page.getByTestId('source-adapted-input').evaluate((n) => n.type),
      comparedState: 'both empty; sequential focus/rest',
      typeDifference:
        'Password example adapted to a model-name text field; not semantic equivalence.',
    };
  });
  await step('switch-checked-and-unchecked-track-and-knob-individually', async () => {
    const label = page.getByTestId('source-adapted-switch').locator('xpath=ancestor::label[1]');
    await compareSwitch(page.getByTestId('raw-empty-penguin-100'), label);
    console.log(
      JSON.stringify({
        event: 'source-three-pairs-captured',
        report: relative(reportPath),
        screenshots: report.screenshots.length,
      }),
    );
  });
  await step('native-semantics-and-labelled-state-extensions', milestoneBoardStates);
  await step('raw-form-submit-and-source-link-trusted-url-guard', async () => {
    await rawTrustedUrlCheck();
    await page.getByTestId('raw-afraid-cougar-9').scrollIntoViewIfNeeded();
    await capture('08-raw-form-submit-preserves-trusted-url');
  });
  await step('actual-seventeen-glyphs-and-same-svg-intermediate-morph', async () => {
    await glyphMorph(page.getByTestId('source-glyph-demo'), 'eye', 'eye-off', false);
    await actualGlyphInventory();
  });
  await step('minimum-source-board-and-reduced-motion-glyph-endpoint', milestoneReducedMotion);
  await step('board-close-preserves-start-draft-and-host-records', async () => {
    await page.getByTestId('source-board-close').click();
    await expect(page.getByTestId('start-design-lab')).toBeVisible();
    await expect(page.getByTestId('model-input')).toHaveValue('source-board-milestone-draft');
    await expect(page.getByTestId('key-input')).toHaveValue(fixtureKey);
    const state = await application();
    assert.equal(state.profile.revision, before.profileRevision);
    assert.equal(state.cursor, before.cursor);
    assert.deepEqual(state.agent.owner, before.agentOwner);
    assert.equal((await models()).revision, before.modelRevision);
    assert.equal(await storedTheme(), before.theme);
    assert.equal(page.url(), before.url);
    await page.getByTestId('key-input').fill('');
    report.isolation = {
      modelDraftRetained: true,
      keyDraftRetained: true,
      profileUnchanged: true,
      historyUnchanged: true,
      themeUnchanged: true,
      modelRecordUnchanged: true,
      exactUrlRetained: true,
      sameAgentOwner: true,
    };
  });
}

if (
  !process.argv.includes('--audit-only') &&
  !process.argv.includes('--frozen') &&
  !boardMilestone &&
  !visualFollowup
)
  throw new Error(
    'Use --audit-only to prepare; native --board-milestone, --frozen and --visual-frozen require the corresponding Parent source freeze/GO.',
  );
let timer;
try {
  await fs.mkdir(output, { recursive: true });
  await step('five-byte-exact-sources-notices-and-seventeen-actual-glyphs', sourceAudit);
  if (process.argv.includes('--audit-only')) report.status = 'audit-passed';
  else {
    report.status = 'running';
    report.fingerprint = await fingerprint();
    await Promise.race([
      runNative(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('Native probe exceeded ' + TOTAL_MS + ' ms'));
        }, TOTAL_MS);
      }),
    ]);
    const after = await fingerprint();
    report.finalFingerprint = {
      sourceDigest: after.source.digest,
      buildDigest: after.build.digest,
    };
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
    assert.equal(report.errors.length, 0);
    assert.equal(report.remoteOrigins.length, 0);
    report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed';
  report.failure = redact(error);
  if (activeCheck?.status === 'running')
    Object.assign(activeCheck, { status: 'failed', error: report.failure });
  if (page && !page.isClosed() && !expired) {
    try {
      await capture('failure-' + (activeCheck?.name ?? 'startup'));
    } catch (e) {
      report.diagnosticError = redact(e);
    }
  }
} finally {
  clearTimeout(timer);
  try {
    await close();
  } catch (e) {
    report.status = 'failed';
    report.cleanupError = redact(e);
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
  process.exitCode = ['passed', 'audit-passed'].includes(report.status) ? 0 : 1;
}
