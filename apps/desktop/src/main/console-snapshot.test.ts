import { expect, it } from 'vitest';
import { CordisRuntimeDriver, PluginManager, type RegisteredContribution } from '@pet/host-kernel';
import { consoleSnapshot } from './console-snapshot.js';
it('projects contribution labels without executable or file details', () => {
  const owner = { pluginId: 'test.visible', instanceId: 'default', generation: 2 };
  const rows: RegisteredContribution[] = [
    {
      owner,
      id: 'run',
      declaration: {
        id: 'run',
        kind: 'command',
        title: { 'zh-CN': '运行' },
        handler: 'PRIVATE_HANDLER',
      },
    },
    {
      owner,
      id: 'settings',
      declaration: {
        id: 'settings',
        kind: 'settings',
        title: { en: 'Preferences' },
        section: 'PRIVATE_SECTION',
      },
    },
    {
      owner,
      id: 'panel',
      declaration: {
        id: 'panel',
        kind: 'panel',
        title: { 'zh-CN': '面板' },
        entry: 'PRIVATE_PANEL.html',
      },
    },
  ];
  const host = {
    version: 1 as const,
    runtime: 'ready' as const,
    installedPlugins: 1,
    activePlugins: 1,
    unreadyPlugins: 0,
    pendingRestartPlugins: 0,
    runningTasks: 0,
    pendingWork: 0,
  };
  const app = {
    name: 'AI 桌宠',
    version: '0.0.0',
    electron: '45',
    node: '24',
    platform: 'win32-x64',
  };
  const result = consoleSnapshot(host, [], app, rows);
  expect(result.contributions).toEqual([
    { owner, id: 'run', kind: 'command', title: '运行' },
    { owner, id: 'settings', kind: 'settings', title: 'Preferences' },
    { owner, id: 'panel', kind: 'panel', title: '面板' },
  ]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  expect(consoleSnapshot(host, [], app, []).contributions).toEqual([]);
});
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
      manager.contributions(),
    );
    expect(result.plugins[0]).toMatchObject({
      name: '示例插件',
      state: 'disabled',
      desiredActive: false,
      origin: 'user',
      protected: false,
      permissions: [{ kind: 'credentials', keys: ['key-reference'] }],
    });
    expect(Object.keys(result.plugins[0]!).sort()).toEqual([
      'desiredActive',
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
    await manager.enable({ pluginId: 'test.console-view', instanceId: 'default' });
    const enabled = consoleSnapshot(
      { ...result.host, activePlugins: 1 },
      manager.list(),
      result.app,
      manager.contributions(),
    );
    expect(enabled.plugins[0]).toMatchObject({ state: 'active', desiredActive: true });
  } finally {
    await manager.shutdown();
    await driver.dispose();
  }
});
