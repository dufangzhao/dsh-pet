import { expect, it } from 'vitest';
import { CordisRuntimeDriver, PluginManager } from '@pet/host-kernel';
import { consoleSnapshot } from './console-snapshot.js';
it('projects plugin metadata without entry paths or configuration', async () => {
  const driver = new CordisRuntimeDriver(async () => ({ activate() {} })),
    manager = new PluginManager({
      driver,
      hostApiVersion: '1.0.0',
      platform: 'win32-x64',
      trust: async () => true,
      readiness: async () => null,
    });
  try {
    const installed = manager.install(
      {
        schemaVersion: 1,
        id: 'test.console-view',
        version: '1.0.0',
        displayName: { 'zh-CN': '示例插件' },
        description: { 'zh-CN': '显示用' },
        license: 'MIT',
        host: '^1.0.0',
        platforms: ['win32-x64'],
        entries: { runtime: 'private-entry.mjs' },
        permissions: [{ kind: 'credentials', keys: ['key-reference'] }],
      },
      { origin: 'user', directory: 'C:/PRIVATE_INSTALLATION' },
    );
    expect(installed.ok).toBe(true);
    const result = consoleSnapshot(
      {
        version: 1,
        runtime: 'ready',
        installedPlugins: 1,
        activePlugins: 0,
        unreadyPlugins: 0,
        pendingRestartPlugins: 0,
        runningTasks: 0,
        pendingWork: 0,
      },
      manager.list(),
      { name: 'AI 桌宠', version: '0.0.0', electron: '45', node: '24', platform: 'win32-x64' },
    );
    expect(result.plugins[0]).toMatchObject({
      name: '示例插件',
      state: 'disabled',
      origin: 'user',
      protected: false,
      permissions: [{ kind: 'credentials', keys: ['key-reference'] }],
    });
    expect(Object.keys(result.plugins[0]!).sort()).toEqual([
      'name',
      'origin',
      'owner',
      'permissions',
      'protected',
      'state',
      'version',
    ]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INSTALLATION');
    expect(JSON.stringify(result)).not.toContain('private-entry.mjs');
  } finally {
    await manager.shutdown();
    await driver.dispose();
  }
});
