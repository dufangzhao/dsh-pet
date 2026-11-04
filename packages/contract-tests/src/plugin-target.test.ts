import { expect, it } from 'vitest';
import path from 'node:path';
import { PluginManager, CordisRuntimeDriver } from '@pet/host-kernel';
import { makeError, type PluginManifest } from '@pet/contracts';
it('keeps the requested enable target separate from readiness and runtime failure', async () => {
  let ready = false;
  const driver = new CordisRuntimeDriver(async () => ({ activate() {} }));
  const manager = new PluginManager({
    driver,
    hostApiVersion: '1.0.0',
    platform: 'win32-x64',
    trust: async () => true,
    readiness: async () => (ready ? null : makeError('not-ready')),
  });
  const manifest: PluginManifest = {
    schemaVersion: 1,
    id: 'test.target',
    version: '1.0.0',
    displayName: { en: 'Target' },
    description: { en: 'Target' },
    license: 'MIT',
    host: '^1.0.0',
    platforms: ['win32-x64'],
    entries: { runtime: 'entry.mjs' },
  };
  const id = { pluginId: manifest.id, instanceId: 'default' };
  try {
    expect(
      manager.install(manifest, {
        directory: path.resolve('.fixture-not-imported'),
        origin: 'user',
      }).ok,
    ).toBe(true);
    expect(manager.get(id)).toMatchObject({ state: 'disabled', desiredActive: false });
    await manager.enable(id);
    expect(manager.get(id)).toMatchObject({ state: 'unready', desiredActive: true });
    await manager.disable(id);
    expect(manager.get(id)).toMatchObject({ state: 'disabled', desiredActive: false });
    ready = true;
    await manager.enable(id);
    const active = manager.get(id);
    if (!active) throw new Error('Missing runtime');
    expect(active).toMatchObject({ state: 'active', desiredActive: true });
    await manager.reportFault(active.owner);
    expect(manager.get(id)).toMatchObject({ state: 'failed', desiredActive: true });
    await manager.disable(id);
    expect(manager.get(id)).toMatchObject({ state: 'disabled', desiredActive: false });
  } finally {
    await manager.shutdown();
    await driver.dispose();
  }
});
