import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSOLE_IPC, type ConsoleSnapshot, type Result } from '../../packages/contracts/src/index.js';
import { discoverPlugins, type TaskHandle } from '../../packages/host-kernel/src/index.js';
import { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
import { ConsoleWindow } from '../../apps/desktop/src/main/windows/console-window.js';
import { consoleSnapshot } from '../../apps/desktop/src/main/console-snapshot.js';
import { handleConsoleRequest } from '../../apps/desktop/src/main/console-request.js';

// Controlled host for fault states and a task that remains pending after cancellation.
// The renderer, preload, window and host are the production implementations.
const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'apps/desktop/dist/renderer/console/index.html');
const userDirectory = path.join(__dirname, 'plugins');
app.setPath('userData', path.join(__dirname, 'profile'));
app.on('window-all-closed', () => {});
const take = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error('Console UI fixture failed: ' + result.error.code);
  return result.value;
};

void app.whenReady().then(async () => {
  const host = await DesktopHost.create({
    executable: process.execPath,
    workerEntry: path.join(root, 'apps/desktop/dist/runtime/worker.cjs'),
    builtinDirectory: path.join(__dirname, 'builtin'),
    userDirectory,
  });
  await host.driver.ready();
  const discovered = await discoverPlugins([{ directory: userDirectory, origin: 'user' }]);
  for (const plugin of discovered.plugins) {
    const identity = { pluginId: plugin.manifest.id, instanceId: 'default' };
    const digest = createHash('sha256').update(JSON.stringify({
      origin: plugin.origin, directory: plugin.directory, files: plugin.files,
    })).digest('hex');
    if (!host.permissionControl.confirmTrust(identity, digest, true)) throw new Error('Fixture trust failed');
    take(await host.manager.enable(identity));
  }
  const identity = { pluginId: discovered.plugins[0]!.manifest.id, instanceId: 'default' };
  const owner = host.manager.list()[0]!.owner;
  const settings = new ConsoleWindow(entry, path.join(root, 'apps/desktop/dist/preload/index.cjs'));
  let mode: 'real' | 'error' | 'empty' | 'delayed' = 'delayed';
  let releaseSnapshot: (() => void) | undefined;
  let held: TaskHandle | undefined;
  let releaseWork: (() => void) | undefined;
  let stopFails = false;
  let stopGate: Promise<void> | undefined;
  let releaseStop: (() => void) | undefined;
  let stopCalls = 0;
  const snapshot = (): ConsoleSnapshot => consoleSnapshot(host.status(), host.manager.list(), {
    name: 'AI 桌宠', version: '0.0.0', electron: process.versions.electron!,
    node: process.versions.node, platform: process.platform + '-' + process.arch,
  }, host.manager.contributions());
  const source = (event: IpcMainInvokeEvent) => ({
    senderId: event.sender.id, expectedId: settings.current?.webContents.id ?? -1,
    mainFrame: event.senderFrame === settings.current?.webContents.mainFrame,
    frameUrl: event.senderFrame?.url ?? '', expectedUrl: pathToFileURL(entry).href,
  });
  ipcMain.handle(CONSOLE_IPC.snapshot, (event, ...args: unknown[]) =>
    handleConsoleRequest(source(event), args, async () => {
      if (mode === 'delayed') await new Promise<void>(resolve => { releaseSnapshot = resolve; });
      if (mode === 'error') throw new Error('Injected snapshot failure');
      const value = snapshot();
      return mode === 'empty' ? { ...value, plugins: [], contributions: [],
        host: { ...value.host, installedPlugins: 0, activePlugins: 0 } } : value;
    }),
  );
  ipcMain.handle(CONSOLE_IPC.stopAll, (event, ...args: unknown[]) =>
    handleConsoleRequest(source(event), args, async () => {
      stopCalls++;
      if (stopGate) await stopGate;
      if (stopFails) throw new Error('Injected stop failure');
      return host.stopAll();
    }),
  );
  Object.assign(globalThis, { m2ConsoleQA: {
    host, settings, snapshot,
    setMode(next: typeof mode) { mode = next; },
    releaseSnapshot() { mode = 'real'; releaseSnapshot?.(); releaseSnapshot = undefined; },
    setStopFailure(value: boolean) { stopFails = value; },
    holdStop() { stopGate = new Promise<void>(resolve => { releaseStop = resolve; }); },
    releaseStop() { releaseStop?.(); releaseStop = undefined; stopGate = undefined; },
    diagnostics() { return { stopCalls, held: held?.snapshot() ?? null, host: host.status() }; },
    async beginTask() {
      let began!: () => void;
      const ready = new Promise<void>(resolve => { began = resolve; });
      held = take(host.tasks.run(owner, async () => {
        began();
        await new Promise<void>(resolve => { releaseWork = resolve; });
        return null;
      }));
      await ready;
      return host.status();
    },
    async releaseTask() { releaseWork?.(); await held?.settled; return host.status(); },
    async disablePlugin() { take(await host.manager.disable(identity)); return snapshot(); },
    async shutdown() {
      releaseSnapshot?.(); releaseStop?.(); releaseWork?.(); settings.close();
      return host.shutdown();
    },
  } });
  await settings.open();
}).catch(error => { console.error(error); app.exit(1); });
