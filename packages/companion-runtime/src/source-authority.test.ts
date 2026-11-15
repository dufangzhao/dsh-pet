import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { PermissionDeclaration, PluginManifest } from '@pet/contracts';
import { definePlugin, type PluginTask } from '@pet/plugin-sdk';
import { STATE_METHODS } from '@pet/state-sqlite';
import { companionHostDefinition, companionHostManifest } from './core-plugin.js';
import { CompanionPluginHost } from './plugin-host.js';
import { withSourceAuthority } from './source-authority.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const stateCapability = 'companion.state@1';
const sourceId = 'pet.harness-cortico';
const statePermission: PermissionDeclaration = {
  kind: 'capability-use',
  capability: stateCapability,
};
const hosts: CompanionPluginHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

async function fixture(withStateGrant = true) {
  const directory = await mkdtemp(path.join(tmpdir(), 'companion-authority-'));
  const stateManifest = JSON.parse(
    await readFile(new URL('../../../plugins/state-sqlite/plugin.json', import.meta.url), 'utf8'),
  ) as PluginManifest;
  const harnessManifest = JSON.parse(
    await readFile(
      new URL('../../../plugins/harness-cortico/plugin.json', import.meta.url),
      'utf8',
    ),
  ) as PluginManifest;
  const sourceManifest = withStateGrant
    ? harnessManifest
    : {
        ...harnessManifest,
        permissions:
          harnessManifest.permissions?.filter(
            (permission) =>
              permission.kind !== 'capability-use' || permission.capability !== stateCapability,
          ) ?? [],
      };
  const calls = vi.fn(async (_task: PluginTask) => true);
  const manifests = [companionHostManifest, stateManifest, sourceManifest];
  const plugins = await Promise.all(
    manifests.map(async (manifest) => {
      const pluginDirectory = path.join(directory, manifest.id);
      await mkdir(pluginDirectory);
      await writeFile(path.join(pluginDirectory, 'plugin.json'), JSON.stringify(manifest));
      return {
        manifest,
        directory: pluginDirectory,
        enabled: true,
        preset: 'allow' as const,
        ...(manifest.id === sourceId ? { hostCredentials: ['model-api-key'] } : {}),
        definition:
          manifest.id === companionHostManifest.id
            ? companionHostDefinition
            : definePlugin({
                activate(context) {
                  context.provide(
                    manifest.id === stateManifest.id ? 'sqlite' : 'cortico',
                    Object.fromEntries(
                      (manifest.id === stateManifest.id
                        ? STATE_METHODS
                        : ['status', 'accept', 'stopForeground']
                      ).map((method) => [method, calls]),
                    ),
                  );
                },
              }),
      };
    }),
  );
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'data'),
    plugins,
  });
  hosts.push(host);
  host.bind(stateCapability, stateManifest.id, 'sqlite');
  host.bind('companion.harness@1', sourceId, 'cortico');
  return { host, calls, directory, sourceManifest, stateManifest };
}

it('requires the source grant before entering a host-owned port', async () => {
  const { host, calls } = await fixture(false);
  const operation = vi.fn(async () => host.call(stateCapability, 'snapshot', null));
  await expect(
    withSourceAuthority(host, sourceId, [statePermission], operation),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(operation).not.toHaveBeenCalled();
  expect(calls).not.toHaveBeenCalled();
  expect(host.permissions.diagnostics().leases).toBe(0);
});

it('preserves private returns and original errors without putting them in supervisor results', async () => {
  const { host } = await fixture();
  const value = { privateValue: new Uint8Array(70000) };
  expect(await withSourceAuthority(host, sourceId, [statePermission], async () => value)).toBe(
    value,
  );
  const error = Object.assign(new Error('native generation interrupted'), { partial: value });
  await expect(
    withSourceAuthority(host, sourceId, [statePermission], async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(host.permissions.diagnostics().leases).toBe(0);
});

it('waits for actual cleanup after revocation and retains the original partial error', async () => {
  const { host } = await fixture();
  const started = deferred();
  const aborted = deferred();
  const cleanup = deferred();
  const error = Object.assign(new Error('native interrupted'), {
    partial: { output: ['retained'] },
  });
  let finished = false;
  const running = withSourceAuthority(host, sourceId, [statePermission], async (signal) => {
    started.resolve();
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        'abort',
        () => {
          aborted.resolve();
          resolve();
        },
        { once: true },
      ),
    );
    await cleanup.promise;
    throw error;
  });
  const observed = running.then(
    () => {
      finished = true;
    },
    (failure: unknown) => {
      finished = true;
      return failure;
    },
  );
  await started.promise;
  expect(host.permissionControl.revoke({ pluginId: sourceId, instanceId: 'default' })).toBe(true);
  await aborted.promise;
  expect(finished).toBe(false);
  cleanup.resolve();
  expect(await observed).toBe(error);
  expect(host.tasks.diagnostics().pendingWork).toBe(0);
  expect(host.permissions.diagnostics().leases).toBe(0);
});

it.each([
  ['pet.state-sqlite', stateCapability, 'snapshot'],
  ['pet.state-sqlite', stateCapability, 'acceptMessage'],
  [sourceId, 'companion.harness@1', 'status'],
  [sourceId, 'companion.harness@1', 'accept'],
  [sourceId, 'companion.harness@1', 'stopForeground'],
])('enforces provider policy for %s.%s/%s', async (pluginId, capability, method) => {
  const { host, calls } = await fixture();
  expect(await host.call(capability, method, null)).toBe(true);
  expect(calls).toHaveBeenCalledOnce();
  expect(host.permissionControl.setPreset({ pluginId, instanceId: 'default' }, 'deny')).toBe(true);
  await expect(host.call(capability, method, null)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(calls).toHaveBeenCalledOnce();
});

it('pins all state method leases to the reviewed provider source', async () => {
  const { host, calls, directory, stateManifest } = await fixture();
  for (const method of STATE_METHODS)
    expect(await host.call(stateCapability, method, null)).toBe(true);
  expect(calls).toHaveBeenCalledTimes(STATE_METHODS.length);
  await writeFile(path.join(directory, stateManifest.id, 'changed.txt'), 'unreviewed code');
  for (const method of STATE_METHODS)
    await expect(host.call(stateCapability, method, null)).rejects.toMatchObject({
      error: { code: 'permission-denied' },
    });
  expect(calls).toHaveBeenCalledTimes(STATE_METHODS.length);
});

it('revoking a provider cancels real capability work without waiting for logical cleanup', async () => {
  const { host, calls } = await fixture();
  const entered = deferred();
  const aborted = deferred();
  const cleanup = deferred();
  calls.mockImplementationOnce(async (context) => {
    entered.resolve();
    await new Promise<void>((resolve) =>
      context.signal.addEventListener(
        'abort',
        () => {
          aborted.resolve();
          resolve();
        },
        { once: true },
      ),
    );
    await cleanup.promise;
    return true;
  });
  const handle = host.runCapability(stateCapability, 'snapshot', null);
  await entered.promise;
  host.permissionControl.revoke({ pluginId: 'pet.state-sqlite', instanceId: 'default' });
  await aborted.promise;
  try {
    expect(await handle.result).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    expect(handle.snapshot().workPending).toBe(true);
  } finally {
    cleanup.resolve();
    await handle.settled;
  }
  expect(host.permissions.diagnostics().leases).toBe(0);
});
