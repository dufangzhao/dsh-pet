// FINAL BUILD1 minimal real Electron UI regression; synthetic isolated service and HOME only.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const report = { scope: 'build1-native-rail-editor-pet-and-cross-surface-profile', status: 'running', checks: [],
  measurements: [], screenshots: [], limit: 'Linux Xvfb/Electron and real web client; Windows compositor/device evidence is separate.' };
let display, service, app, browser;
let stage = 'preflight', exit = 1;
try {
  const image = process.env.PET_CLOUD_EXEC_IMAGE;
  assert.ok(image, 'PET_CLOUD_EXEC_IMAGE must name the prepared image');
  report.electronSha256 = createHash('sha256').update(await readFile(electron)).digest('hex');
  display = await startDisplay(root); service = await startService(image);
  const home = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-build1-home-'));
  const env = { ...display.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data') };
  app = await _electron.launch({ executablePath: electron, env,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=build1-${randomUUID()}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const consolePage = app.windows().find((page) => page.url().endsWith('/console/index.html'));
  const pet = app.windows().find((page) => page.url().endsWith('/pet/index.html'));
  assert.ok(consolePage && pet);
  const state = async () => {
    const result = await consolePage.evaluate(() => window.petCompanion.getState());
    assert.equal(result.ok, true); return result.value;
  };
  await consolePage.getByTestId('start-address').fill(service.url);
  await consolePage.getByTestId('start-ask-token').click();
  await consolePage.getByTestId('start-token').fill(service.token);
  await consolePage.getByTestId('start-connect').click();
  await expect.poll(async () => (await state()).phase, { timeout: 30000 }).toBe('live');
  async function api(route, body) {
    const response = await fetch(service.url + route, { headers: { Authorization: `Bearer ${service.token}`,
      'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const payload = await response.json(); assert.equal(payload.ok, true, `service ${route}: ${response.status}`);
    return payload.value;
  }
  async function size(width) {
    const actual = await app.evaluate(({ BrowserWindow }, requested) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/console/index.html'));
      if (!window) throw new Error('Console window unavailable');
      window.setSize(requested, 600); return window.getSize();
    }, width);
    await expect.poll(() => consolePage.evaluate(() => window.innerWidth)).toBe(actual[0]);
    return actual;
  }
  const evidence = path.join(root, 'qa/fixtures/companion-persona-memory/evidence');
  await mkdir(evidence, { recursive: true });
  const runId = randomUUID().slice(0, 8);
  async function screenshot(page, label, options = {}) {
    const file = path.join(evidence, `${runId}-build1-${label}.png`);
    await page.screenshot({ ...options, path: file }); report.screenshots.push(path.relative(root, file));
  }
  stage = 'rail-name-minimum-and-wide';
  for (const [label, name] of [['normal', 'M3 QA normal'], ['max', `Persona-${'x'.repeat(72)}`]]) {
    const profile = await api('/api/profile');
    await api('/api/profile', { expectedProfileRevision: profile.revision, name, persona: profile.persona });
    await expect.poll(async () => (await state()).snapshot?.agent.name, { timeout: 30000 }).toBe(name);
    for (const width of [880, 1100]) {
      const actual = await size(width);
      const metrics = await consolePage.evaluate(() => {
        const selectors = { rail: '.rail', footer: '.rail__foot', run: '.pb-run', name: '[data-testid="connection-name"]' };
        return Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) throw new Error(`Missing ${key}`);
          const css = getComputedStyle(element);
          return [key, { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            minWidth: css.minWidth, maxWidth: css.maxWidth, overflowX: css.overflowX,
            textOverflow: css.textOverflow, whiteSpace: css.whiteSpace,
            text: key === 'name' ? element.textContent : null,
            title: key === 'name' ? element.getAttribute('title') : null }];
        }));
      });
      assert.equal(metrics.name.text, name); assert.equal(metrics.name.title, name);
      for (const key of ['rail', 'footer', 'run'])
        assert.ok(metrics[key].scrollWidth <= metrics[key].clientWidth, `${label}/${width}: ${key} scrolls horizontally`);
      assert.equal(metrics.name.overflowX, 'hidden'); assert.equal(metrics.name.textOverflow, 'ellipsis');
      report.measurements.push({ label, nameLength: [...name].length, windowSize: actual, ...metrics });
      if (label === 'max') await screenshot(consolePage, `long-name-${width}`);
    }
  }
  report.checks.push('native-12-and-80-code-point-name-rail-880-and-1100');
  stage = 'quiet-blank-validation-keyboard-and-title';
  await size(880);
  await consolePage.getByTestId('nav-persona').click();
  await consolePage.getByTestId('persona-read').click();
  const area = consolePage.locator('[aria-label="人格与记忆"]');
  const key = area.getByTestId('memory-key'), value = area.getByTestId('memory-value');
  const save = area.getByTestId('memory-save');
  await expect(key).toHaveValue(''); await expect(value).toHaveValue('');
  await expect(save).toBeDisabled();
  await expect(key).not.toHaveAttribute('aria-invalid', 'true');
  await expect(value).not.toHaveAttribute('aria-invalid', 'true');
  await expect(area.getByText('键不能为空。', { exact: true })).toHaveCount(0);
  await expect(area.getByText('内容不能为空。', { exact: true })).toHaveCount(0);
  await expect(area.getByRole('heading', { name: '当前记忆', exact: true })).toHaveCount(1);
  await screenshot(consolePage, 'quiet-blank');
  const factKey = `build1-${runId}`, factValue = '安静编辑的合成内容';
  await key.focus(); await key.fill(factKey); await key.press('Tab'); await expect(value).toBeFocused();
  await value.fill(' ');
  await expect(area.getByText('内容不能为空。', { exact: true })).toHaveCount(1);
  await expect(save).toBeDisabled();
  await value.fill(factValue); await expect(save).toBeEnabled();
  await value.press('Tab'); await expect(save).toBeFocused(); await save.press('Enter');
  await expect.poll(async () => (await api('/api/memory')).facts.find((fact) => fact.key === factKey)?.value,
    { timeout: 30000 }).toBe(factValue);
  await expect(key).toHaveValue(''); await expect(value).toHaveValue(''); await expect(save).toBeDisabled();
  await expect(area.getByText('键不能为空。', { exact: true })).toHaveCount(0);
  await expect(area.getByText('内容不能为空。', { exact: true })).toHaveCount(0);
  await screenshot(consolePage, 'saved-blank');
  report.checks.push('native-quiet-blank-disabled-validation-title-keyboard-and-post-save-reset');
  stage = 'web-profile-refresh-and-preserved-draft';
  const browserHome = await mkdtemp(path.join(os.tmpdir(), 'companion-m3-build1-browser-home-'));
  const browserEnv = { ...display.env, HOME: browserHome, XDG_CONFIG_HOME: path.join(browserHome, 'config'),
    XDG_CACHE_HOME: path.join(browserHome, 'cache'), XDG_DATA_HOME: path.join(browserHome, 'data') };
  browser = await chromium.launch({ executablePath: path.join(root, '.companion-data/tooling/browser/chromium-156/chrome-headless-shell-linux64/chrome-headless-shell'),
    env: browserEnv, chromiumSandbox: false, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const web = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await web.goto(service.url, { waitUntil: 'domcontentloaded' });
  await web.locator('#tc-token').fill(service.token); await web.locator('#tc-token').press('Enter');
  await web.locator('.tc-chat').waitFor({ timeout: 30000 });
  const webArea = web.locator('[aria-label="人格与记忆"]');
  const webName = webArea.getByTestId('profile-name'), webPersona = webArea.getByTestId('profile-persona');
  const webSave = webArea.getByTestId('profile-save');
  const desktopName = area.getByTestId('profile-name'), desktopPersona = area.getByTestId('profile-persona');
  const desktopSave = area.getByTestId('profile-save');
  const initialProfile = await api('/api/profile');
  await expect(webName).toHaveValue(initialProfile.name);
  await expect(webPersona).toHaveValue(initialProfile.persona);
  await expect(desktopName).toHaveValue(initialProfile.name);
  const firstName = `跨端人格 ${runId}`, firstPersona = `合成的跨端人格正文 ${runId}`;
  await desktopName.fill(firstName); await desktopPersona.fill(firstPersona); await desktopSave.click();
  await expect.poll(async () => {
    const current = await api('/api/profile');
    return current.name === firstName && current.persona === firstPersona &&
      current.management.application.appliedRevision === current.revision;
  }, { timeout: 30000 }).toBe(true);
  const firstProfile = await api('/api/profile');
  await expect(web.locator('.tc-agent__name')).toHaveText(firstName, { timeout: 30000 });
  await expect(webName).toHaveValue(firstName, { timeout: 30000 });
  await expect(webPersona).toHaveValue(firstPersona, { timeout: 30000 });
  await expect(webArea.getByTestId('profile-applied')).toContainText(`修订 ${firstProfile.revision}`, { timeout: 30000 });
  const draftName = `网页草稿 ${runId}`, draftPersona = `仍待保存的网页草稿正文 ${runId}`;
  await webName.fill(draftName); await webPersona.fill(draftPersona);
  const secondName = `桌面再次修改 ${runId}`, secondPersona = `桌面第二次人格正文 ${runId}`;
  await expect(desktopName).toHaveValue(firstName, { timeout: 30000 });
  await expect(desktopPersona).toHaveValue(firstPersona, { timeout: 30000 });
  await desktopName.fill(secondName); await desktopPersona.fill(secondPersona); await desktopSave.click();
  await expect.poll(async () => {
    const current = await api('/api/profile');
    return current.name === secondName && current.persona === secondPersona &&
      current.management.application.appliedRevision === current.revision;
  }, { timeout: 30000 }).toBe(true);
  const secondProfile = await api('/api/profile');
  assert.ok(secondProfile.revision > firstProfile.revision);
  await expect(webArea.getByTestId('profile-moved')).toBeVisible({ timeout: 30000 });
  await expect(webName).toHaveValue(draftName); await expect(webPersona).toHaveValue(draftPersona);
  await screenshot(web, 'dirty-profile-rebase');
  const staleResponse = web.waitForResponse((response) => response.url().endsWith('/api/profile') && response.request().method() === 'POST');
  await webSave.click();
  const conflict = await staleResponse;
  assert.equal(conflict.status(), 409);
  assert.equal(conflict.request().postDataJSON().expectedProfileRevision, firstProfile.revision);
  await expect(webName).toHaveValue(draftName); await expect(webPersona).toHaveValue(draftPersona);
  await webArea.getByTestId('profile-rebase').click();
  await expect(webArea.getByTestId('profile-moved')).toHaveCount(0);
  await expect(webName).toHaveValue(draftName); await expect(webPersona).toHaveValue(draftPersona);
  const rebaseResponse = web.waitForResponse((response) => response.url().endsWith('/api/profile') && response.request().method() === 'POST');
  await webSave.click();
  const accepted = await rebaseResponse;
  assert.equal(accepted.status(), 200);
  assert.equal(accepted.request().postDataJSON().expectedProfileRevision, secondProfile.revision);
  await expect.poll(async () => (await api('/api/profile')).persona, { timeout: 30000 }).toBe(draftPersona);
  const finalProfile = await api('/api/profile');
  assert.equal(finalProfile.name, draftName);
  assert.equal(finalProfile.management.application.appliedRevision, finalProfile.revision);
  await expect(webArea.getByTestId('profile-applied')).toContainText(`修订 ${finalProfile.revision}`, { timeout: 30000 });
  report.profileRevisions = { initiallyLoaded: initialProfile.revision, firstSave: firstProfile.revision,
    externalSave: secondProfile.revision, afterExplicitRebase: finalProfile.revision };
  report.checks.push('real-web-full-profile-application-refresh-and-dirty-cas-rebase');
  stage = 'pet-transparency-and-style-isolation';
  const petWindow = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/pet/index.html'));
    if (!window) throw new Error('Pet window unavailable');
    return { backgroundColor: window.getBackgroundColor(), opacity: window.getOpacity() };
  });
  const css = await pet.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor, personaRoots: document.querySelectorAll('.tc-persona-memory').length }));
  // Electron's getter may omit alpha; verify transparency from the actual rendered pixels.
  assert.equal(css.html, 'rgba(0, 0, 0, 0)'); assert.equal(css.body, 'rgba(0, 0, 0, 0)');
  assert.equal(css.personaRoots, 0);
  const petImage = await pet.screenshot({ omitBackground: true });
  const alpha = await app.evaluate(({ nativeImage }, imageBase64) => {
    const image = nativeImage.createFromBuffer(Buffer.from(imageBase64, 'base64'));
    const bytes = image.toBitmap(); let transparent = 0, opaque = 0, partial = 0;
    for (let offset = 3; offset < bytes.length; offset += 4) {
      if (bytes[offset] === 0) transparent++;
      else if (bytes[offset] === 255) opaque++;
      else partial++;
    }
    return { size: image.getSize(), transparent, opaque, partial };
  }, petImage.toString('base64'));
  assert.ok(alpha.transparent > 0 && alpha.opaque + alpha.partial > 0, 'pet screenshot must contain transparent background and visible content');
  const petFile = path.join(evidence, `${runId}-build1-pet-alpha.png`);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(petFile, petImage, { flag: 'wx' }));
  report.screenshots.push(path.relative(root, petFile)); report.pet = { window: petWindow, css, alpha };
  report.checks.push('real-pet-window-alpha-and-persona-style-isolation');
  report.status = 'build1-ui-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'build1-ui-failed'; report.failure = `${stage}: ${detail.slice(0, 1000)}`;
} finally {
  try { await browser?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await app?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await service?.close(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  try { await display?.stop(); } catch { report.status = 'cleanup-failed'; exit = 1; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
