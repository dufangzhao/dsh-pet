// Actual Windows development Main/preload/daemon lifecycle, with a controlled OneBot peer.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const argv = process.argv.slice(2);
const executableArg = argv.find((arg) => arg.startsWith('--executable='));
assert.deepEqual(argv.filter((arg) => arg !== '--run-windows' && arg !== executableArg), []);
assert.ok(argv.includes('--run-windows'));
const packagedExecutable = executableArg
  ? path.resolve(executableArg.slice('--executable='.length))
  : undefined;
const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const WebSocket = createRequire(new URL('../../packages/local-host/package.json', import.meta.url))('ws');
const id = randomUUID();
const profileFlag = `--demo-acceptance=windows-${id}`;
const evidence = path.join(root, 'qa/fixtures/local-host/evidence', `windows-${id}`);
await mkdir(evidence, { recursive: true });
const key = `controlled-windows-${id}`;
const report = {
  id,
  status: 'running',
  scope: packagedExecutable
    ? 'Windows-x64-packaged-Main-preload-independent-daemon'
    : 'Windows-x64-built-development-Main-preload-independent-daemon',
  checks: [],
  cleanup: {},
  limitations: [
    ...(packagedExecutable ? [] : ['Development build, not an independently packaged preview.9 ZIP.']),
    'Controlled authenticated loopback OneBot peer; no real QQ account, model, ASR or TTS calls.',
  ],
};
let application, page, peer, target;
let stage = 'launch';
const closing = [];
const checked = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const call = (method, input) => page.evaluate(async ({ method, input }) => input === undefined ? window.petLocalHost[method]() : window.petLocalHost[method](input), { method, input });
const state = async () => checked(await call('getState'));
const onebot = (view) => {
  const source = view.sources.find((source) => source.protocol === 'onebot-v11');
  assert.ok(source);
  return source;
};
async function launch() {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const app = await _electron.launch({
    executablePath: packagedExecutable ?? require('electron'),
    args: packagedExecutable
      ? [`--user-data-dir=${path.join(root, '.cache', `pet-demo-acceptance-windows-${id}`)}`, '--show-settings']
      : [path.join(root, 'apps/desktop'), profileFlag, '--show-settings'],
    env,
    timeout: 60000,
  });
  application = app;
  await expect.poll(() => app.windows().filter((window) => window.url().startsWith('file:')).length, { timeout: 30000 }).toBe(2);
  page = app.windows().find((window) => window.url().endsWith('/console/index.html'));
  assert.ok(page);
  await page.waitForFunction(() => !!window.petLocalHost);
  return app;
}
// 本机接入不是独立页：它是 QQ 页里的第二张 Card，必须先真的点进 QQ 页。
// 页标题是 h2.page__title；h1 是标题栏品牌名，不能拿来判页。
async function openQqPage() {
  const button = page.getByTestId('nav-qq');
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.page__title')).toHaveText('QQ');
  await expect(page.getByTestId('local-host-section')).toBeVisible();
}
async function noSecrets(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await noSecrets(file);
    else if (entry.isFile()) {
      assert.ok(!(await readFile(file)).includes(Buffer.from(key)), 'Plaintext source credential persisted');
      assert.ok(!/\.sqlite(?:3)?$/.test(entry.name), 'Local conversation State constructed');
    }
  }
}
try {
  await launch();
  report.native = await application.evaluate(({ app, BrowserWindow }) => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, packaged: app.isPackaged, userData: app.getPath('userData'), pid: process.pid, windows: BrowserWindow.getAllWindows().map((window) => { const preferences = window.webContents.getLastWebPreferences(); return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration }; }) }));
  assert.equal(report.native.platform, 'win32');
  assert.equal(report.native.arch, 'x64');
  assert.equal(report.native.electron, '45.0.0');
  assert.equal(report.native.packaged, Boolean(packagedExecutable));
  for (const preferences of report.native.windows) assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(await page.evaluate(() => Object.isFrozen(window.petLocalHost)), true);
  const pet = application.windows().find((window) => window.url().endsWith('/pet/index.html'));
  assert.equal((await pet.evaluate(() => window.petLocalHost.start())).error.code, 'permission-denied');
  stage = 'start-independent-host';
  checked(await call('start'));
  const running = await state();
  assert.equal(running.phase, 'running');
  target = { hostId: running.view.identity.hostId, bootId: running.view.identity.bootId };
  report.host = running.view.identity;
  report.checks.push('Windows-production-Main-preload-start-private-directory-and-role-guards');

  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  stage = 'configure-authenticate-OneBot';
  let source = onebot(running.view);
  let mutation = checked(await call('saveSource', { ...target, protocol: 'onebot-v11', expectedRevision: source.configRevision, settings: { protocol: 'onebot-v11', accountId: '12345', mode: 'reverse-ws', channelMode: 'universal', mediaProfile: 'snowluma-v11', listenHost: '127.0.0.1', listenPort: port, path: '/windows-acceptance' } }));
  assert.equal(mutation.error, null);
  source = onebot(mutation.view);
  mutation = checked(await call('setSourceCredential', { ...target, protocol: 'onebot-v11', expectedRevision: source.configRevision, expectedCredentialVersion: source.credential.version, value: key }));
  assert.equal(mutation.error, null);
  await openQqPage();
  for (const protocol of ['official', 'onebot-v11', 'agent-link']) {
    const card = page.locator(`[data-testid="local-trust-${protocol}"]`);
    await card.locator('[data-testid="local-source-review"]').click();
    const digest = card.locator('[data-testid="local-source-digest"]');
    await expect(digest).toHaveText(/^[a-f0-9]{64}$/);
    await card.locator('[data-testid="local-source-confirm-trust"]').click();
    await expect(card.locator('[data-testid="local-source-trusted"]')).toHaveText('已信任');
    await card.locator('[data-testid="local-source-allow-permissions"]').click();
    await expect(card.locator('[data-testid="local-source-preset"]')).toHaveText('允许');
    const review = checked(await call('reviewSource', { ...target, protocol }));
    assert.equal(review.trusted, true);
    assert.equal(review.preset, 'allow');
  }
  let latest = await state();
  source = onebot(latest.view);
  mutation = checked(await call('setSourceEnabled', { ...target, protocol: 'onebot-v11', enabled: true, expectedControlRevision: latest.view.sourcesRevision, expectedConfigRevision: source.configRevision, expectedCredentialVersion: source.credential.version }));
  assert.equal(mutation.error, null);
  peer = new WebSocket(`ws://127.0.0.1:${port}/windows-acceptance`, { headers: { Authorization: `Bearer ${key}`, 'X-Self-ID': '12345', 'X-Client-Role': 'Universal' } });
  peer.on('error', () => {});
  await once(peer, 'open', { signal: AbortSignal.timeout(10000) });
  await expect.poll(async () => onebot((await state()).view).phase, { timeout: 15000 }).toBe('ready');
  const before = onebot((await state()).view);
  await page.screenshot({ path: path.join(evidence, 'running.png') });
  report.checks.push('actual-three-source-DOM-trust-and-allow-authenticated-native-OneBot-ready');
  await noSecrets(path.join(report.native.userData, 'local-plugin-host'));

  stage = 'GUI-physical-exit-and-background-native-pong';
  const exited = once(application.process(), 'exit', { signal: AbortSignal.timeout(20000) });
  closing.push(application.close());
  await exited;
  application = undefined;
  const pong = once(peer, 'pong', { signal: AbortSignal.timeout(5000) });
  peer.ping('after-Windows-GUI-exit');
  await pong;
  report.checks.push('GUI-process-exited-independent-native-source-still-answers-ping');

  stage = 'GUI-reopen-attach-original-host';
  await launch();
  await expect.poll(async () => (await state()).phase, { timeout: 15000 }).toBe('running');
  latest = await state();
  assert.deepEqual(latest.view.identity, running.view.identity);
  assert.equal(onebot(latest.view).bindingId, before.bindingId);
  assert.equal(onebot(latest.view).credential.version, before.credential.version);
  checked(await call('start'));
  assert.deepEqual((await state()).view.identity, running.view.identity);
  report.checks.push('GUI-reopen-same-host-boot-source-key-and-idempotent-start');

  stage = 'server-absent-explicit-stop';
  const closed = once(peer, 'close', { signal: AbortSignal.timeout(15000) });
  const stopped = checked(await call('stop', target));
  assert.equal(stopped.phase, 'stopped');
  await closed;
  peer = undefined;
  report.cleanup.nativePeerClosed = true;
  await noSecrets(path.join(report.native.userData, 'local-plugin-host'));
  report.checks.push('server-absent-explicit-stop-completes-and-closes-native-peer');
  report.status = packagedExecutable
    ? 'Windows-packaged-lifecycle-passed'
    : 'Windows-development-lifecycle-passed';
} catch (error) {
  report.status = 'failed';
  report.failure = `${stage}: ${error instanceof Error ? error.stack : String(error)}`;
  process.exitCode = 1;
} finally {
  if (application && target && page && !page.isClosed()) {
    try { report.cleanup.stop = await call('stop', target); } catch { report.cleanup.stop = 'unconfirmed'; }
  }
  if (peer && peer.readyState !== WebSocket.CLOSED) {
    const closed = once(peer, 'close');
    peer.terminate();
    await closed;
  }
  if (application) await application.close();
  await Promise.all(closing);
  report.cleanup.guiClosed = true;
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks, failure: report.failure, evidence }, null, 2));
}
