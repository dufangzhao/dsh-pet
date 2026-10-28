import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run serially after the parent builds the current app. This probe never builds or downloads.
// --no-sandbox is the native-QA exception in .trellis/spec/shared/project-baseline.md:29;
// it is not OS-sandbox evidence. Media consent still goes through real pet permission choices.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const executablePath = path.join(path.dirname(require.resolve('electron/package.json')), 'dist/electron.exe');
const audioFile = path.join(root, '.cache/asr-models/sensevoice-small-int8/test_wavs/zh.wav');
const out = path.join(root, 'qa/screenshots/application');
const profileId = 'ui-' + Date.now();
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
  if (process.env[key]) env[key] = process.env[key];
const names = ['pet-only-guide', 'dynamic-pages-and-fonts', 'composer-shared-history', 'explicit-prompt-save',
  'appearance-and-native-window', 'real-poke-and-blush', 'themes-minimum-keyboard-zoom', 'automatic-public-WAV', 'restart'];
const report = {
  status: 'running', at: new Date().toISOString(), profileId,
  sandboxException: '.trellis/spec/shared/project-baseline.md:29; no OS-sandbox claim',
  checks: names.map(name => ({ name, status: 'not-run' })), pageerrors: [], consoleErrors: [],
  remoteRequests: [], screenshots: [], shutdown: [], uncertainties: [],
  assumptions: [
    'Windows x64; current built Electron app and native ASR artifacts already exist.',
    'The public SenseVoice WAV, model.int8.onnx and tokens.txt are already cached; no download is attempted.',
    'An isolated --demo-acceptance profile has no Key; every reply uses the explicitly selected offline script.',
    'Playwright pointer input targets real controls; it does not prove physical OS click-through or dragging.',
    'Font checks establish the declared stack and installed-font availability, not per-glyph font attribution.',
  ],
};
let app, pet, page, pages, activeCheck;
const cleanError = error => String(error?.message ?? error).split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '')
  .replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]+/gi, '[redacted]')
  .replace(/((?:api[-_ ]?key|authorization|token)\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted]').slice(0, 1200);
const valueOf = (result, label) => {
  assert.ok(result.ok, label + ': ' + (result.error?.code ?? 'unknown error'));
  return result.value;
};
const application = async () => {
  const state = valueOf(await pet.evaluate(() => window.petApplication.getSnapshot()), 'application snapshot');
  assert.ok(state.error === null, 'Application error: ' + state.error?.code);
  return state;
};
const demo = async () => {
  const state = valueOf(await pet.evaluate(() => window.petDemo.getSnapshot()), 'demo snapshot');
  assert.ok(state.phase !== 'error' && state.error === null, 'Demo error: ' + state.error?.code);
  return state;
};
const security = async () => valueOf(await page.evaluate(() => window.petConsole.getSecurity()), 'security snapshot');
const step = async (name, run) => {
  activeCheck = report.checks.find(check => check.name === name);
  activeCheck.status = 'running';
  const started = Date.now();
  await run();
  activeCheck.status = 'passed';
  activeCheck.elapsedMs = Date.now() - started;
};
const shot = async (target, name) => {
  assert.ok(report.screenshots.length < 20, 'Screenshot budget exceeded');
  const file = path.join(out, name + '.png');
  await target.screenshot({ path: file, animations: 'disabled', omitBackground: target === pet });
  report.screenshots.push(path.relative(root, file).split(path.sep).join('/'));
};
const navigate = async view => {
  const target = pages.find(item => item.owner.pluginId === 'pet.page-' + view);
  assert.ok(target, 'Missing dynamic page: ' + view);
  const button = page.getByRole('navigation', { name: '设置页导航' }).getByRole('button', { name: target.title, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.title);
};
// CDP keyboard dispatch bypasses Electron before-input-event. Exercise the real native input route.
const nativeZoomKey = async keyCode => app.evaluate(({ BrowserWindow }, keyCode) => {
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/console/'));
  win.focus();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
}, keyCode);
const choose = async (from, choice, next) => {
  await expect.poll(async () => (await application()).dialog?.step, { timeout: 15000 }).toBe(from);
  await expect(pet.getByTestId('pet-dialog')).toHaveAttribute('data-busy', 'false');
  await pet.getByTestId('pet-dialog-choice-' + choice).click();
  await expect.poll(async () => {
    const dialog = (await application()).dialog;
    if (dialog?.error) throw new Error('Guide ' + from + ': ' + dialog.error);
    return dialog?.step ?? null;
  }, { timeout: 20000 }).toBe(next);
};
const windowState = target => app.evaluate(({ BrowserWindow }, target) => {
  const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/' + target + '/index.html'));
  if (!window) throw new Error('Missing owned ' + target + ' BrowserWindow');
  return { visible: window.isVisible(), pinned: window.isAlwaysOnTop(), bounds: window.getBounds(),
    minimum: window.getMinimumSize(), zoom: window.webContents.getZoomFactor() };
}, target);
const resize = (width, height) => app.evaluate(({ BrowserWindow }, size) => {
  const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/console/index.html'));
  if (!window) throw new Error('Missing settings window');
  window.setSize(size.width, size.height);
}, { width, height });
const noOverflow = async label => {
  const result = await page.evaluate(() => {
    const selectors = ['html', 'body', '.pk-settings', '.pk-settings__main', '.pk-settings__pane'];
    return selectors.map(selector => {
      const node = document.querySelector(selector);
      if (!node) throw new Error('Missing layout target: ' + selector);
      return { selector, client: node.clientWidth, scroll: node.scrollWidth };
    });
  });
  assert.ok(result.every(item => item.scroll <= item.client + 1), 'Horizontal overflow: ' + label);
};
const launch = async () => {
  app = await _electron.launch({ executablePath, args: [
    '--no-sandbox', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + audioFile,
    path.join(root, 'apps/desktop'), '--demo-acceptance=' + profileId,
  ], env, timeout: 30000 });
  const child = app.process();
  const shutdown = { exitConfirmed: false, exitCode: null, signal: null, forced: false };
  report.shutdown.push(shutdown);
  child.once('exit', (code, signal) => Object.assign(shutdown, { exitConfirmed: true, exitCode: code, signal }));
  const observed = new Set();
  const observe = target => {
    if (observed.has(target)) return;
    observed.add(target);
    target.setDefaultTimeout(10000);
    target.on('pageerror', error => { if (report.pageerrors.length < 16) report.pageerrors.push(cleanError(error)); });
    target.on('console', message => {
      if (message.type() === 'error' && report.consoleErrors.length < 16) report.consoleErrors.push(cleanError(message.text()));
    });
    target.on('request', request => {
      if (/^https?:/.test(request.url()) && report.remoteRequests.length < 16)
        report.remoteRequests.push(new URL(request.url()).origin); // No paths, query strings or credentials.
    });
  };
  app.context().on('page', observe);
  app.context().pages().forEach(observe);
  await expect.poll(() => app.windows().some(w => w.url().includes('/pet/index.html')), { timeout: 20000 }).toBe(true);
  pet = app.windows().find(w => w.url().includes('/pet/index.html'));
  await expect(pet.getByTestId('pet-stage')).toBeVisible();
  await expect.poll(async () => (await application()).agent.state, { timeout: 15000 }).toBe('ready');
};
const close = async () => {
  if (!app) return;
  const owned = app, child = owned.process(), shutdown = report.shutdown.at(-1);
  const timer = setTimeout(() => { shutdown.forced = true; child.kill(); }, 20000);
  try {
    await owned.close();
    await expect.poll(() => shutdown.exitConfirmed, { timeout: 3000 }).toBe(true);
    assert.ok(!shutdown.forced && shutdown.exitCode === 0 && shutdown.signal === null, 'Electron did not exit cleanly');
  } finally { clearTimeout(timer); app = undefined; }
};

try {
  assert.equal(process.platform, 'win32', 'This native probe targets Windows');
  assert.equal(process.arch, 'x64');
  for (const file of [executablePath, audioFile, path.join(path.dirname(audioFile), '../model.int8.onnx'),
    path.join(path.dirname(audioFile), '../tokens.txt'), path.join(root, 'apps/desktop/dist/main/index.mjs')]) await fs.access(file);
  await fs.mkdir(out, { recursive: true });
  await launch();
  await step('pet-only-guide', async () => {
    assert.ok(!app.windows().some(w => w.url().includes('/console/')), 'Guide must start without Settings');
    assert.equal((await demo()).keyConfigured, false);
    assert.equal((await application()).profile.data.petName, '小蓝', 'Expected a fresh isolated profile');
    await pet.getByTestId('pet-guide').click();
    const welcome = (await application()).dialog;
    assert.equal(welcome?.step, 'welcome');
    await choose('welcome', 'next', 'name');
    await pet.getByTestId('pet-dialog-input-text').fill('小星验收');
    const savedNameDialog = (await application()).dialog;
    await choose('name', 'save', 'appearance');
    // Historical UI buttons are intentionally gone; only the replay boundary needs a direct bridge call.
    const replay = await pet.evaluate(request => window.petApplication.answer(request), {
      id: savedNameDialog.id, step: savedNameDialog.step, choice: 'save', text: '不应保存',
    });
    assert.ok(!replay.ok && replay.error.code === 'stale-owner', 'A consumed guide answer was accepted');
    assert.equal((await application()).profile.data.petName, '小星验收');
    await choose('appearance', 'pine', 'voice');
    assert.equal((await application()).profile.data.palette, 'pine');
    await choose('voice', 'enable', 'provider');
    const voice = await demo();
    assert.equal(voice.settings.modelId, 'sensevoice-small-int8', 'Guide must select the first cached SenseVoice model');
    assert.ok(voice.canRecord && (await application()).profile.data.voiceEnabled, 'Guide did not enable usable local voice');
    await choose('provider', 'demo', 'done');
    await choose('done', 'done', null);
    assert.equal((await demo()).settings.replyMode, 'demo');
    assert.ok(!app.windows().some(w => w.url().includes('/console/')), 'Guide unexpectedly required Settings');
    await expect(pet.getByTestId('pet-name')).toHaveText('小星验收');
    await expect(pet.getByTestId('pet-stage')).toHaveAttribute('data-palette', 'pine');
    await shot(pet, 'guide-complete');
  });
  await pet.getByTestId('pet-settings').click();
  await expect.poll(() => app.windows().some(w => w.url().includes('/console/index.html')), { timeout: 15000 }).toBe(true);
  page = app.windows().find(w => w.url().includes('/console/index.html'));
  page.setDefaultTimeout(10000);
  pet.setDefaultTimeout(10000);
  pages = (await application()).pages;
  await step('dynamic-pages-and-fonts', async () => {
    assert.equal(pages.length, 5);
    assert.equal(new Set(pages.map(item => item.id)).size, 5);
    for (const view of ['start', 'persona', 'appearance', 'conversation', 'voice']) {
      const item = pages.find(candidate => candidate.owner.pluginId === 'pet.page-' + view);
      assert.ok(item?.manifest.panels?.some(panel => panel.builtin === 'pet.' + view), 'Missing owned page manifest: ' + view);
      await navigate(view);
      await noOverflow('normal ' + view);
      await shot(page, 'normal-' + view);
    }
    report.pages = pages.map(item => ({ title: item.title, plugin: item.owner.pluginId }));
    await navigate('persona');
    report.fonts = [];
    for (const [target, selectors] of [[page, ['body', 'h1', '.pk-row__description', 'input', 'textarea', 'button']],
      [pet, ['body', '.pet-menu__name', '.pet-bubble__text', 'input', 'button']]]) {
      const fonts = await target.evaluate(async selectors => {
        await document.fonts.ready;
        return { segoe: document.fonts.check('14px "Segoe UI"', 'Settings'),
          yahei: document.fonts.check('14px "Microsoft YaHei"', '桌宠人设'),
          samples: selectors.map(selector => {
            const node = document.querySelector(selector);
            if (!node) throw new Error('Missing font target: ' + selector);
            return { selector, family: getComputedStyle(node).fontFamily };
          }) };
      }, selectors);
      assert.ok(fonts.segoe && fonts.yahei, 'Segoe UI or Microsoft YaHei font check failed');
      assert.ok(fonts.samples.every(item => item.family.includes('Segoe UI') && item.family.includes('Microsoft YaHei')),
        'Computed font stack lost explicit Segoe UI / Microsoft YaHei');
      report.fonts.push({ window: target === page ? 'settings' : 'pet', ...fonts });
    }
  });
  await step('composer-shared-history', async () => {
    const before = (await application()).cursor;
    await expect(pet.getByTestId('pet-composer-send')).toBeDisabled();
    await pet.getByTestId('pet-composer-input').fill('你好，这是本地验收');
    await pet.getByTestId('pet-composer-send').click();
    await expect.poll(async () => {
      const state = await application();
      return state.history.some(item => item.cursor > before && item.kind === 'pet' && item.mode === 'demo');
    }, { timeout: 20000 }).toBe(true);
    const history = (await application()).history.filter(item => item.cursor > before);
    const user = history.filter(item => item.kind === 'user');
    const replies = history.filter(item => item.kind === 'pet');
    assert.ok(user.length === 1 && user[0].text === '你好，这是本地验收', 'Composer input was lost or duplicated');
    assert.ok(replies.length === 1 && replies[0].mode === 'demo', 'Expected one actual offline-script reply');
    const petHistory = (await demo()).messages;
    assert.ok(petHistory.some(item => item.text === user[0].text) && petHistory.some(item => item.text === replies[0].text),
      'Pet and application history disagree');
    await expect(pet.locator('.pet-bubble__text')).toContainText('脚本演示｜');
    await expect(pet.locator('.pet-bubble__text')).toContainText(replies[0].text);
    await navigate('conversation');
    const timeline = page.getByRole('list', { name: '日常互动记录' });
    await expect(timeline.getByText(user[0].text, { exact: true })).toHaveCount(1);
    await expect(timeline.getByText(replies[0].text, { exact: true })).toHaveCount(1);
    assert.ok(history.every((item, index) => index === 0 || item.cursor > history[index - 1].cursor), 'History cursor order is invalid');
    report.typed = { inputEntries: user.length, replyEntries: replies.length, mode: replies[0].mode };
    await shot(page, 'shared-timeline');
  });
  await step('explicit-prompt-save', async () => {
    await navigate('persona');
    const before = (await application()).profile;
    const prompt = 'You are 小星验收. Reply clearly and only describe completed actions.\n' + 'Keep the human choices and privacy boundaries. '.repeat(100);
    const input = page.getByRole('textbox', { name: '人设正文', exact: true });
    await input.fill(prompt);
    await expect(page.getByText('有未保存的改动', { exact: true })).toBeVisible();
    const draft = await application();
    assert.equal(draft.profile.revision, before.revision, 'Typing unexpectedly saved the prompt');
    assert.ok(draft.profile.data.personaPrompt === before.data.personaPrompt, 'Prompt saved before explicit submit');
    await page.getByRole('button', { name: '保存正文', exact: true }).click();
    await expect.poll(async () => {
      const state = await application();
      return state.profile.data.personaPrompt === prompt && state.prompt.state === 'applied'
        && state.prompt.appliedRevision === state.profile.revision;
    }, { timeout: 20000 }).toBe(true);
    await expect(page.locator('.pk-prompt__status')).toHaveText('已生效');
    const state = await application();
    await expect.poll(async () => {
      const shown = await page.locator('.pk-prompt__segment-text').allTextContents();
      return shown.length === state.prompt.segments.length && shown.every((text, index) => text === state.prompt.segments[index].text);
    }, { timeout: 10000, message: 'Full-prefix preview differs from the applied host segments' }).toBe(true);
    assert.ok(state.prompt.segments.some(segment => segment.text === prompt), 'Full saved prompt missing from effective prefix');
    await expect(input).toHaveValue(prompt);
    report.prompt = { characters: prompt.length, revision: state.profile.revision, appliedRevision: state.prompt.appliedRevision };
    await shot(page, 'persona-applied');
  });
  await step('appearance-and-native-window', async () => {
    await navigate('appearance');
    const stage = pet.getByTestId('pet-stage'), preview = page.getByRole('region', { name: '桌宠预览' });
    report.appearance = { figures: [], palettes: [], sizes: [] };
    for (const [field, choices] of [['figure', ['minimal', 'round']], ['palette', ['morning', 'lavender', 'pine', 'orange']],
      ['size', ['small', 'normal', 'large']]]) {
      const observed = new Set();
      for (const choice of choices) {
        await page.getByTestId('pref-' + field + '-' + choice).click();
        await expect.poll(async () => (await application()).profile.data[field]).toBe(choice);
        await expect(stage).toHaveAttribute('data-' + field, choice);
        if (field === 'figure') {
          await expect(pet.getByTestId('pet-avatar')).toHaveAttribute('data-figure', choice);
          observed.add(await pet.locator('.pet-avatar__face').getAttribute('rx'));
        } else if (field === 'palette') {
          observed.add(await stage.evaluate(node => getComputedStyle(node).getPropertyValue('--pet-body-top').trim()));
        } else {
          observed.add(Math.round((await pet.getByTestId('pet-avatar').boundingBox()).width));
          await expect(preview).toHaveAttribute('data-size', choice);
        }
        report.appearance[field === 'figure' ? 'figures' : field === 'palette' ? 'palettes' : 'sizes'].push(choice);
      }
      assert.equal(observed.size, choices.length, 'Appearance choices did not change the actual ' + field + ' renderer');
    }
    const toggle = label => page.locator('.pk-row').filter({ has: page.getByText(label, { exact: true }) }).getByRole('checkbox');
    await toggle('保持置顶').click();
    await expect.poll(async () => (await windowState('pet')).pinned).toBe(false);
    await toggle('保持置顶').click();
    await expect.poll(async () => (await windowState('pet')).pinned).toBe(true);
    await toggle('在桌面显示桌宠').click();
    await expect.poll(async () => (await windowState('pet')).visible).toBe(false);
    await expect(preview.getByRole('img')).toBeVisible();
    await expect(preview).toContainText('现在没有在桌面上显示');
    await page.getByTestId('pref-palette-pine').click();
    await expect.poll(async () => (await application()).profile.data.palette).toBe('pine');
    await expect(preview.getByRole('img')).toHaveAttribute('aria-label', /松墨/);
    await shot(page, 'hidden-pet-preview');
    await toggle('在桌面显示桌宠').click();
    await expect.poll(async () => (await windowState('pet')).visible).toBe(true);
    await expect(stage).toHaveAttribute('data-palette', 'pine');
    await toggle('允许拖动').click(); // Removes cursor-follow ambiguity from the real pointer poke below.
    await expect.poll(async () => (await application()).profile.data.draggable).toBe(false);
    await toggle('减少动画').click();
    await expect(stage).toHaveAttribute('data-reduced-motion', 'true');
  });
  await step('real-poke-and-blush', async () => {
    const before = (await application()).cursor, avatar = pet.getByTestId('pet-avatar');
    await pet.bringToFront();
    await expect(avatar).toHaveAttribute('data-expression', 'neutral');
    await expect(pet.locator('.pet-avatar__blush')).toHaveCount(0);
    const box = await avatar.boundingBox();
    assert.ok(box, 'Real avatar has no clickable bounds');
    await avatar.click({ position: { x: box.width / 2, y: box.height / 2 }, delay: 50 });
    await expect(avatar).toHaveAttribute('data-expression', 'blush', { timeout: 2000 });
    await expect(pet.locator('.pet-avatar__blush')).toHaveCount(2);
    await expect(pet.locator('.pet-avatar__blush').first()).toBeVisible();
    await shot(pet, 'pet-applied-blush');
    await expect.poll(async () => {
      const history = (await application()).history.filter(item => item.cursor > before);
      return history.filter(item => item.reaction === 'poke').length === 1
        && history.filter(item => item.reaction === 'blush').length === 1;
    }, { timeout: 10000 }).toBe(true);
    const history = (await application()).history.filter(item => item.cursor > before);
    const poke = history.find(item => item.reaction === 'poke'), blush = history.find(item => item.reaction === 'blush');
    assert.ok(blush.cursor > poke.cursor, 'Blush acknowledgement must follow the completed poke');
    await expect(avatar).toHaveAttribute('data-expression', 'neutral', { timeout: 5000 });
    await expect(pet.locator('.pet-avatar__blush')).toHaveCount(0);
    await navigate('conversation');
    const timeline = page.getByRole('list', { name: '日常互动记录' });
    await expect(timeline.getByText(poke.text, { exact: true })).toHaveCount(1);
    await expect(timeline.getByText(blush.text, { exact: true })).toHaveCount(1);
    report.appliedBlush = { status: 'passed', pokeReceipts: history.filter(item => item.reaction === 'poke').length,
      blushReceipts: history.filter(item => item.reaction === 'blush').length, returnedToNeutral: true };
  });
  await step('themes-minimum-keyboard-zoom', async () => {
    report.layout = [];
    await resize(600, 400);
    const minimum = await windowState('console');
    assert.deepEqual(minimum.minimum, [760, 560]);
    assert.ok(minimum.bounds.width === 760 && minimum.bounds.height === 560, 'BrowserWindow did not enforce its minimum size');
    for (const theme of ['dark', 'light']) {
      await page.getByTestId('theme-select').locator('input[value="' + theme + '"]').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const color = await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor);
      report.layout.push({ theme, background: color });
      for (const view of ['start', 'persona', 'appearance', 'conversation', 'voice']) {
        await navigate(view);
        await noOverflow('minimum ' + theme + ' ' + view);
      }
      await navigate('persona');
      await shot(page, 'minimum-' + theme);
    }
    assert.notEqual(report.layout[0].background, report.layout[1].background, 'Theme did not change computed colors');
    const nav = page.getByRole('navigation', { name: '设置页导航' }).getByRole('button').first();
    await nav.focus();
    await page.keyboard.press('Enter');
    await expect(nav).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const node = document.activeElement, style = getComputedStyle(node);
      return { visible: node.matches(':focus-visible'), width: parseFloat(style.outlineWidth) };
    });
    assert.ok(focus.visible && focus.width >= 2, 'Keyboard focus ring is missing');
    await page.bringToFront();
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/console/')); win.focus(); globalThis.__qaControlKeys = []; win.webContents.on('before-input-event', (_event, input) => { if(input.control) globalThis.__qaControlKeys.push({code:input.code,key:input.key,type:input.type,control:input.control}); }); });
    const base = (await windowState('console')).zoom;
    await nativeZoomKey('+');
    await expect.poll(async () => (await windowState('console')).zoom).toBeGreaterThan(base);
    const larger = (await windowState('console')).zoom;
    for (const view of ['start', 'persona', 'appearance', 'conversation', 'voice']) {
      await navigate(view);
      await noOverflow('minimum zoom-in ' + view);
    }
    await shot(page, 'minimum-zoom-in');
    await nativeZoomKey('-');
    await expect.poll(async () => (await windowState('console')).zoom).toBeLessThan(larger);
    await nativeZoomKey('0');
    await expect.poll(async () => (await windowState('console')).zoom).toBe(1);
    await noOverflow('zoom reset');
    report.zoom = { shortcuts: ['Ctrl+Shift+=', 'Ctrl+-', 'Ctrl+0'], base, larger, reset: (await windowState('console')).zoom };
    await resize(1040, 740);
  });
  await step('automatic-public-WAV', async () => {
    await navigate('voice');
    await expect(page.getByTestId('asr-model-sensevoice-small-int8')).toBeChecked();
    await expect(page.getByTestId('reply-mode-demo')).toBeChecked();
    if (!(await page.getByTestId('demo-auto-send').isChecked())) await page.getByTestId('demo-auto-send').click();
    await expect.poll(async () => (await demo()).settings.autoSend).toBe(true);
    await page.getByRole('navigation', { name: '设置页导航' }).getByRole('button', { name: '权限与数据', exact: true }).click();
    for (const pluginId of ['pet.voice-chat', 'pet.asr-local']) {
      const plugin = (await security()).plugins.find(item => item.owner.pluginId === pluginId);
      assert.ok(plugin?.trusted, 'Guide did not review source: ' + pluginId);
      await page.getByRole('group', { name: plugin.name, exact: true }).locator('input[value="ask"]').click();
      await expect.poll(async () => (await security()).plugins.find(item => item.owner.pluginId === pluginId)?.preset).toBe('ask');
    }
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__applicationCaptureQA = { streams: [], openedAt: [], stoppedAt: [], calls: 0, errors: [] };
      navigator.mediaDevices.getUserMedia = async constraints => {
        const qa = window.__applicationCaptureQA;
        qa.calls++;
        try {
          const stream = await original(constraints);
          qa.streams.push(stream); qa.openedAt.push(Date.now());
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => { stop(); qa.stoppedAt.push(Date.now()); };
          }
          return stream;
        } catch (error) { qa.errors.push(error.name); throw error; }
      };
    });
    const tracks = () => page.evaluate(() => {
      const qa = window.__applicationCaptureQA;
      return { calls: qa.calls, states: qa.streams.flatMap(stream => stream.getTracks().map(track => track.readyState)),
        openedAt: qa.openedAt, stoppedAt: qa.stoppedAt, errors: qa.errors };
    });
    await navigate('voice');
    const before = (await application()).cursor;
    const deadline = Date.now() + 85000, approved = new Set(), kinds = [];
    let recording = null, navigated = false, finished = false;
    assert.equal((await demo()).maxRecordingSeconds, 20);
    await page.getByTestId('demo-record').click();
    while (Date.now() < deadline) {
      const state = await demo();
      const pending = (await security()).pending[0];
      if (pending && !approved.has(pending.requestId)) {
        assert.ok(approved.size < 16, 'Unexpected unbounded approval flow');
        await expect.poll(async () => (await application()).dialog?.id, { timeout: 10000 }).toBe(pending.requestId);
        assert.equal((await application()).dialog.step, pending.permissionDigest, 'Pet permission choice is bound to a different request');
        await pet.getByTestId('pet-dialog-choice-allow').click();
        approved.add(pending.requestId); kinds.push(pending.permission.kind);
        await expect.poll(async () => !(await security()).pending.some(item => item.requestId === pending.requestId), { timeout: 10000 }).toBe(true);
      }
      if (state.phase === 'recording' && recording === null) recording = state;
      if (recording && state.phase === 'recording' && !navigated) {
        for (const view of ['persona', 'conversation']) {
          await navigate(view);
          const current = await demo(), capture = await tracks();
          assert.ok(current.phase === 'recording' && current.intentId === recording.intentId
            && current.recordingStartedAt === recording.recordingStartedAt, 'Navigation replaced or stopped the active capture');
          assert.ok(capture.calls === 1 && capture.states.length > 0 && capture.states.every(value => value === 'live'),
            'Navigation reopened the microphone or ended its tracks');
        }
        navigated = true;
        await expect(page.getByTestId('demo-record-end')).toBeVisible();
        await shot(page, 'capture-after-navigation');
      }
      if (recording && state.phase === 'idle' && state.transcript.trim()) { finished = true; break; }
      await page.waitForTimeout(100);
    }
    assert.ok(finished && recording && navigated, 'Automatic recording/recognition did not complete within 85 seconds');
    assert.ok(approved.size > 0 && kinds.includes('microphone'), 'No actual pending microphone permission was answered in the pet');
    await expect.poll(async () => {
      const capture = await tracks();
      return capture.states.length > 0 && capture.states.every(value => value === 'ended');
    }).toBe(true);
    const capture = await tracks();
    assert.ok(capture.calls === 1 && capture.errors.length === 0, 'Capture was reopened or getUserMedia failed');
    const captureMs = capture.stoppedAt[0] - recording.recordingStartedAt;
    assert.ok(captureMs >= 19000 && captureMs <= 25000, 'Automatic stop was not near the actual 20-second limit');
    const done = await demo(), history = (await application()).history.filter(item => item.cursor > before);
    assert.ok(history.some(item => item.kind === 'user' && item.text === done.transcript), 'Recognized public WAV is absent from shared history');
    assert.ok(history.some(item => item.kind === 'pet' && item.mode === 'demo'), 'Recognized input did not receive an actual offline reply');
    assert.equal(done.settings.replyMode, 'demo');
    const trace = await app.evaluate(() => (globalThis.petDemoAcceptance?.events ?? []).map(item => ({ action: item.action, code: item.code })));
    assert.equal(trace.filter(item => item.action === 'finish' && item.code === null).length, 1, 'Automatic stop did not submit recognition exactly once');
    assert.ok(!trace.some(item => item.code !== null), 'Capture IPC trace contains a real operation error');
    report.audio = { publicFixture: '.cache/asr-models/sensevoice-small-int8/test_wavs/zh.wav', captureMs,
      permissionDecisions: approved.size, permissionKinds: kinds, calls: capture.calls, trackStates: capture.states,
      transcriptCharacters: [...done.transcript].length, successfulFinishes: trace.filter(item => item.action === 'finish' && item.code === null).length };
    await shot(page, 'recognized-public-WAV');
  });
  await step('restart', async () => {
    const saved = await application();
    const ids = saved.history.map(item => item.id);
    await close();
    await launch();
    await expect.poll(async () => (await application()).profile.revision).toBe(saved.profile.revision);
    const reopened = await application();
    assert.ok(JSON.stringify(reopened.profile.data) === JSON.stringify(saved.profile.data), 'Committed preferences changed across restart');
    assert.ok(JSON.stringify(reopened.history.map(item => item.id)) === JSON.stringify(ids), 'History replay lost or duplicated entries');
    assert.equal(reopened.dialog, null, 'Completed guide was replayed after restart');
    await expect(pet.getByTestId('pet-name')).toHaveText('小星验收');
    await expect(pet.getByTestId('pet-stage')).toHaveAttribute('data-palette', saved.profile.data.palette);
    await pet.getByTestId('pet-settings').click();
    await expect.poll(() => app.windows().some(w => w.url().includes('/console/index.html'))).toBe(true);
    page = app.windows().find(w => w.url().includes('/console/index.html'));
    pages = reopened.pages;
    await navigate('persona');
    await expect(page.getByRole('textbox', { name: '人设正文', exact: true })).toHaveValue(saved.profile.data.personaPrompt);
    await expect.poll(async () => (await application()).prompt.state).toBe('applied');
    report.persistence = { profileRevision: reopened.profile.revision, retainedHistoryEntries: ids.length };
  });
  assert.equal(report.pageerrors.length, 0, 'Renderer pageerrors were observed');
  assert.equal(report.consoleErrors.length, 0, 'Renderer console errors were observed');
  assert.equal(report.remoteRequests.length, 0, 'Unexpected renderer network requests were observed');
  report.status = report.uncertainties.length ? 'incomplete' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = cleanError(error);
  if (activeCheck?.status === 'running') { activeCheck.status = 'failed'; activeCheck.error = report.failure; }
  for (const [target, name] of [[page, 'failure-settings'], [pet, 'failure-pet']]) {
    if (!target || target.isClosed()) continue;
    try { await shot(target, name); } catch (screenshotError) { report.screenshotError = cleanError(screenshotError); }
  }
  // Record actual codes/readiness only. Never dump history, prompt bodies, secrets, tokens or main logs.
  if (pet && !pet.isClosed()) {
    try {
      report.controlKeys = await app.evaluate(() => globalThis.__qaControlKeys ?? []);
      report.failureState = await pet.evaluate(async () => {
        const a = await window.petApplication.getSnapshot(), d = await window.petDemo.getSnapshot();
        return { applicationCode: a.ok ? a.value.error?.code ?? null : a.error.code,
          agent: a.ok ? a.value.agent.state : null, dialogStep: a.ok ? a.value.dialog?.step ?? null : null,
          dialogError: a.ok ? a.value.dialog?.error ?? null : null,
          demoCode: d.ok ? d.value.error?.code ?? null : d.error.code,
          phase: d.ok ? d.value.phase : null, canRecord: d.ok ? d.value.canRecord : null };
      });
    } catch (diagnosticError) { report.diagnosticError = cleanError(diagnosticError); }
  }
} finally {
  try { await close(); } catch (error) { report.status = 'failed'; report.cleanupError = cleanError(error); }
  if (report.pageerrors.length || report.consoleErrors.length || report.remoteRequests.length) report.status = 'failed';
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, report: 'qa/screenshots/application/acceptance-report.json',
    checks: report.checks.map(({ name, status }) => ({ name, status })), uncertainties: report.uncertainties }));
  // Exit 2 is incomplete evidence, not a fabricated pass; exit 1 is an assertion/runtime/cleanup failure.
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'incomplete' ? 2 : 1;
}
