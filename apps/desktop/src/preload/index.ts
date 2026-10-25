import { contextBridge, ipcRenderer } from 'electron';
import {
  CONSOLE_IPC,
  HOST_IPC,
  type ConsoleSnapshot,
  type HostStatus,
  type Result,
} from '@pet/contracts';
import { createConsoleBridge, createSettingsLauncher } from './console-bridge.js';
import { createHostStatusBridge } from './host-bridge.js';
import { PET_IPC, type PetPrototypeBridge, type PetReply, type PetSnapshot } from '@pet/contracts';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<PetReply<T>> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as PetReply<T>;
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
const listeners = new Set<(snapshot: PetSnapshot) => void>();
const receive = (_event: Electron.IpcRendererEvent, snapshot: PetSnapshot): void => {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      /* One subscriber cannot break the others. */
    }
  }
};
ipcRenderer.on(PET_IPC.changed, receive);
const bridge: PetPrototypeBridge = {
  version: 1,
  getSnapshot: () => invoke(PET_IPC.snapshot),
  setInteraction: (interactive) => invoke(PET_IPC.interaction, interactive),
  beginDrag: () => invoke(PET_IPC.dragStart),
  endDrag: () => invoke(PET_IPC.dragEnd),
  previewState: (state) => invoke(PET_IPC.preview, state),
  quit: () => invoke(PET_IPC.quit),
  onSnapshot(listener) {
    if (typeof listener !== 'function') throw new TypeError('Expected snapshot callback');
    if (listeners.size >= 32) throw new RangeError('Too many snapshot subscriptions');
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
contextBridge.exposeInMainWorld('pet', Object.freeze(bridge));
contextBridge.exposeInMainWorld(
  'petHost',
  createHostStatusBridge(() => ipcRenderer.invoke(HOST_IPC.status) as Promise<Result<HostStatus>>),
);
contextBridge.exposeInMainWorld(
  'petConsole',
  createConsoleBridge(
    () => ipcRenderer.invoke(CONSOLE_IPC.snapshot) as Promise<Result<ConsoleSnapshot>>,
    () => ipcRenderer.invoke(CONSOLE_IPC.stopAll) as Promise<Result<HostStatus>>,
  ),
);
contextBridge.exposeInMainWorld(
  'petSettings',
  createSettingsLauncher(() => ipcRenderer.invoke(CONSOLE_IPC.open) as Promise<Result<null>>),
);
window.addEventListener(
  'unload',
  () => {
    listeners.clear();
    ipcRenderer.removeListener(PET_IPC.changed, receive);
  },
  { once: true },
);
