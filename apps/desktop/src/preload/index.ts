import { contextBridge, ipcRenderer } from 'electron';
import {
  PET_IPC,
  HOST_IPC,
  CONSOLE_IPC,
  PRESENTATION_IPC,
  SPEECH_OUTPUT_IPC,
  DESKTOP_COMPANION_IPC,
  DESKTOP_VOICE_IPC,
  DESKTOP_SPEECH_IPC,
  DESKTOP_PRESENTATION_IPC,
  type PetPrototypeBridge,
  type PetReply,
  type PetSnapshot,
  type HostStatus,
  type Result,
  type ConsoleSnapshot,
  type ConfigInspection,
  type ConfigSave,
  type ConsolePluginChange,
  type SpeechOutputAudioEvent,
} from '@pet/contracts';
import {
  createDesktopCompanionBridge,
  createDesktopPresentationBridge,
} from './companion-bridge.js';
import { createPresentationBridge } from './presentation-bridge.js';
import { createSpeechOutputBridge } from './speech-output-bridge.js';
import { createConsoleBridge } from './console-bridge.js';
import { createSettingsLauncher } from './settings-launcher.js';
import { createSecurityBridge } from './security-bridge.js';
import { createHostStatusBridge } from './host-bridge.js';
import { createDesktopVoiceBridge } from './shared-voice-bridge.js';
import { createDesktopSpeechBridge } from './shared-speech-bridge.js';
const cleanup = new Set<() => void>();
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const receive = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, receive);
  const off = () => {
    ipcRenderer.removeListener(channel, receive);
    cleanup.delete(off);
  };
  cleanup.add(off);
  return off;
}
function changed(channel: string, listener: () => void): () => void {
  return subscribe(channel, listener);
}
async function petCall<T>(channel: string, ...args: unknown[]): Promise<PetReply<T>> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as PetReply<T>;
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
const pet: PetPrototypeBridge = {
  version: 1,
  getSnapshot: () => petCall(PET_IPC.snapshot),
  setInteraction: (value) => petCall(PET_IPC.interaction, value),
  beginDrag: () => petCall(PET_IPC.dragStart),
  endDrag: () => petCall(PET_IPC.dragEnd),
  previewState: (state) => petCall(PET_IPC.preview, state),
  quit: () => petCall(PET_IPC.quit),
  onSnapshot(listener) {
    if (typeof listener !== 'function') throw new TypeError('Expected callback');
    return subscribe<PetSnapshot>(PET_IPC.changed, listener);
  },
};
contextBridge.exposeInMainWorld('pet', Object.freeze(pet));
contextBridge.exposeInMainWorld(
  'petCompanion',
  createDesktopCompanionBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => changed(DESKTOP_COMPANION_IPC.changed, listener),
  ),
);
contextBridge.exposeInMainWorld(
  'petVoice',
  createDesktopVoiceBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => changed(DESKTOP_VOICE_IPC.changed, listener),
  ),
);
contextBridge.exposeInMainWorld(
  'petSharedSpeech',
  createDesktopSpeechBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => changed(DESKTOP_SPEECH_IPC.changed, listener),
    (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, event: unknown, payload?: Uint8Array) =>
        listener(event, payload);
      ipcRenderer.on(DESKTOP_SPEECH_IPC.audio, receive);
      const off = () => {
        ipcRenderer.removeListener(DESKTOP_SPEECH_IPC.audio, receive);
        cleanup.delete(off);
      };
      cleanup.add(off);
      return off;
    },
  ),
);
contextBridge.exposeInMainWorld(
  'petLocalPresentation',
  createDesktopPresentationBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => changed(DESKTOP_PRESENTATION_IPC.changed, listener),
  ),
);
contextBridge.exposeInMainWorld(
  'petHost',
  createHostStatusBridge(() => ipcRenderer.invoke(HOST_IPC.status) as Promise<Result<HostStatus>>),
);
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
      (listener) => changed(CONSOLE_IPC.securityChanged, listener),
    ),
  ),
);
contextBridge.exposeInMainWorld(
  'petSettings',
  createSettingsLauncher(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => subscribe(CONSOLE_IPC.navigate, listener),
  ),
);
contextBridge.exposeInMainWorld(
  'petPresentation',
  createPresentationBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => changed(PRESENTATION_IPC.changed, listener),
    (listener) => subscribe(PRESENTATION_IPC.appearanceRequested, listener),
  ),
);
contextBridge.exposeInMainWorld(
  'petSpeechOutput',
  createSpeechOutputBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (listener) => changed(SPEECH_OUTPUT_IPC.changed, listener),
    (listener) => {
      const receive = (
        _event: Electron.IpcRendererEvent,
        event: SpeechOutputAudioEvent,
        payload?: Uint8Array,
      ) => listener(event, payload);
      ipcRenderer.on(SPEECH_OUTPUT_IPC.audio, receive);
      const off = () => {
        ipcRenderer.removeListener(SPEECH_OUTPUT_IPC.audio, receive);
        cleanup.delete(off);
      };
      cleanup.add(off);
      return off;
    },
  ),
);
window.addEventListener(
  'unload',
  () => {
    for (const off of [...cleanup]) off();
  },
  { once: true },
);
