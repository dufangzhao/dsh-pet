import { contextBridge, ipcRenderer } from 'electron';
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
window.addEventListener(
  'unload',
  () => {
    listeners.clear();
    ipcRenderer.removeListener(PET_IPC.changed, receive);
  },
  { once: true },
);
