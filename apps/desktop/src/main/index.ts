import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  safeStorage,
  type IpcMainInvokeEvent,
} from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONSOLE_IPC, HOST_IPC, PET_IPC, makeError, type PetSnapshot } from '@pet/contracts';
import { ConsoleWindow } from './windows/console-window.js';
import { consoleSnapshot } from './console-snapshot.js';
import { handleConsoleRequest } from './console-request.js';
import { createSafeStorageCipher, type SecretCipher } from '@pet/host-kernel';
import { DesktopHost } from './desktop-host.js';
import { HostStatusRequests } from './host-request.js';
import { createPetWindow, type PetWindowController } from './windows/pet-window.js';
import { handlePetRequest, isTrustedPetSource, type PetRequestSource } from './ipc-request.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.resolve(here, '../renderer/pet/index.html');
const expectedUrl = pathToFileURL(rendererPath).href;
const consolePath = path.resolve(here, '../renderer/console/index.html');
const consoleUrl = pathToFileURL(consolePath).href;
const settings = new ConsoleWindow(consolePath, path.resolve(here, '../preload/index.cjs'));
const channels = [
  PET_IPC.snapshot,
  PET_IPC.interaction,
  PET_IPC.dragStart,
  PET_IPC.dragEnd,
  PET_IPC.preview,
  PET_IPC.quit,
];
function windowSource(
  event: IpcMainInvokeEvent,
  target: BrowserWindow | undefined,
  url: string,
): PetRequestSource {
  const frame = event.senderFrame;
  return {
    senderId: event.sender.id,
    expectedId: target?.webContents.id ?? -1,
    mainFrame: frame !== null && frame === target?.webContents.mainFrame,
    frameUrl: frame?.url ?? '',
    expectedUrl: url,
  };
}
let controller: PetWindowController | undefined;
let window: BrowserWindow | undefined;
let budgetStart = performance.now();
let requests = 0;
let host: DesktopHost | undefined;
let hostStarting: Promise<DesktopHost> | undefined;
let quitting = false;
function quitWithCode(code: number): void {
  if (quitting) return;
  quitting = true;
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.removeHandler(HOST_IPC.status);
  ipcMain.removeHandler(CONSOLE_IPC.open);
  ipcMain.removeHandler(CONSOLE_IPC.snapshot);
  ipcMain.removeHandler(CONSOLE_IPC.stopAll);
  settings.close();
  controller?.dispose();
  void (async () => {
    const active = host ?? (await hostStarting?.catch(() => undefined));
    const stopped = await active?.shutdown();
    app.exit(stopped && !stopped.exitConfirmed ? 1 : code);
  })().catch(() => app.exit(1));
}
if (!app.isPackaged) {
  const profile = path.resolve(
    here,
    '../../../../.cache/',
    process.argv.includes('--m1-host-smoke')
      ? 'pet-host-smoke-profile'
      : process.argv.includes('--m0-key-lab')
        ? 'pet-key-lab-profile'
        : process.argv.includes('--m0-mouse-lab')
          ? 'pet-mouse-lab-profile'
          : 'pet-prototype-profile',
  );
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, respond) =>
      respond(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    let cipher: SecretCipher | undefined;
    try {
      cipher = createSafeStorageCipher(safeStorage);
    } catch {
      // No approved encryption backend: leave credentials unavailable, never use plaintext.
    }
    hostStarting = DesktopHost.create({
      ...(cipher ? { cipher } : {}),
      executable: process.execPath,
      workerEntry: path.resolve(here, '../runtime/worker.cjs'),
      builtinDirectory: app.isPackaged
        ? path.join(process.resourcesPath, 'plugins')
        : path.resolve(here, '../../../../plugins'),
      userDirectory: path.join(app.getPath('userData'), 'plugins'),
    });
    host = await hostStarting;
    if (quitting) {
      await host.shutdown();
      return;
    }
    const hostRequests = new HostStatusRequests(() => host!.status());
    ipcMain.handle(HOST_IPC.status, (event, ...args: unknown[]) => {
      try {
        if (!window || window.isDestroyed())
          return { ok: false, error: makeError('unavailable', false) };
        const frame = event.senderFrame;
        return hostRequests.handle(
          {
            senderId: event.sender.id,
            expectedId: window.webContents.id,
            mainFrame: frame !== null && frame === window.webContents.mainFrame,
            frameUrl: frame?.url ?? '',
            expectedUrl,
          },
          HOST_IPC.status,
          args,
        );
      } catch {
        return { ok: false, error: makeError('unavailable', false) };
      }
    });
    ipcMain.handle(CONSOLE_IPC.open, (event, ...args: unknown[]) =>
      handleConsoleRequest(windowSource(event, window, expectedUrl), args, () =>
        settings.open().then(() => null),
      ),
    );
    ipcMain.handle(CONSOLE_IPC.snapshot, (event, ...args: unknown[]) =>
      handleConsoleRequest(windowSource(event, settings.current, consoleUrl), args, () =>
        consoleSnapshot(
          host!.status(),
          host!.manager.list(),
          {
            name: 'AI 桌宠',
            version: app.getVersion(),
            electron: process.versions.electron!,
            node: process.versions.node,
            platform: process.platform + '-' + process.arch,
          },
          host!.manager.contributions(),
        ),
      ),
    );
    ipcMain.handle(CONSOLE_IPC.stopAll, (event, ...args: unknown[]) =>
      handleConsoleRequest(windowSource(event, settings.current, consoleUrl), args, () =>
        host!.stopAll(),
      ),
    );
    for (const channel of channels)
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        try {
          if (!controller || !window || window.isDestroyed())
            return { ok: false, error: 'unavailable' };
          const frame = event.senderFrame;
          const source = {
            senderId: event.sender.id,
            expectedId: window.webContents.id,
            mainFrame: frame !== null && frame === window.webContents.mainFrame,
            frameUrl: frame?.url ?? '',
            expectedUrl,
          };
          if (!isTrustedPetSource(source)) return { ok: false, error: 'untrusted-sender' };
          const now = performance.now();
          if (now - budgetStart >= 1000) {
            budgetStart = now;
            requests = 0;
          }
          if (++requests > 240) return { ok: false, error: 'unavailable' };
          const pet = controller;
          return handlePetRequest(source, channel, args, {
            getSnapshot: () => pet.getSnapshot(),
            setInteraction: (value) => pet.setInteraction(value),
            beginDrag: () => pet.beginDrag(),
            endDrag: () => pet.endDrag(),
            setState: (value) => pet.setState(value),
            quit: () => {
              setImmediate(() => app.quit());
            },
          });
        } catch {
          return { ok: false, error: 'unavailable' };
        }
      });
    const broadcast = (snapshot: PetSnapshot): void => {
      if (window && !window.isDestroyed()) window.webContents.send(PET_IPC.changed, snapshot);
    };
    controller = createPetWindow({
      preloadPath: path.resolve(here, '../preload/index.cjs'),
      rendererPath,
      onSnapshot: broadcast,
    });
    if (!(controller.window instanceof BrowserWindow)) throw new Error('Invalid window controller');
    window = controller.window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('did-finish-load', () => {
      if (controller) broadcast(controller.getSnapshot());
    });
    window.webContents.on('did-fail-load', () => {
      console.error('M0 renderer failed to load');
      quitWithCode(1);
    });
  })
  .catch(() => {
    console.error('M0 desktop startup failed');
    quitWithCode(1);
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  event.preventDefault();
  quitWithCode(0);
});
