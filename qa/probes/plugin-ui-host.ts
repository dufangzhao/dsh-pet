import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSOLE_IPC } from '../../packages/contracts/src/index.js';
import { discoverPlugins } from '../../packages/host-kernel/src/index.js';
import { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
import { ConsoleWindow } from '../../apps/desktop/src/main/windows/console-window.js';
import { consoleSnapshot } from '../../apps/desktop/src/main/console-snapshot.js';
import { handleConsoleRequest } from '../../apps/desktop/src/main/console-request.js';
import { handleConsoleConfigRequest } from '../../apps/desktop/src/main/console-config-request.js';
import { ConsolePluginRequests } from '../../apps/desktop/src/main/console-plugin-request.js';

const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'apps/desktop/dist/renderer/console/index.html');
const preload = path.join(root, 'apps/desktop/dist/preload/index.cjs');
const userDirectory = path.join(__dirname, 'plugins');
const good = { pluginId: 'test.manage-good', instanceId: 'default' };
app.setPath('userData', path.join(__dirname, 'profile'));
app.on('window-all-closed', () => {});
void app
  .whenReady()
  .then(async () => {
    const host = await DesktopHost.create({
      executable: process.execPath,
      workerEntry: path.join(root, 'apps/desktop/dist/runtime/worker.cjs'),
      builtinDirectory: path.join(__dirname, 'builtin'),
      userDirectory,
      protectedPackages: { 'test.manage-core': path.join(__dirname, 'builtin/test.manage-core') },
    });
    await host.driver.ready();
    const discovered = await discoverPlugins([
      { directory: path.join(__dirname, 'builtin'), origin: 'builtin' },
      { directory: userDirectory, origin: 'user' },
    ]);
    const digests = new Map<string, string>();
    for (const plugin of discovered.plugins) {
      const identity = { pluginId: plugin.manifest.id, instanceId: 'default' };
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            origin: plugin.origin,
            directory: plugin.directory,
            files: plugin.files,
          }),
        )
        .digest('hex');
      digests.set(identity.pluginId, digest);
      // Only this fixture explicitly pre-approves its own known packages, never the UI.
      if (
        identity.pluginId !== 'test.manage-blocked' &&
        !host.permissionControl.confirmTrust(identity, digest, true)
      )
        throw new Error('Fixture trust failed');
    }
    const core = await host.manager.enable({ pluginId: 'test.manage-core', instanceId: 'default' });
    if (!core.ok || core.value.state !== 'active') throw new Error('Core fixture failed');
    await fs.writeFile(path.join(__dirname, 'plugin-data/retained.txt'), 'fixture-data');
    await fs.mkdir(path.join(__dirname, 'vault'), { recursive: true });
    await fs.writeFile(path.join(__dirname, 'vault/retained.txt'), 'fixture-vault-marker');
    const settings = new ConsoleWindow(entry, preload);
    let snapshotFails = false,
      snapshotCalls = 0,
      actionCalls = 0,
      loseNextReply = false;
    let gate: Promise<void> | undefined, release: (() => void) | undefined;
    let foreign: BrowserWindow | undefined;
    const snapshot = () =>
      consoleSnapshot(
        host.status(),
        host.manager.list(),
        {
          name: 'AI 桌宠',
          version: '0.0.0',
          electron: process.versions.electron!,
          node: process.versions.node,
          platform: process.platform + '-' + process.arch,
        },
        host.manager.contributions(),
      );
    const source = (event: IpcMainInvokeEvent) => ({
      senderId: event.sender.id,
      expectedId: settings.current?.webContents.id ?? -1,
      mainFrame:
        event.senderFrame !== null && event.senderFrame === settings.current?.webContents.mainFrame,
      frameUrl: event.senderFrame?.url ?? '',
      expectedUrl: pathToFileURL(entry).href,
    });
    const requests = new ConsolePluginRequests(host, snapshot);
    ipcMain.handle(CONSOLE_IPC.snapshot, (event, ...args: unknown[]) =>
      handleConsoleRequest(source(event), args, () => {
        snapshotCalls++;
        if (snapshotFails) throw new Error('Injected snapshot failure');
        return snapshot();
      }),
    );
    ipcMain.handle(CONSOLE_IPC.stopAll, (event, ...args: unknown[]) =>
      handleConsoleRequest(source(event), args, () => host.stopAll()),
    );
    ipcMain.handle(CONSOLE_IPC.pluginAction, async (event, ...args: unknown[]) => {
      actionCalls++;
      if (gate) await gate;
      const result = await requests.handle(source(event), args);
      if (loseNextReply) {
        loseNextReply = false;
        throw new Error('Injected lost reply after operation');
      }
      return result;
    });
    for (const [channel, action] of [
      [CONSOLE_IPC.inspectConfig, 'inspect'],
      [CONSOLE_IPC.saveConfig, 'save'],
    ] as const)
      ipcMain.handle(channel, (event, ...args: unknown[]) =>
        handleConsoleConfigRequest(source(event), action, args, host),
      );
    Object.assign(globalThis, {
      m2PluginQA: {
        host,
        settings,
        snapshot,
        setSnapshotFailure(value: boolean) {
          snapshotFails = value;
        },
        loseNextReply() {
          loseNextReply = true;
        },
        holdAction() {
          gate = new Promise<void>((resolve) => {
            release = resolve;
          });
        },
        releaseAction() {
          release?.();
          release = undefined;
          gate = undefined;
        },
        async hideGoodPackage() {
          await fs.rename(
            path.join(userDirectory, good.pluginId),
            path.join(__dirname, 'held-good'),
          );
        },
        async restoreGoodPackage() {
          await fs.rename(
            path.join(__dirname, 'held-good'),
            path.join(userDirectory, good.pluginId),
          );
        },
        diagnostics() {
          return {
            snapshotCalls,
            actionCalls,
            snapshot: snapshot(),
            goodTrusted: host.permissions.isTrusted(good, digests.get(good.pluginId)!),
            blockedTrusted: host.permissions.isTrusted(
              { pluginId: 'test.manage-blocked', instanceId: 'default' },
              digests.get('test.manage-blocked')!,
            ),
          };
        },
        retainedConfig() {
          return host.configs.get(good);
        },
        async rescan() {
          return (
            await discoverPlugins([{ directory: userDirectory, origin: 'user' }])
          ).plugins.map((p) => p.manifest.id);
        },
        async foreignWindow() {
          foreign = new BrowserWindow({
            show: false,
            webPreferences: {
              preload,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          await foreign.loadFile(entry);
        },
        closeForeign() {
          foreign?.destroy();
          foreign = undefined;
        },
        async shutdown() {
          release?.();
          foreign?.destroy();
          settings.close();
          return host.shutdown();
        },
      },
    });
    await settings.open();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
