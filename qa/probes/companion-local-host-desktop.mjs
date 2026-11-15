// Production Main/preload and independently packaged daemon; controlled loopback only.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const layoutArg = process.argv.find((arg) => arg.startsWith('--layout='));
assert.ok(layoutArg && process.argv.length === 3, 'Use --layout=/absolute/independent/Linux/portable');
const layout = await realpath(layoutArg.slice('--layout='.length));
assert.ok(!layout.startsWith(repository + path.sep), 'Execute a package outside the checkout');
assert.equal(process.platform, 'linux');
const packageRequire = createRequire(path.join(layout, 'resources/app/package.json'));
const WebSocket = packageRequire('ws');
const id = randomUUID();
const evidence = path.join(repository, 'qa/fixtures/local-host/evidence', `desktop-${id}`);
await mkdir(evidence, { recursive: true });
const privateRoot = await mkdtemp(path.join(tmpdir(), 'pet-native-desktop-'));
const token = `g6-owner-quoted-"\\-${id}`;
const sourceKey = `g6-native-onebot-${id}`;
const report = { id, scope: 'production-packaged-Main-preload-independent-daemon', status: 'running', checks: [], cleanup: {}, limitations: ['Controlled Linux-x64 Electron45 with explicit --no-sandbox; no OS sandbox or Windows ACL/device execution claim.', 'Source authorization (review/trust/preset for all three managed sources) is exercised through real DOM clicks scoped to each trust card; source settings, credentials and every other control in this probe still use the fixed preload facade, so this is not a full-forms DOM claim.', 'Personal owner HTTP/SSE fixture only; full authenticated QQ→State/Core/media/native delivery belongs to the integrated bridge gates.', 'No real QQ account, paid model, existing user profile, or public publication.'] };
let application, display, peer, server, consolePage, hostTarget;
let stage = 'preflight';
const responses = new Set();
const closingApplications = [];
const call = async (method, input) => consolePage.evaluate(async ({ method, input }) => input === undefined ? window.petLocalHost[method]() : window.petLocalHost[method](input), { method, input });
const checked = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const state = async () => checked(await call('getState'));
const onebot = (view) => { const value = view.sources.find((source) => source.protocol === 'onebot-v11'); assert.ok(value); return value; };
async function freePort() {
  const listener = createSocketServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
async function launch() {
  const app = await _electron.launch({ executablePath: path.join(layout, 'pet-desktop'), args: ['--no-sandbox', '--show-settings'], env: { ...display.env, HOME: privateRoot, XDG_CONFIG_HOME: path.join(privateRoot, 'config'), LD_LIBRARY_PATH: [path.join(layout, 'lib'), path.join(layout, 'lib/browser')].join(path.delimiter) }, timeout: 30000 });
  await expect.poll(() => app.windows().filter((page) => page.url().startsWith('file:')).length, { timeout: 30000 }).toBe(2);
  consolePage = app.windows().find((page) => page.url().endsWith('/console/index.html'));
  assert.ok(consolePage);
  await consolePage.waitForFunction(() => !!window.petLocalHost);
  return app;
}
async function noSecretFiles(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await noSecretFiles(file);
    else if (entry.isFile()) {
      const bytes = await readFile(file);
      assert.ok(!bytes.includes(Buffer.from(token)) && !bytes.includes(Buffer.from(sourceKey)), 'Plaintext key entered a native profile file');
      assert.ok(!/\.sqlite(?:3)?$/.test(entry.name), 'Local conversation State was constructed');
    }
  }
}
async function stopServer() {
  if (!server) return;
  for (const response of responses) response.end();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server = undefined;
}
try {
  display = await startDisplay(repository);
  stage = 'real-packaged-GUI';
  application = await launch();
  const native = await application.evaluate(({ app, BrowserWindow }) => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node, packaged: app.isPackaged, defaultApp: process.defaultApp, argv: process.argv, appPath: app.getAppPath(), userData: app.getPath('userData'), pid: process.pid, windows: BrowserWindow.getAllWindows().map((window) => { const options = window.webContents.getLastWebPreferences(); return { url: window.webContents.getURL(), sandbox: options.sandbox, contextIsolation: options.contextIsolation, nodeIntegration: options.nodeIntegration }; }) }));
  report.native = native;
  assert.equal(native.packaged, true);
  assert.equal(native.electron, '45.0.0');
  for (const window of native.windows) {
    assert.ok(window.url.startsWith('file://' + layout));
    assert.equal(window.sandbox, true);
    assert.equal(window.contextIsolation, true);
    assert.equal(window.nodeIntegration, false);
  }
  assert.equal(await consolePage.evaluate(() => Object.isFrozen(window.petLocalHost)), true);
  const pet = application.windows().find((page) => page.url().endsWith('/pet/index.html'));
  assert.ok(pet);
  assert.equal((await pet.evaluate(() => window.petLocalHost.start())).error.code, 'permission-denied');
  checked(await call('start'));
  const running = await state();
  assert.equal(running.phase, 'running');
  hostTarget = { hostId: running.view.identity.hostId, bootId: running.view.identity.bootId };
  report.native = native;
  report.host = running.view.identity;
  report.checks.push('actual-packaged-GUI-fixed-start-frozen-preload-exact-role-denial');

  stage = 'local-source-settings-key-and-native-listener';
  let source = onebot(running.view);
  const port = await freePort();
  let mutation = checked(await call('saveSource', { ...hostTarget, protocol: 'onebot-v11', expectedRevision: source.configRevision, settings: { protocol: 'onebot-v11', accountId: '12345', mode: 'reverse-ws', channelMode: 'universal', mediaProfile: 'snowluma-v11', listenHost: '127.0.0.1', listenPort: port, path: '/g6-native' } }));
  assert.equal(mutation.error, null);
  source = onebot(mutation.view);
  mutation = checked(await call('setSourceCredential', { ...hostTarget, protocol: 'onebot-v11', expectedRevision: source.configRevision, expectedCredentialVersion: source.credential.version, value: sourceKey }));
  assert.equal(mutation.error, null);
  /*
   * 三个受管源的授权必须走**真实 UI 点击**：读取 → 显示完整 digest → 信任 → 允许。
   * 之前这里直接调用 preload 的 confirmSourceTrust/setSourcePreset，正好掩盖了
   * 「界面没有 setSourcePreset 按钮、Agent 连接没有信任入口」这两个真实阻断。
   * 权限写入只能由用户点击触发；本探针只用只读 reviewSource 复核 epoch/preset。
   */
  const trustCard = (selector) => consolePage.locator(`[data-testid="local-trust-${selector}"]`);
  const text = async (locator) => (await locator.innerText()).trim();
  const clickedSources = [];
  async function authorizeThroughUi(protocol) {
    const card = trustCard(protocol);
    const review = card.locator('[data-testid="local-source-review"]');
    await review.waitFor({ state: 'visible', timeout: 20000 });
    await review.click();
    const digest = card.locator('[data-testid="local-source-digest"]');
    await digest.waitFor({ state: 'visible', timeout: 20000 });
    const shown = await text(digest);
    assert.match(shown, /^[a-f0-9]{64}$/, `${protocol}: 界面必须显示完整 64 位摘要，实际 ${shown}`);
    assert.equal(await text(card.locator('[data-testid="local-source-trusted"]')), '未信任');
    assert.match(await text(card.locator('[data-testid="local-source-preset"]')), /deny/);
    const confirm = card.locator('[data-testid="local-source-confirm-trust"]');
    await confirm.waitFor({ state: 'visible', timeout: 20000 });
    await confirm.click();
    await expect.poll(async () => text(card.locator('[data-testid="local-source-trusted"]')), { timeout: 20000 }).toBe('已信任');
    // 只读复核：信任已落到真实权限控制，epoch 已递增（不是界面自己算的）。
    const afterTrust = checked(await call('reviewSource', { ...hostTarget, protocol }));
    assert.equal(afterTrust.trusted, true);
    assert.equal(afterTrust.digest, shown, `${protocol}: 只读复核的摘要必须与界面显示一致`);
    assert.ok(afterTrust.permissionEpoch > 0, `${protocol}: confirmTrust 之后 epoch 必须已递增`);
    const allow = card.locator('[data-testid="local-source-allow-permissions"]');
    await allow.waitFor({ state: 'visible', timeout: 20000 });
    await allow.click();
    await expect.poll(async () => text(card.locator('[data-testid="local-source-preset"]')), { timeout: 20000 }).toContain('allow');
    /*
     * 点击能成功本身就是 epoch 的证据：若界面沿用 confirmTrust 之前的旧 epoch，
     * setSourcePreset 会被 CAS 判 conflict，preset 会停在 deny。
     */
    const afterPreset = checked(await call('reviewSource', { ...hostTarget, protocol }));
    assert.equal(afterPreset.preset, 'allow', `${protocol}: 允许必须真正生效`);
    assert.equal(afterPreset.trusted, true);
    assert.ok(afterPreset.permissionEpoch > afterTrust.permissionEpoch);
    assert.equal(await card.locator('[data-testid="local-source-trust-error"]').count(), 0);
    clickedSources.push({ protocol, digest: shown, presetEpoch: afterPreset.permissionEpoch });
  }
  for (const protocol of ['official', 'onebot-v11', 'agent-link']) await authorizeThroughUi(protocol);
  report.trust = clickedSources;
  let latest = await state();
  source = onebot(latest.view);
  mutation = checked(await call('setSourceEnabled', { ...hostTarget, protocol: 'onebot-v11', enabled: true, expectedControlRevision: latest.view.sourcesRevision, expectedConfigRevision: source.configRevision, expectedCredentialVersion: source.credential.version }));
  assert.equal(mutation.error, null);
  peer = new WebSocket(`ws://127.0.0.1:${port}/g6-native`, { headers: { Authorization: `Bearer ${sourceKey}`, 'X-Self-ID': '12345', 'X-Client-Role': 'Universal' } });
  peer.on('error', () => {});
  await once(peer, 'open');
  await expect.poll(async () => onebot((await state()).view).phase, { timeout: 15000 }).toBe('ready');
  latest = await state();
  const sourceBeforeQuit = onebot(latest.view);
  report.source = { account: sourceBeforeQuit.account, bindingId: sourceBeforeQuit.bindingId, port };
  report.checks.push('both-actual-factories-reviewed-local-Config-CAS-sensitive-key-real-OneBot-native-peer');
  report.checks.push('actual-3sources-UI-clicked-read-full-digest-trust-allow-with-readonly-epoch-and-preset-verification');

  stage = 'native-current-Agent-token-handoff';
  let serverSelection = { revision: 1, selection: { mode: 'service-local', hostId: null }, phase: 'disabled', error: null, peer: null, sources: [] };
  const selectionWrites = [];
  server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end('{}'); return; }
    if (request.url.startsWith('/api/events')) { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': keepalive\n\n'); responses.add(response); response.once('close', () => responses.delete(response)); return; }
    if (request.url === '/api/snapshot') { response.end(JSON.stringify({ ok: true, value: { protocolVersion: 1, epoch: 'g6-epoch', cursor: 0, now: Date.now(), agent: { id: 'g6-agent', name: 'Controlled Agent', profileRevision: 1, harness: 'fixture', mode: 'scripted', status: 'ready', error: null }, messages: [], tasks: [], facts: [], plugins: [] } })); return; }
    if (request.url === '/api/local-host') {
      if (request.method === 'GET') { response.end(JSON.stringify({ ok: true, value: serverSelection })); return; }
      let body = '';
      request.on('data', (bytes) => { body += bytes; });
      request.on('end', () => {
        const command = JSON.parse(body);
        if (command.expectedRevision !== serverSelection.revision) { response.writeHead(409).end(JSON.stringify({ ok: false, error: { code: 'conflict' } })); return; }
        assert.deepEqual(command.selection, { mode: 'remote-host', hostId: hostTarget.hostId });
        selectionWrites.push(command);
        serverSelection = { ...serverSelection, revision: serverSelection.revision + 1, selection: command.selection, phase: 'waiting' };
        response.end(JSON.stringify({ ok: true, value: serverSelection }));
      });
      return;
    }
    response.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const serverAddress = server.address();
  assert.ok(serverAddress && typeof serverAddress !== 'string');
  const baseUrl = `http://127.0.0.1:${serverAddress.port}`;
  const personal = checked(await consolePage.evaluate(() => window.petCompanion.getState()));
  report.personalSource = checked(await consolePage.evaluate(() => window.petConsole.getSnapshot())).plugins.find((entry) => entry.owner.pluginId === 'pet.companion-client');
  const connected = checked(await consolePage.evaluate((input) => window.petCompanion.connect(input), { baseUrl, token, expectedRevision: personal.configRevision }));
  assert.equal(connected.phase, 'live');
  latest = await state();
  mutation = checked(await call('linkCurrentAgent', { ...hostTarget, connectionId: connected.connectionId, expectedRevision: latest.view.agentLink.revision, expectedCredentialVersion: latest.view.agentLink.credentialVersion }));
  assert.equal(mutation.error, null);
  assert.equal(mutation.view.agentLink.hasCredential, true);
  assert.deepEqual(selectionWrites, [{ expectedRevision: 1, selection: { mode: 'remote-host', hostId: hostTarget.hostId } }]);
  assert.deepEqual(mutation.view.agentLink.target, { baseUrl, agentId: 'g6-agent', agentEpoch: 'g6-epoch' });
  const agentBeforeQuit = mutation.view.agentLink;
  assert.ok(!JSON.stringify(await state()).includes(token));
  await noSecretFiles(path.join(native.userData, 'local-plugin-host'));
  report.checks.push('actual-personal-HTTP-SSE-lease-to-daemon-Config-and-independent-sensitive-token');
  await stopServer();

  stage = 'GUI-exit-native-source-survival';
  const exited = once(application.process(), 'exit', { signal: AbortSignal.timeout(15000) });
  closingApplications.push(application.close());
  await exited;
  application = undefined;
  const pong = once(peer, 'pong', { signal: AbortSignal.timeout(5000) });
  peer.ping('after-actual-GUI-exit');
  await pong;
  application = await launch();
  await expect.poll(async () => (await state()).phase, { timeout: 15000 }).toBe('running');
  const reopened = await state();
  assert.deepEqual(reopened.view.identity, running.view.identity);
  assert.equal(onebot(reopened.view).bindingId, sourceBeforeQuit.bindingId);
  assert.equal(onebot(reopened.view).credential.version, sourceBeforeQuit.credential.version);
  assert.equal(reopened.view.agentLink.credentialVersion, agentBeforeQuit.credentialVersion);
  assert.equal(reopened.view.agentLink.hasCredential, true);
  checked(await call('start'));
  assert.deepEqual((await state()).view.identity, running.view.identity);
  report.checks.push('actual-GUI-exit-independent-native-pong-reopen-same-boot-source-and-token-no-duplicate-start');

  stage = 'offline-authenticated-local-stop';
  const peerClosed = once(peer, 'close');
  const stopped = checked(await call('stop', hostTarget));
  assert.equal(stopped.phase, 'stopped');
  await peerClosed;
  peer = undefined;
  report.cleanup.nativePeerClosed = true;
  await noSecretFiles(path.join(native.userData, 'local-plugin-host'));
  await application.close();
  application = undefined;
  report.cleanup.guiClosed = true;
  report.checks.push('server-offline-explicit-local-stop-waits-actual-native-close');
  report.status = 'G6-G7-controlled-Linux-production-entry-passed';
} catch (error) {
  report.status = 'failed';
  report.failure = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
  process.exitCode = 1;
} finally {
  await stopServer();
  if (application && hostTarget && consolePage && !consolePage.isClosed()) {
    try { report.cleanup.stop = await call('stop', hostTarget); } catch { report.cleanup.stop = 'unconfirmed'; }
  }
  if (peer && peer.readyState !== WebSocket.CLOSED) { peer.terminate(); await once(peer, 'close'); }
  await application?.close();
  await Promise.allSettled(closingApplications);
  await display?.stop();
  report.cleanup.displayClosed = true;
  report.privateRoot = privateRoot;
  const bytes = await readFile(path.join(layout, 'pet-desktop'));
  report.runtimeSHA256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, report: path.join(evidence, 'report.json'), checks: report.checks, failure: report.failure }, null, 2));
}
