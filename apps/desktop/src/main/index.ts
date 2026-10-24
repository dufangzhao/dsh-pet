import { app, BrowserWindow, ipcMain, session } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PET_IPC, type PetSnapshot } from '@pet/contracts';
import { createPetWindow, type PetWindowController } from './windows/pet-window.js';
import { handlePetRequest, isTrustedPetSource } from './ipc-request.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.resolve(here, '../renderer/pet/index.html');
const expectedUrl = pathToFileURL(rendererPath).href;
const channels = [
  PET_IPC.snapshot,
  PET_IPC.interaction,
  PET_IPC.dragStart,
  PET_IPC.dragEnd,
  PET_IPC.preview,
  PET_IPC.quit,
];
let controller: PetWindowController | undefined;
let window: BrowserWindow | undefined;
let budgetStart = performance.now();
let requests = 0;
if (!app.isPackaged) {
  const profile = path.resolve(here, '../../../../.cache/pet-prototype-profile');
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}
app
  .whenReady()
  .then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, respond) =>
      respond(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
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
      app.exit(1);
    });
  })
  .catch(() => {
    console.error('M0 desktop startup failed');
    controller?.dispose();
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  for (const channel of channels) ipcMain.removeHandler(channel);
  controller?.dispose();
});
