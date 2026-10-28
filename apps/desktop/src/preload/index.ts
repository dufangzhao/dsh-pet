import { createApplicationBridge } from './application-bridge.js';
import { APPLICATION_IPC } from '@pet/contracts';
import { contextBridge, ipcRenderer } from 'electron';
import {
  CONSOLE_IPC,
  HOST_IPC,
  type ConsoleSnapshot,
  type ConfigInspection,
  type ConfigSave,
  type ConsolePluginChange,
  type HostStatus,
  type Result,
} from '@pet/contracts';
import { createConsoleBridge, createSettingsLauncher } from './console-bridge.js';
import { createSecurityBridge } from './security-bridge.js';
import { createDemoBridge } from './demo-bridge.js';
import { DEMO_IPC } from '@pet/contracts';
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
const demoListeners = new Set<() => void>();
const receiveDemo = () => {
  for (const listener of demoListeners) {
    try {
      listener();
    } catch {
      /* Isolate UI subscribers. */
    }
  }
};
ipcRenderer.on(DEMO_IPC.changed, receiveDemo);
contextBridge.exposeInMainWorld(
  'petDemo',
  createDemoBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => {
      if (demoListeners.size >= 32) throw new RangeError('Too many demo subscriptions');
      demoListeners.add(listener);
      return () => {
        demoListeners.delete(listener);
      };
    },
  ),
);
const securityListeners = new Set<() => void>();
const receiveSecurity = () => {
  for (const listener of securityListeners) {
    try {
      listener();
    } catch {
      /* Isolate UI subscribers. */
    }
  }
};
ipcRenderer.on(CONSOLE_IPC.securityChanged, receiveSecurity);
contextBridge.exposeInMainWorld(
  'petConsole',
  createConsoleBridge(
    () => ipcRenderer.invoke(CONSOLE_IPC.snapshot) as Promise<Result<ConsoleSnapshot>>,
    () => ipcRenderer.invoke(CONSOLE_IPC.stopAll) as Promise<Result<HostStatus>>,
    {
      inspectConfig: (owner) =>
        ipcRenderer.invoke(CONSOLE_IPC.inspectConfig, owner) as Promise<Result<ConfigInspection>>,
      saveConfig: (request) =>
        ipcRenderer.invoke(CONSOLE_IPC.saveConfig, request) as Promise<Result<ConfigSave>>,
      runPluginAction: (request) =>
        ipcRenderer.invoke(CONSOLE_IPC.pluginAction, request) as Promise<
          Result<ConsolePluginChange>
        >,
    },
    createSecurityBridge(
      (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      (listener) => {
        if (securityListeners.size >= 32) throw new RangeError('Too many security subscriptions');
        securityListeners.add(listener);
        return () => {
          securityListeners.delete(listener);
        };
      },
    ),
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
    securityListeners.clear();
    demoListeners.clear();
    ipcRenderer.removeListener(DEMO_IPC.changed, receiveDemo);
    ipcRenderer.removeListener(CONSOLE_IPC.securityChanged, receiveSecurity);
    ipcRenderer.removeListener(PET_IPC.changed, receive);
  },
  { once: true },
);
const applicationListeners = new Set<() => void>();
ipcRenderer.on(APPLICATION_IPC.changed, () => {
  for (const listener of applicationListeners) {
    try {
      listener();
    } catch {
      /* Isolate view subscribers. */
    }
  }
});
contextBridge.exposeInMainWorld(
  'petApplication',
  createApplicationBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => {
      if (applicationListeners.size >= 32)
        throw new RangeError('Too many application subscriptions');
      applicationListeners.add(listener);
      return () => {
        applicationListeners.delete(listener);
      };
    },
  ),
);
