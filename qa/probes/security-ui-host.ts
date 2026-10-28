import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSOLE_IPC } from '../../packages/contracts/src/index.js';
import {
  capabilityPermissionAuthorizer,
  type TaskHandle,
} from '../../packages/host-kernel/src/index.js';
import { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
import { ConsoleWindow } from '../../apps/desktop/src/main/windows/console-window.js';
import { consoleSnapshot } from '../../apps/desktop/src/main/console-snapshot.js';
import { handleConsoleRequest } from '../../apps/desktop/src/main/console-request.js';
import { handleConsoleConfigRequest } from '../../apps/desktop/src/main/console-config-request.js';
import { ConsolePluginRequests } from '../../apps/desktop/src/main/console-plugin-request.js';
import { ConsoleSecurityRequests } from '../../apps/desktop/src/main/console-security-request.js';
const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'apps/desktop/dist/renderer/console/index.html');
const preload = path.join(root, 'apps/desktop/dist/preload/index.cjs');
const identity = { pluginId: 'test.security', instanceId: 'default' };
app.setPath('userData', path.join(__dirname, 'profile'));
app.on('window-all-closed', () => {});
void app
  .whenReady()
  .then(async () => {
    const host = await DesktopHost.create({
      executable: process.execPath,
      workerEntry: path.join(root, 'apps/desktop/dist/runtime/worker.cjs'),
      builtinDirectory: path.join(__dirname, 'builtin'),
      userDirectory: path.join(__dirname, 'plugins'),
      approvalTimeoutMs: 5000,
    });
    await host.driver.ready();
    const settings = new ConsoleWindow(entry, preload, () => host.approvals.clear());
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
    const notify = () => {
      const window = settings.current;
      if (window && !window.isDestroyed()) window.webContents.send(CONSOLE_IPC.securityChanged);
    };
    const security = new ConsoleSecurityRequests(host, snapshot, notify),
      plugins = new ConsolePluginRequests(host, snapshot);
    host.approvals.subscribe(notify);
    ipcMain.handle(CONSOLE_IPC.snapshot, (event, ...args: unknown[]) =>
      handleConsoleRequest(source(event), args, snapshot),
    );
    ipcMain.handle(CONSOLE_IPC.stopAll, (event, ...args: unknown[]) =>
      handleConsoleRequest(source(event), args, () => host.stopAll()),
    );
    ipcMain.handle(CONSOLE_IPC.pluginAction, async (event, ...args: unknown[]) => {
      const result = await plugins.handle(source(event), args);
      notify();
      return result;
    });
    for (const [channel, action] of [
      [CONSOLE_IPC.security, 'get'],
      [CONSOLE_IPC.trust, 'trust'],
      [CONSOLE_IPC.preset, 'preset'],
      [CONSOLE_IPC.approval, 'approval'],
      [CONSOLE_IPC.audit, 'audit'],
      [CONSOLE_IPC.restoreBuiltin, 'restore'],
    ] as const)
      ipcMain.handle(channel, (event, ...args: unknown[]) =>
        security.handle(source(event), action, args),
      );
    for (const [channel, action] of [
      [CONSOLE_IPC.inspectConfig, 'inspect'],
      [CONSOLE_IPC.saveConfig, 'save'],
    ] as const)
      ipcMain.handle(channel, (event, ...args: unknown[]) =>
        handleConsoleConfigRequest(source(event), action, args, host),
      );
    let current: TaskHandle | undefined, foreign: BrowserWindow | undefined;
    const outcomes: unknown[] = [];
    Object.assign(globalThis, {
      m2SecurityQA: {
        host,
        settings,
        snapshot,
        diagnostics() {
          return {
            security: security.read(),
            status: host.status(),
            task: current?.snapshot(),
            outcomes,
          };
        },
        begin(method = 'ping') {
          const owner = host.manager.get(identity)!.owner;
          const selected = host.manager.select(identity, 'test.echo@1', {
            pluginId: identity.pluginId,
            instanceId: 'default',
            providerId: 'echo',
          });
          if (!selected.ok) throw new Error('Selection failed');
          const task = host.tasks.invokeCapability(
            host.manager,
            owner,
            'test.echo@1',
            method,
            null,
            capabilityPermissionAuthorizer(host.permissions),
            { timeoutMs: 15000 },
          );
          if (!task.ok) throw new Error(task.error.code);
          current = task.value;
          void current.result.then((result) => outcomes.push(result));
          return current.taskId;
        },
        cancel() {
          return current?.cancel();
        },
        async settled() {
          await current?.settled;
          return current ? await current.result : null;
        },
        async changeCode() {
          await fs.appendFile(
            path.join(__dirname, 'builtin/test.security/entry.mjs'),
            '\n// changed fixture',
          );
        },
        async foreignWindow() {
          foreign = new BrowserWindow({
            show: false,
            webPreferences: {
              preload,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          });
          await foreign.loadFile(entry);
        },
        closeForeign() {
          foreign?.destroy();
          foreign = undefined;
        },
        async shutdown() {
          current?.cancel();
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
