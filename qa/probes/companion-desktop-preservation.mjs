// Focused real startup preservation and token boundary evidence; no user profile is read.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';
import { register } from 'tsx/esm/api';
import { startDisplay } from '../fixtures/companion-desktop/display.mjs';
import { startService } from '../fixtures/companion-desktop/service.mjs';
import { startFaultProxy } from '../fixtures/companion-desktop/fault-proxy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = path.join(root, '.companion-data/tooling/desktop/electron-45/electron');
const files = ['qa/probes/companion-desktop-preservation.mjs', 'qa/fixtures/companion-desktop/display.mjs',
  'qa/fixtures/companion-desktop/service.mjs', 'qa/fixtures/companion-desktop/fault-proxy.mjs',
  'apps/desktop/dist/main/index.mjs', 'apps/desktop/dist/preload/index.cjs', 'apps/desktop/dist/runtime/worker.cjs',
  'apps/desktop/src/main/builtin-admission.json', '.companion-data/tooling/desktop/electron-45/electron'];
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(root, file))) hash.update(chunk);
  return hash.digest('hex');
}
const fingerprints = async () => Object.fromEntries(await Promise.all(files.map(async (file) => [file, await hashFile(file)])));
async function scan(directory, patterns) {
  let count = 0, skippedSymlinks = 0;
  const visit = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) { skippedSymlinks++; continue; }
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile()) throw new Error('Unexpected entry in isolated profile');
      count++;
      let tail = Buffer.alloc(0);
      const overlap = Math.max(...patterns.map((value) => value.length)) - 1;
      for await (const chunk of createReadStream(file)) {
        const buffer = Buffer.concat([tail, chunk]);
        if (patterns.some((value) => buffer.includes(value))) throw new Error('Synthetic service token found in isolated profile');
        tail = buffer.subarray(Math.max(0, buffer.length - overlap));
      }
    }
  };
  await visit(directory);
  return { regularFiles: count, skippedSymlinks };
}
const report = { scope: 'isolated-legacy-preservation-token-and-stream-only', status: 'running', checks: [],
  pending: 'remaining platform-specific Windows evidence' };
let display, service, proxy, app;
let stage = 'preflight', exit = 1;
try {
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
  const before = await fingerprints();
  report.inputHashesBeforeRun = before;
  register();
  const { FileConfigStore, FileCiphertextStore } = await import('../../packages/host-kernel/src/index.ts');
  const { APPLICATION_DEFAULTS } = await import('../../packages/contracts/src/index.ts');
  const profileId = `preserve-${randomUUID()}`;
  const cache = await realpath(path.join(root, '.cache'));
  const profile = path.join(cache, `pet-demo-acceptance-${profileId}`);
  await mkdir(profile, { mode: 0o700 });
  const historyRoot = path.join(profile, 'history');
  const configRoot = path.join(profile, 'configuration');
  const vaultRoot = path.join(profile, 'vault');
  for (const directory of [historyRoot, configRoot, vaultRoot]) await mkdir(directory, { mode: 0o700 });
  const historyId = { pluginId: 'pet.voice-chat', instanceId: 'default' };
  const profileIdentity = { pluginId: 'pet.profile', instanceId: 'default' };
  const historyText = `synthetic-old-history-${randomUUID()}`;
  const history = new FileConfigStore(historyRoot);
  assert.equal(await history.compareAndSet(historyId, null, { format: 1, ...historyId,
    schemaVersion: 1, revision: 1, data: { messages: [{ id: 'old-1', role: 'user', text: historyText, mode: 'demo', at: 1 }] } }), true);
  const archived = new FileConfigStore(configRoot);
  const oldPersona = { ...structuredClone(APPLICATION_DEFAULTS), petName: 'Synthetic Archived Pet',
    personaPrompt: 'Synthetic archived persona, not a service identity.' };
  assert.equal(await archived.compareAndSet(profileIdentity, null, { format: 1, ...profileIdentity,
    schemaVersion: 2, revision: 1, data: oldPersona }), true);
  const vault = new FileCiphertextStore(vaultRoot);
  const vaultKey = JSON.stringify(['pet.llm-provider', 'default', 'api-key']);
  await vault.write(vaultKey, Buffer.from('synthetic-ciphertext-bytes'));
  const onlyFile = async (directory, extension) => {
    const entries = (await readdir(directory)).filter((name) => name.endsWith(extension));
    assert.equal(entries.length, 1);
    return path.join(directory, entries[0]);
  };
  const seeded = [await onlyFile(historyRoot, '.config.json'), await onlyFile(configRoot, '.config.json'),
    await onlyFile(vaultRoot, '.sealed')];
  const original = await Promise.all(seeded.map((file) => readFile(file)));
  const isolatedHome = await mkdtemp(path.join(os.tmpdir(), 'companion-desktop-preserve-home-'));
  display = await startDisplay(root);
  service = await startService(process.env.PET_CLOUD_EXEC_IMAGE);
  proxy = await startFaultProxy(service.url);
  const env = { ...display.env, HOME: isolatedHome, XDG_CONFIG_HOME: path.join(isolatedHome, 'config'),
    XDG_CACHE_HOME: path.join(isolatedHome, 'cache'), XDG_DATA_HOME: path.join(isolatedHome, 'data') };
  stage = 'shared-startup';
  app = await _electron.launch({ executablePath: electron, env,
    args: ['--no-sandbox', path.join(root, 'apps/desktop'), `--demo-acceptance=${profileId}`, '--show-settings'], timeout: 30000 });
  await expect.poll(() => app.windows().filter((item) => item.url().startsWith('file:')).length,
    { timeout: 30000 }).toBe(2);
  const page = app.windows().find((item) => item.url().endsWith('/console/index.html'));
  assert.ok(page);
  const host = await page.evaluate(() => window.petConsole.getSnapshot());
  assert.equal(host.ok, true);
  assert.equal(host.value.app.platform, 'linux-x64');
  for (const id of ['pet.agent-cortico', 'pet.llm-provider', 'pet.chat', 'pet.voice-chat',
    'pet.asr-local', 'pet.asr-cloud', 'pet.audio-capture', 'pet.talk-key'])
    assert.notEqual(host.value.plugins.find((entry) => entry.owner.pluginId === id)?.state, 'active');
  report.checks.push('actual-shared-startup-does-not-activate-legacy-roles');
  stage = 'connect-and-offline';
  await page.getByTestId('start-address').fill(proxy.url);
  await page.getByTestId('start-ask-token').click();
  await page.getByTestId('start-token').fill(service.token);
  await page.getByTestId('start-connect').click();
  const state = async () => {
    const value = await page.evaluate(() => window.petCompanion.getState());
    assert.equal(value.ok, true); return value.value;
  };
  await expect.poll(async () => (await state()).phase, { timeout: 30000 }).toBe('live');
  const live = await state();
  assert.ok(live.connectionId && live.snapshot);
  assert.notEqual(live.snapshot.agent.name, oldPersona.petName);
  assert.equal(live.snapshot.messages.some((message) => message.text === historyText), false);
  await expect.poll(() => proxy.streamCount(), { timeout: 15000 }).toBe(1);
  proxy.endStreams();
  await expect.poll(async () => (await state()).phase, { timeout: 15000 }).toBe('offline');
  const offline = await state();
  assert.equal(offline.connectionId, live.connectionId);
  assert.equal(offline.snapshot.agent.id, live.snapshot.agent.id);
  assert.ok(typeof offline.confirmedAt === 'number' && typeof live.confirmedAt === 'number' &&
    offline.confirmedAt >= live.confirmedAt, 'offline state must retain its latest confirmed timestamp');
  await expect(page.getByTestId('start-reconnect')).toBeVisible();
  await page.getByTestId('start-reconnect').click();
  await expect.poll(async () => (await state()).phase, { timeout: 30000 }).toBe('live');
  assert.equal((await state()).snapshot.agent.id, live.snapshot.agent.id);
  report.checks.push('real-stream-loss-retains-confirmed-state-and-manual-reconnect');
  stage = 'exit-and-byte-check';
  await app.close(); app = undefined;
  for (let i = 0; i < seeded.length; i++) assert.deepEqual(await readFile(seeded[i]), original[i]);
  const checkedHistory = await history.read(historyId);
  const checkedProfile = await archived.read(profileIdentity);
  assert.equal(checkedHistory.data.messages[0].text, historyText);
  assert.equal(checkedProfile.data.petName, oldPersona.petName);
  assert.equal(checkedProfile.data.personaPrompt, oldPersona.personaPrompt);
  report.seeded = { history: 'FileConfigStore schema1 voice-chat', persona: 'FileConfigStore schema2 profile',
    vault: 'FileCiphertextStore sealed envelope with synthetic opaque bytes', byteIdentical: true };
  report.checks.push('isolated-synthetic-history-persona-vault-bytes-preserved');
  const token = service.token;
  const patterns = [token, encodeURIComponent(token), Buffer.from(token).toString('base64'),
    JSON.stringify(token).slice(1, -1)].map((value) => Buffer.from(value));
  report.tokenScan = await scan(profile, patterns);
  report.checks.push('synthetic-service-token-absent-from-isolated-desktop-regular-files');
  assert.deepEqual(await fingerprints(), before, 'input/build changed during preservation run');
  report.limit = 'Linux rejects Windows-only profile role; this is an isolated byte-preservation check, not Windows local profile/audio integration or proof that opaque synthetic vault data decrypts.';
  report.status = 'preservation-subset-passed'; exit = 0;
} catch (error) {
  let detail = error instanceof Error ? error.message : 'Non-error failure';
  for (const secret of [service?.token].filter(Boolean))
    for (const value of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), JSON.stringify(secret).slice(1, -1)])
      detail = detail.split(value).join('[redacted]');
  report.status = 'preservation-subset-failed'; report.failure = `${stage}: ${detail.slice(0, 1200)}`;
} finally {
  try { await app?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await proxy?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await service?.close(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  try { await display?.stop(); } catch { exit = 1; report.status = 'cleanup-failed'; }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
