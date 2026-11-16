import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { PluginManifest } from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import { CompanionPluginHost } from './plugin-host.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(protectedPackage: boolean) {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-plugin-platform-test-'));
  const directory = path.join(root, 'source');
  await mkdir(directory);
  const manifest = JSON.parse(
    await readFile(new URL('../../../plugins/qq-official/plugin.json', import.meta.url), 'utf8'),
  ) as PluginManifest;
  const current = `${process.platform}-${process.arch}`;
  const foreign =
    (['linux-x64', 'win32-x64', 'darwin-arm64'] as const).find((item) => item !== current) ??
    'linux-x64';
  const unavailable: PluginManifest = {
    ...manifest,
    id: 'pet.test-foreign-platform',
    platforms: [foreign],
  };
  await writeFile(path.join(directory, 'plugin.json'), JSON.stringify(unavailable));
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return { root, directory, manifest: unavailable, protectedPackage };
}

it('keeps a host alive when an optional package cannot run on this platform', async () => {
  const { root, directory, manifest } = await fixture(false);
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(root, 'data'),
    plugins: [
      {
        manifest,
        directory,
        enabled: true,
        preset: 'allow',
        definition: definePlugin({
          activate(context) {
            context.provide('foreign-only', { describe: async () => null });
          },
        }),
      },
    ],
  });
  cleanups.push(async () => {
    await host.close();
  });
  const identity = { pluginId: manifest.id, instanceId: 'default' };
  expect(host.isUnavailable(manifest.id)).toBe(true);
  expect(host.isEnabled(manifest.id)).toBe(false);
  expect(host.views().find((view) => view.id === manifest.id)?.state).toBe('rejected');
  // The configuration surface stays readable so the service can report the
  // capability as unavailable instead of failing during composition.
  expect((await host.configs.get(identity)).ok).toBe(true);
  await expect(host.setEnabled(manifest.id, true)).rejects.toMatchObject({
    error: { code: 'not-ready' },
  });
});

it('still fails closed when a protected package cannot run on this platform', async () => {
  const { root, directory, manifest } = await fixture(true);
  await expect(
    CompanionPluginHost.create({
      dataDirectory: path.join(root, 'data'),
      plugins: [
        {
          manifest,
          directory,
          enabled: false,
          preset: 'allow',
          protected: true,
          definition: definePlugin({
            activate(context) {
              context.provide('foreign-only', { describe: async () => null });
            },
          }),
        },
      ],
    }),
  ).rejects.toMatchObject({ error: { code: 'not-ready' } });
});
