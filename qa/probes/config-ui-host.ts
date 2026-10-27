import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSOLE_IPC, makeError, type JsonObject } from '../../packages/contracts/src/index.js';
import { DesktopHost } from '../../apps/desktop/src/main/desktop-host.js';
import { ConsoleWindow } from '../../apps/desktop/src/main/windows/console-window.js';
import { consoleSnapshot } from '../../apps/desktop/src/main/console-snapshot.js';
import { handleConsoleRequest } from '../../apps/desktop/src/main/console-request.js';
import { handleConsoleConfigRequest } from '../../apps/desktop/src/main/console-config-request.js';

// Fault injection stays in this main-process fixture; window, renderer, preload,
// config service and file persistence are the production implementations.
const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'apps/desktop/dist/renderer/console/index.html');
const preload = path.join(root, 'apps/desktop/dist/preload/index.cjs');
app.setPath('userData', path.join(__dirname, 'profile'));
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const host = await DesktopHost.create({ executable: process.execPath,
    workerEntry: path.join(root, 'apps/desktop/dist/runtime/worker.cjs'),
    builtinDirectory: path.join(__dirname, 'builtin'), userDirectory: path.join(__dirname, 'plugins') });
  await host.driver.ready();
  const settings = new ConsoleWindow(entry, preload);
  const identity = { pluginId: 'test.schema-form', instanceId: 'default' };
  let saveFails = false, inspectFails = false, saveCalls = 0;
  let lastSave: unknown = null, lastRequest: unknown = null;
  const saveAttempts: unknown[] = [];
  let gate: Promise<void> | undefined, release: (() => void) | undefined;
  let foreign: BrowserWindow | undefined;
  const source = (event: IpcMainInvokeEvent) => ({
    senderId: event.sender.id, expectedId: settings.current?.webContents.id ?? -1,
    mainFrame: event.senderFrame !== null && event.senderFrame === settings.current?.webContents.mainFrame,
    frameUrl: event.senderFrame?.url ?? '', expectedUrl: pathToFileURL(entry).href,
  });
  const snapshot = () => consoleSnapshot(host.status(), host.manager.list(), {
    name: 'AI 桌宠', version: '0.0.0', electron: process.versions.electron!, node: process.versions.node,
    platform: process.platform + '-' + process.arch,
  }, host.manager.contributions());
  ipcMain.handle(CONSOLE_IPC.snapshot, (event, ...args: unknown[]) => handleConsoleRequest(source(event), args, snapshot));
  ipcMain.handle(CONSOLE_IPC.stopAll, (event, ...args: unknown[]) => handleConsoleRequest(source(event), args, () => host.stopAll()));
  ipcMain.handle(CONSOLE_IPC.inspectConfig, (event, ...args: unknown[]) => inspectFails
    ? { ok: false, error: makeError('unavailable', false) }
    : handleConsoleConfigRequest(source(event), 'inspect', args, host));
  ipcMain.handle(CONSOLE_IPC.saveConfig, async (event, ...args: unknown[]) => {
    saveCalls++;
    lastRequest = args[0];
    if (gate) await gate;
    const injectedFailure = saveFails;
    lastSave = injectedFailure ? { ok: false, error: makeError('unavailable', false) }
      : await handleConsoleConfigRequest(source(event), 'save', args, host);
    saveAttempts.push({ call: saveCalls, injectedFailure, result: lastSave,  });
    return lastSave;
  });
  Object.assign(globalThis, { m2ConfigQA: {
    host, settings, snapshot,
    inspect() { return host.configs.inspect(identity); },
    save(data: JsonObject, revision: number) { return host.configs.save(identity, data, revision); },
    setSaveFailure(value: boolean) { saveFails = value; },
    setInspectFailure(value: boolean) { inspectFails = value; },
    holdSave() { gate = new Promise<void>(resolve => { release = resolve; }); },
    releaseSave() { release?.(); release = undefined; gate = undefined; },
    diagnostics() { return { saveCalls, lastRequest, lastSave, saveAttempts, plugins: host.manager.list().map(p => ({ owner: p.owner, state: p.state })) }; },
    async foreignWindow() {
      foreign = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await foreign.loadFile(entry); return foreign.webContents.id;
    },
    closeForeign() { foreign?.destroy(); foreign = undefined; },
    async reopen() { settings.close(); await settings.open(); },
    async shutdown() { release?.(); foreign?.destroy(); settings.close(); return host.shutdown(); },
  } });
  await settings.open();
}).catch(error => { console.error(error); app.exit(1); });
