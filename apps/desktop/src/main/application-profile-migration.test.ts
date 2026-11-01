import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonObject, PluginManifest } from '@pet/contracts';
import { APPLICATION_DEFAULTS } from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import { ConfigService, MemoryConfigStore } from '@pet/host-kernel';
import profile from '../../../../plugins/profile/src/index.js';
import type { DesktopHost } from './desktop-host.js';
import { migrateApplicationProfile } from './application-profile-migration.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const identity = { pluginId: 'pet.profile', instanceId: 'default' };
const stops: (() => void)[] = [];
afterEach(() => {
  for (const close of stops.splice(0)) close();
});
async function fixture() {
  const parsed = validateManifest(
    JSON.parse(await readFile(path.join(root, 'plugins/profile/plugin.json'), 'utf8')),
  );
  if (!parsed.ok || !parsed.value.config) throw new Error('Invalid profile fixture manifest');
  const manifest = parsed.value;
  const props = parsed.value.config.schema['properties'] as JsonObject;
  const fields = [
    'petName',
    'userName',
    'personaPrompt',
    'replyLanguage',
    'style',
    'figure',
    'palette',
    'size',
    'visible',
    'alwaysOnTop',
    'draggable',
    'reducedMotion',
    'voiceEnabled',
  ];
  const old: PluginManifest = {
    ...manifest,
    config: {
      version: 1,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: fields,
        properties: Object.fromEntries(fields.map((field) => [field, props[field]])) as JsonObject,
      },
      apply: { personaPrompt: 'reload' },
    },
  };
  const store = new MemoryConfigStore(),
    legacy = new ConfigService(store),
    configs = new ConfigService(store);
  stops.push(() => {
    legacy.close();
    configs.close();
  });
  expect(legacy.register(identity, old).ok).toBe(true);
  const initial = await legacy.initialize(identity);
  if (!initial.ok) throw new Error('Invalid old fixture defaults');
  const data = {
    ...initial.value.data,
    petName: 'preserved pet',
    userName: 'preserved user',
    personaPrompt: 'preserved private prompt fixture',
    visible: false,
    voiceEnabled: false,
    reducedMotion: true,
  };
  const saved = await legacy.save(identity, data, initial.value.revision);
  if (!saved.ok) throw new Error('Invalid old fixture values');
  expect(configs.register(identity, manifest).ok).toBe(true);
  expect(await configs.initialize(identity)).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
  const owner = { ...identity, generation: 1 },
    lifetime = new AbortController(),
    verify = vi.fn(async () => true);
  const migrate = vi.fn(
    async (
      _activation: unknown,
      request: Parameters<NonNullable<typeof profile.migrateConfig>>[0],
    ) => {
      if (!profile.migrateConfig) throw new Error('Missing declared profile migrator');
      return profile.migrateConfig(request);
    },
  );
  const source = {
    origin: 'builtin',
    directory: path.join(root, 'plugins/profile'),
    manifest,
    files: [],
  };
  const review = { trusted: true, digest: 'reviewed-exact-fixture-source' };
  const enable = vi.fn();
  const host = {
    configs,
    manager: {
      get: () => ({ owner, manifest, state: 'disabled' }),
      ownerSignal: () => lifetime.signal,
      enable,
    },
    getPackage: () => source,
    describeTrust: () => review,
    verifyTrust: verify,
    driver: { migrateConfig: migrate },
  } as unknown as DesktopHost;
  Object.defineProperty(host, 'credentials', {
    get: () => {
      throw new Error('Migration must not access the credential vault');
    },
  });
  return {
    host,
    store,
    configs,
    legacy,
    data,
    revision: saved.value.snapshot.revision,
    migrate,
    verify,
    review,
    enable,
  };
}
it('upgrades actual profile1to2 through canonical CAS before activation and preserves every saved field', async () => {
  const f = await fixture();
  expect(await migrateApplicationProfile(f.host)).toEqual({ ok: true, value: null });
  const current = await f.configs.get(identity);
  if (!current.ok) throw new Error('Migration did not publish a readable profile');
  expect(current.value.schemaVersion).toBe(2);
  expect(current.value.revision).toBe(f.revision + 1);
  for (const [field, value] of Object.entries(f.data))
    expect(current.value.data[field]).toEqual(value);
  expect(current.value.data['hover']).toEqual(APPLICATION_DEFAULTS.hover);
  expect(current.value.data['speechProvider']).toEqual(APPLICATION_DEFAULTS.speechProvider);
  expect(f.enable).not.toHaveBeenCalled();
  expect(f.configs.diagnostics().migrations).toBe(0);
  expect(await migrateApplicationProfile(f.host)).toEqual({ ok: true, value: null });
  expect(f.migrate).toHaveBeenCalledOnce();
});
it.each(['unreviewed', 'changed'] as const)(
  'does not execute a profile migration from %s source',
  async (mode) => {
    const f = await fixture();
    if (mode === 'unreviewed') f.review.trusted = false;
    else f.verify.mockResolvedValue(false);
    expect(await migrateApplicationProfile(f.host)).toMatchObject({
      ok: false,
      error: { code: 'package-changed' },
    });
    expect(f.migrate).not.toHaveBeenCalled();
    expect(await f.store.read(identity)).toMatchObject({
      schemaVersion: 1,
      revision: f.revision,
      data: f.data,
    });
  },
);
it('leaves the old profile intact when its declared migration fails', async () => {
  const f = await fixture();
  f.migrate.mockRejectedValue(new Error('synthetic migration failure'));
  expect(await migrateApplicationProfile(f.host)).toMatchObject({
    ok: false,
    error: { code: 'internal' },
  });
  expect(await f.store.read(identity)).toMatchObject({
    schemaVersion: 1,
    revision: f.revision,
    data: f.data,
  });
  expect(f.configs.diagnostics().migrations).toBe(0);
});
it('does not overwrite an intervening profile save when migration CAS loses its revision', async () => {
  const f = await fixture();
  f.migrate.mockImplementationOnce(async (_activation, request) => {
    const changed = await f.legacy.save(
      identity,
      { ...f.data, petName: 'intervening saved name' },
      f.revision,
    );
    expect(changed.ok).toBe(true);
    if (!profile.migrateConfig) throw new Error('Missing profile migrator');
    return profile.migrateConfig(request);
  });
  expect(await migrateApplicationProfile(f.host)).toMatchObject({
    ok: false,
    error: { code: 'not-ready' },
  });
  expect(await f.store.read(identity)).toMatchObject({
    schemaVersion: 1,
    revision: f.revision + 1,
    data: { ...f.data, petName: 'intervening saved name' },
  });
  expect(f.configs.diagnostics().migrations).toBe(0);
});
