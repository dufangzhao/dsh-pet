// G0 actual Electron roles + actual coreless kernel/factories. Not a production GUI/G6 or Windows claim.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, realpath, lstat, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';
import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const WebSocket = createRequire(new URL('../../packages/local-host/package.json', import.meta.url))('ws');
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
register();
const { openPrivateDirectory, readRendezvous } = await import('../../packages/local-host/src/rendezvous.ts');
const { attachLocalManagement } = await import('../../packages/local-host/src/management.ts');
assert.deepEqual(process.argv.slice(2), ['--run-g0']);
const root = fileURLToPath(new URL('../..', import.meta.url)), id = randomUUID();
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const evidence = path.join(root, 'qa/fixtures/local-host/evidence', id);
const report = { scope: 'G0-controlled-Electron-GUI-daemon-lifecycle-real-QQ-factories', id, status: 'running', checks: [], cleanup: {}, limits: ['Linux Electron45 with explicit --no-sandbox; no Windows/OS-sandbox proof.', 'Controlled GUI fixture uses production role/client/daemon code; final production GUI and portable package are later gates.', 'Actual OneBot native listener/controlled peer, no real QQ/Agent/paid model; official factory activated but no official network.'] };
let owned, display, gui, peer, client, daemon, failed = false, hostStopped = false;
let stage = 'preflight';
const applications = [];
async function quitGui(app) {
  const pid = app.process().pid;
  await app.evaluate(({ app }) => { setImmediate(() => app.quit()); });
  await expect.poll(() => alive(pid), { timeout: 30000 }).toBe(false);
}
async function within(promise, label) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), 30000); })]); } finally { clearTimeout(timer); } }
async function hashes() {
  const names = ['packages/local-host/src/kernel.ts','packages/local-host/src/rendezvous.ts','packages/local-host/src/management.ts','apps/desktop/src/local-host/client.ts','apps/desktop/src/local-host/main.ts','apps/desktop/src/local-host/daemon.ts','qa/fixtures/local-host/host.mjs','qa/fixtures/local-host/gui.mjs','qa/probes/companion-local-host-lifecycle.mjs'];
  const result = {}; for (const name of names) result[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex'); return result;
}
const alive = async pid => {
  try { const state = await readFile(`/proc/${pid}/stat`, 'utf8'); return !/\) [ZX] /.test(state); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  report.before = await hashes();
  const temporary = await mkdtemp(path.join(tmpdir(), 'local-host-lifecycle-'));
  const stat = await lstat(temporary); owned = { path: await realpath(temporary), dev: stat.dev, ino: stat.ino }; report.ownedRoot = { ...owned, uid: stat.uid };
  const profile = path.join(owned.path, 'daemon'), hostApp = path.join(owned.path, 'host-app'), guiApp = path.join(owned.path, 'gui-app');
  for (const dir of [profile, hostApp, guiApp]) await mkdir(dir, { mode: 0o700 });
  for (const [dir, fixture] of [[hostApp, 'host'], [guiApp, 'gui']]) {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: `g0-${fixture}`, version: '0.1.0', main: 'main.mjs' }));
    await writeFile(path.join(dir, 'main.mjs'), `await import(${JSON.stringify(new URL(`../fixtures/local-host/${fixture}.mjs`, import.meta.url).href)});\n`);
  }
  // This is source-role proof, not a self-contained portable package claim.
  await symlink(path.join(root, 'node_modules'), path.join(owned.path, 'node_modules'), 'dir');
  display = await startDisplay(root);
  const env = { ...display.env, HOME: path.join(owned.path, 'home'), XDG_CONFIG_HOME: path.join(owned.path, 'xdg') };
  await mkdir(env.HOME, { mode: 0o700 });
  const launchGui = async name => {
    const guiProfile = path.join(owned.path, name); await mkdir(guiProfile, { mode: 0o700 });
    const app = await _electron.launch({ executablePath: electron, args: ['--no-sandbox', guiApp, `--local-host-profile=${profile}`, `--gui-profile=${guiProfile}`, `--host-entry=${hostApp}`], env, timeout: 45000 });
    applications.push(app);
    await expect.poll(() => app.evaluate(() => globalThis.__localHostGuiProof?.status?.ok ?? false), { timeout: 30000 }).toBe(true);
    return app;
  };
  stage = 'GUI-starts-independent-real-host'; gui = await launchGui('gui-first');
  const first = await gui.evaluate(() => globalThis.__localHostGuiProof.status.value);
  const directory = await openPrivateDirectory(path.join(profile, 'management'));
  const rendezvous = await readRendezvous(directory); assert.ok(rendezvous);
  client = await attachLocalManagement(rendezvous);
  const current = await client.status(); assert.equal(current.ok, true);
  assert.equal(current.value.identity.bootId, first.identity.bootId);
  assert.equal(current.value.kernel.localCore, false); assert.equal(current.value.kernel.localState, false);
  assert.deepEqual(current.value.kernel.plugins.map(p => p.id).sort(), ['pet.qq-official','pet.qq-onebot']);
  assert.ok(current.value.kernel.plugins.every(p => p.state === 'active'));
  daemon = JSON.parse(await readFile(path.join(profile, 'g0-native.json'), 'utf8'));
  assert.ok(await alive(daemon.pid));
  assert.deepEqual(daemon.inheritedForbiddenNames, []);
  report.checks.push('GUI-synthetic-Agent-model-DSH-and-Node-Electron-mode-environment-not-inherited');
  report.identity = current.value.identity; report.native = { ...daemon, realFactories: true };
  report.guiRuntime = await gui.evaluate(({ app }) => ({ electron: process.versions.electron, argv: process.argv, userData: app.getPath('userData'), pid: process.pid }));
  assert.equal(report.guiRuntime.electron.split('.')[0], '45');
  peer = new WebSocket(`ws://127.0.0.1:${daemon.port}/g0`, { headers: { Authorization: 'Bearer g0-controlled-local-onebot-key', 'X-Self-ID': '12345', 'X-Client-Role': 'Universal' } });
  peer.on('error', () => {}); await within(once(peer, 'open'), 'actual controlled peer');
  const observed = async () => { try { return (await readFile(path.join(profile, 'g0-observed.ndjson'), 'utf8')).trim().split('\n').filter(Boolean).length; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; } };
  const event = n => JSON.stringify({ post_type: 'message', time: 1, self_id: 12345, user_id: 67890, message_type: 'private', sub_type: 'friend', message_id: n, sender: { user_id: 67890 }, message: [{ type: 'text', data: { text: `controlled-${n}` } }] });
  peer.send(event(1)); await expect.poll(observed).toBe(1);
  await quitGui(gui); gui = undefined;
  assert.ok(await alive(daemon.pid)); assert.equal(peer.readyState, WebSocket.OPEN);
  peer.send(event(2)); await expect.poll(observed).toBe(2);
  report.checks.push('GUI-started-detached-daemon-real-authenticated-source-still-observes-after-GUI-physical-exit');
  stage = 'new-GUI-reattach-no-duplicate'; gui = await launchGui('gui-second');
  const second = await gui.evaluate(() => globalThis.__localHostGuiProof.status.value);
  assert.deepEqual(second.identity, first.identity);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'g0-native.json'), 'utf8')).pid, daemon.pid);
  const duplicate = spawn(electron, ['--no-sandbox', hostApp, `--local-host-profile=${profile}`], { env, stdio: 'ignore' });
  const [code] = await within(once(duplicate, 'exit'), 'duplicate singleton'); assert.equal(code, 0);
  assert.equal((await client.status()).value.identity.bootId, first.identity.bootId);
  await quitGui(gui); gui = undefined;
  peer.send(event(3)); await expect.poll(observed).toBe(3);
  report.checks.push('new-GUI-auth-attaches-same-boot-native-peer-and-duplicate-headless-role-exits');
  stage = 'offline-local-stop-real-drain';
  const peerClosed = once(peer, 'close');
  const stopped = await client.stop(); assert.equal(stopped.ok, true); assert.equal(stopped.value.phase, 'stopped');
  assert.equal(stopped.value.kernel.tasks.pendingWork, 0);
  await within(peerClosed, 'actual native peer cleanup');
  await expect.poll(async () => await readRendezvous(directory), { timeout: 30000 }).toBe(null);
  await expect.poll(() => alive(daemon.pid), { timeout: 30000 }).toBe(false); hostStopped = true;
  const inventory = async folder => { const result=[]; for (const entry of await readdir(folder, { withFileTypes: true })) { if (entry.isSymbolicLink()) continue; const name=path.join(folder,entry.name); if (entry.isDirectory()) result.push(...await inventory(name)); else result.push(name); } return result; };
  assert.ok(!(await inventory(profile)).some(name => /\.sqlite(?:-|$)|[\\/]history[\\/]/.test(name)));
  report.checks.push('server-absent-local-stop-joins-actual-kernel-native-task-key-and-peer-with-no-local-State');
  report.after = await hashes(); assert.deepEqual(report.after, report.before);
  report.status = 'G0-native-lifecycle-subset-passed';
} catch (error) { failed = true; report.status = 'failed'; report.failure = `${stage}: ${error instanceof Error ? error.message.slice(0,1200) : 'non-error failure'}`; }
finally {
  if (!client && owned) {
    try {
      const directory = await openPrivateDirectory(path.join(owned.path, 'daemon/management'));
      const captured = await readRendezvous(directory);
      if (captured) client = await attachLocalManagement(captured);
      if (!daemon) daemon = JSON.parse(await readFile(path.join(owned.path, 'daemon/g0-native.json'), 'utf8'));
    } catch { report.cleanup.discovery = 'no-authenticated-host-handle'; }
  }
  if (gui) { try { await quitGui(gui); report.cleanup.gui = 'OS-process-exited'; } catch { failed = true; report.cleanup.gui = 'unconfirmed'; } }
  if (client) {
    if (!hostStopped) { try { const result = await client.stop(); if (result.ok && daemon) { await expect.poll(() => alive(daemon.pid), { timeout:30000 }).toBe(false); hostStopped=true; } } catch { failed=true; } }
    await client.close();
  }
  if (peer && peer.readyState !== WebSocket.CLOSED) { const closed=once(peer,'close'); peer.terminate(); await closed; }
  for (const app of applications) { try { await within(app.close(), 'automation handle release'); } catch { failed = true; report.cleanup.automation = 'unconfirmed'; } }
  if (display) { try { await display.stop(); report.cleanup.display='joined'; } catch { failed=true; } }
  report.cleanup.host = hostStopped ? 'joined' : 'unconfirmed';
  if (owned && hostStopped && report.cleanup.gui !== 'unconfirmed') {
    const info=await lstat(owned.path);
    assert.equal(await realpath(owned.path),owned.path); assert.equal(info.dev,owned.dev); assert.equal(info.ino,owned.ino); assert.equal(path.dirname(owned.path),await realpath(tmpdir())); assert.ok(path.basename(owned.path).startsWith('local-host-lifecycle-'));
    await rm(owned.path,{recursive:true}); report.cleanup.ownedRoot='verified-removed';
  } else if (owned) { report.cleanup.ownedRoot='retained'; failed=true; }
  if (failed && report.status==='G0-native-lifecycle-subset-passed') report.status='cleanup-failed';
  await mkdir(evidence,{recursive:true}); await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report,null,2)); process.exitCode=failed?1:0;
}
