import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { QQ_OFFICIAL_PLUGIN_ID, type PluginManifest } from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import { CompanionPluginHost, packageFingerprint } from './plugin-host.js';
import { withSourceAuthority } from './source-authority.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const identity = { pluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' };
const permission = { kind: 'files', scope: 'plugin-data', access: 'read' } as const;
async function fixture(sourceTrust?: 'review' | 'preapproved') {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-local-trust-test-'));
  const directory = path.join(root, 'source');
  await mkdir(directory);
  const manifest = JSON.parse(
    await readFile(new URL('../../../plugins/qq-official/plugin.json', import.meta.url), 'utf8'),
  ) as PluginManifest;
  await writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(root, 'data'),
    ...(sourceTrust ? { sourceTrust } : {}),
    plugins: [
      {
        manifest,
        directory,
        enabled: false,
        preset: 'deny',
        hostCredentials: ['qq-official-app-secret'],
        definition: definePlugin({
          activate(context) {
            context.provide('official', { describe: async () => null });
          },
        }),
      },
    ],
  });
  cleanups.push(async () => {
    await host.close();
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-local-trust-test-')
    )
      throw new Error('wrong test root');
    await rm(target, { recursive: true });
  });
  return { host, directory };
}
it('retains the service default preapproval without changing the declared preset', async () => {
  const { host, directory } = await fixture();
  expect(host.permissions.isTrusted(identity, packageFingerprint(directory))).toBe(true);
  expect(host.permissionControl.inspect(identity)?.preset).toBe('deny');
  await host.setEnabled(identity.pluginId, true);
  await expect(
    withSourceAuthority(host, identity.pluginId, [permission], async () => 'not allowed'),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
});
it('requires explicit reviewed trust and preserves deny until the owner changes it', async () => {
  const { host, directory } = await fixture('review');
  const digest = packageFingerprint(directory);
  expect(host.permissions.isTrusted(identity, digest)).toBe(false);
  await expect(host.setEnabled(identity.pluginId, true)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(host.permissionControl.confirmTrust(identity, '0'.repeat(64), true)).toBe(false);
  expect(host.permissionControl.confirmTrust(identity, digest, true)).toBe(true);
  expect(host.permissionControl.inspect(identity)?.preset).toBe('deny');
  await host.setEnabled(identity.pluginId, true);
  await expect(
    withSourceAuthority(host, identity.pluginId, [permission], async () => 'not allowed'),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(host.permissionControl.setPreset(identity, 'allow')).toBe(true);
  expect(
    await withSourceAuthority(host, identity.pluginId, [permission], async () => 'authorized'),
  ).toBe('authorized');
  await writeFile(path.join(directory, 'new-code.txt'), 'changed');
  expect(host.permissions.isTrusted(identity, digest)).toBe(false);
  await expect(
    withSourceAuthority(host, identity.pluginId, [permission], async () => 'should not run'),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(host.permissions.diagnostics().leases).toBe(0);
});
