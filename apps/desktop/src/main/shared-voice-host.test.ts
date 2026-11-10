import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginManifest } from '@pet/contracts';
import { DesktopHost } from './desktop-host.js';
import { SharedVoiceCaptureHost } from './shared-voice-capture-host.js';
import { mvpReadiness } from './mvp-readiness.js';
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(stopFor: () => Promise<void> = async () => {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-voice-host-'));
  cleanups.push(async () => {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('shared-voice-host-'))
      throw new Error('Unexpected fixture path');
    await rm(root, { recursive: true });
  });
  const builtin = path.join(root, 'builtin');
  const users = path.join(root, 'users');
  await mkdir(builtin);
  await mkdir(users);
  for (const plugin of ['audio-capture', 'companion-client']) {
    const manifest = JSON.parse(
      await readFile(new URL(`../../../../plugins/${plugin}/plugin.json`, import.meta.url), 'utf8'),
    ) as PluginManifest;
    const directory = path.join(builtin, plugin);
    await mkdir(directory);
    await writeFile(
      path.join(directory, 'plugin.json'),
      JSON.stringify({ ...manifest, entries: { runtime: 'entry.mjs' } }),
    );
    const provider = plugin === 'audio-capture' ? 'renderer' : 'client';
    await writeFile(
      path.join(directory, 'entry.mjs'),
      `export default {activate(ctx){ctx.provide('${provider}',{describe:async()=>null});return async()=>{};}};`,
    );
  }
  const worker = path.join(root, 'worker.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../runtime/worker.ts', import.meta.url))],
    outfile: worker,
    platform: 'node',
    format: 'cjs',
    bundle: true,
    target: 'node24',
    external: ['electron'],
  });
  const host = await DesktopHost.create({
    executable: process.execPath,
    workerEntry: worker,
    builtinDirectory: builtin,
    userDirectory: users,
    sharedCompanion: true,
    adapters: mvpReadiness('/unused', true),
    captureLifecycle: { sourcePluginId: 'pet.audio-capture', stopFor },
  });
  cleanups.push(() => host.shutdown());
  for (const entry of host.manager.list()) {
    const trust = host.describeTrust(entry.owner);
    if (!trust) throw new Error('No source trust');
    host.permissionControl.confirmTrust(
      { pluginId: entry.owner.pluginId, instanceId: 'default' },
      trust.digest,
      true,
    );
    const identity = { pluginId: entry.owner.pluginId, instanceId: entry.owner.instanceId };
    const config = await host.configs.get(identity);
    if (!config.ok) throw new Error('No source config');
    const enabled = await host.manager.enable(identity, config.value.data);
    if (!enabled.ok) throw new Error(`${identity.pluginId}: ${JSON.stringify(enabled.error)}`);
    expect(enabled.value.state).toBe('active');
  }
  return {
    host,
    adapter: new SharedVoiceCaptureHost(host),
    id: { pluginId: 'pet.audio-capture', instanceId: 'default' },
  };
}
it('actual microphone permission/task remains physically pending after revoke until release; text source stays active', async () => {
  const { host, adapter, id } = await fixture();
  const release = deferred();
  cleanups.push(async () => {
    release.resolve();
  });
  const lease = await adapter.acquire(new AbortController().signal, release.promise);
  expect(lease.valid()).toBe(true);
  expect(host.permissions.diagnostics().leases).toBe(1);
  let settled = false;
  void lease.settled.then(() => {
    settled = true;
  });
  host.permissionControl.revoke(id);
  expect(lease.signal.aborted).toBe(true);
  expect(lease.valid()).toBe(false);
  expect(lease.sourceValid()).toBe(false);
  expect(await lease.isCurrent()).toBe(false);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(host.manager.get({ pluginId: 'pet.companion-client', instanceId: 'default' })?.state).toBe(
    'active',
  );
  release.resolve();
  await lease.settled;
  expect(host.permissions.diagnostics().leases).toBe(0);
  expect(host.tasks.diagnostics().pendingWork).toBe(0);
}, 30000);
it('capture source disable joins Main release and real worker disposal without disabling text', async () => {
  const mainDrain = deferred();
  let called = false;
  const { host, adapter, id } = await fixture(async () => {
    called = true;
    await mainDrain.promise;
  });
  const release = deferred();
  cleanups.push(async () => {
    release.resolve();
    mainDrain.resolve();
  });
  const lease = await adapter.acquire(new AbortController().signal, release.promise);
  const disable = host.manager.disable(id);
  await vi.waitFor(() => expect(called).toBe(true));
  expect(lease.signal.aborted).toBe(true);
  expect(host.manager.get(id)?.state).toBe('deactivating');
  expect(host.manager.get({ pluginId: 'pet.companion-client', instanceId: 'default' })?.state).toBe(
    'active',
  );
  release.resolve();
  await lease.settled;
  expect(host.manager.get(id)?.state).toBe('deactivating');
  mainDrain.resolve();
  await disable;
  expect(host.manager.get(id)?.state).toBe('disabled');
  expect(host.tasks.diagnostics().pendingWork).toBe(0);
}, 30000);
it('rejected Main capture cleanup preserves pending_restart and rejects reacquiring a mic task', async () => {
  const { host, adapter, id } = await fixture(async () => {
    throw new Error('controlled cleanup failure');
  });
  await host.manager.disable(id);
  expect(host.manager.get(id)?.state).toBe('pending_restart');
  await expect(adapter.acquire(new AbortController().signal, Promise.resolve())).rejects.toThrow();
  expect(host.permissions.diagnostics().leases).toBe(0);
  expect(host.manager.get({ pluginId: 'pet.companion-client', instanceId: 'default' })?.state).toBe(
    'active',
  );
}, 30000);
