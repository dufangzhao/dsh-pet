import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  safeStorage,
  dialog,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PET_IPC,
  HOST_IPC,
  CONSOLE_IPC,
  PRESENTATION_IPC,
  DESKTOP_SPEECH_IPC,
  SPEECH_FEATURE_PLUGIN_ID,
  DESKTOP_COMPANION_IPC,
  DESKTOP_VOICE_IPC,
  VOICE_CAPTURE_PLUGIN_ID,
  DESKTOP_PRESENTATION_IPC,
  DESKTOP_COMPANION_PLUGIN_ID,
  APPLICATION_PLUGIN_IDS,
  type DesktopPresentationPreferences,
  type PetSnapshot,
} from '@pet/contracts';
import { createSafeStorageCipher, KernelFault, type SecretCipher } from '@pet/host-kernel';
import { DesktopHost } from './desktop-host.js';
import { DesktopCompanionController } from './companion-client-controller.js';
import { DesktopCompanionHostAdapter } from './companion-client-host.js';
import {
  handleDesktopCompanionRequest,
  type DesktopCompanionAction,
} from './companion-client-request.js';
import {
  LocalPresentationController,
  handleDesktopPresentationRequest,
} from './local-presentation-controller.js';
import { SharedApplicationState } from './shared-application-state.js';
import { admittedApplicationSource } from './application-admission.js';
import { mvpReadiness } from './mvp-readiness.js';
import { ConsoleWindow } from './windows/console-window.js';
import { createPetWindow, type PetWindowController } from './windows/pet-window.js';
import { handlePetRequest, isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
import { handleSettingsOpenRequest } from './settings-open-request.js';
import { HostStatusRequests } from './host-request.js';
import { consoleSnapshot } from './console-snapshot.js';
import { handleConsoleRequest } from './console-request.js';
import { handleConsoleConfigRequest } from './console-config-request.js';
import { ConsolePluginRequests } from './console-plugin-request.js';
import { ConsoleSecurityRequests } from './console-security-request.js';
import { PresentationController, handlePresentationRequest } from './presentation-controller.js';
import { SharedSpeechController } from './shared-speech-controller.js';
import { SharedSpeechHost } from './shared-speech-host.js';
import { handleDesktopSpeechRequest, type DesktopSpeechAction } from './shared-speech-request.js';
import { createDemoTray } from './demo-tray.js';

import { SharedVoiceController } from './shared-voice-controller.js';
import { SharedVoiceCaptureHost } from './shared-voice-capture-host.js';
import { handleDesktopVoiceRequest, type DesktopVoiceAction } from './shared-voice-request.js';
import { installSharedVoicePermission } from './shared-voice-permission.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const petEntry = path.resolve(here, '../renderer/pet/index.html');
const consoleEntry = path.resolve(here, '../renderer/console/index.html');
const petUrl = pathToFileURL(petEntry).href;
const consoleUrl = pathToFileURL(consoleEntry).href;
const preload = path.resolve(here, '../preload/index.cjs');
let host: DesktopHost | undefined;
let companion: DesktopCompanionController | undefined;
let voice: SharedVoiceController | undefined;
let local: LocalPresentationController | undefined;
let speech: SharedSpeechController | undefined;
let pet: PetWindowController | undefined;
let window: BrowserWindow | undefined;
let tray: ReturnType<typeof createDemoTray> | undefined;
let preferences: DesktopPresentationPreferences | null = null;
let quitting = false;
let petBudgetStart = performance.now();
let petRequests = 0;
const settings = new ConsoleWindow(
  consoleEntry,
  preload,
  () => presentation.ownerClosed(),
  false,
  (owner) => {
    let documentFrame = owner.webContents.mainFrame;
    owner.on('hide', () => voice?.ownerHidden());
    owner.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) voice?.ownerHidden();
    });
    owner.webContents.on('did-navigate', () => {
      voice?.ownerGone(documentFrame);
      documentFrame = owner.webContents.mainFrame;
    });
    owner.webContents.on('render-process-gone', () => voice?.ownerGone(documentFrame));
    owner.webContents.once('destroyed', () => voice?.ownerGone(documentFrame));
  },
);
const broadcast = (channel: string): void => {
  for (const target of [window, settings.current])
    if (target && !target.isDestroyed()) target.webContents.send(channel);
};
const presentation = new PresentationController(
  () => broadcast(PRESENTATION_IPC.changed),
  (request) => {
    if (!settings.current || settings.current.isDestroyed())
      throw new Error('Settings unavailable');
    settings.current.webContents.send(PRESENTATION_IPC.appearanceRequested, request);
  },
);
function sourceFor(
  event: IpcMainInvokeEvent,
  target: BrowserWindow | undefined,
  expectedUrl: string,
): PetRequestSource {
  return {
    senderId: event.sender.id,
    expectedId: target?.webContents.id ?? -1,
    mainFrame: event.senderFrame !== null && event.senderFrame === target?.webContents.mainFrame,
    frameUrl: event.senderFrame?.url ?? '',
    expectedUrl,
  };
}
function requestSource(event: IpcMainInvokeEvent) {
  const consoleSource = sourceFor(event, settings.current, consoleUrl);
  return isTrustedPetSource(consoleSource)
    ? { ...consoleSource, role: 'console' as const }
    : { ...sourceFor(event, window, petUrl), role: 'pet' as const };
}
function syncPet(): void {
  if (!window || window.isDestroyed() || !host) return;
  const avatar = host.manager.get({ pluginId: 'pet.avatar-default', instanceId: 'default' });
  const client = host.manager.get({ pluginId: DESKTOP_COMPANION_PLUGIN_ID, instanceId: 'default' });
  // The lawful Linux text composition renders the existing pure SVG, not a Windows avatar plugin.
  const available =
    process.platform === 'win32'
      ? !!avatar && host.manager.isActive(avatar.owner)
      : !!client && host.manager.isActive(client.owner);
  const visible = available && (preferences?.visible ?? true);
  if (visible && !window.isVisible()) window.showInactive();
  if (!visible && window.isVisible()) window.hide();
}
function refreshSpeech(): void {
  void speech?.refreshSource().catch(() => console.error('Speech source refresh failed'));
}
function stopSpeech(): void {
  const current = speech;
  if (!current) return;
  void current
    .getState()
    .then(async (state) => {
      if (!state.ok) throw new KernelFault(state.error.code);
      if (!state.value.connectionId) return;
      const result = await current.stop({ connectionId: state.value.connectionId });
      if (!result.ok && result.error.code !== 'stale-owner')
        throw new KernelFault(result.error.code);
    })
    .catch(() => console.error('Speech stop failed'));
}
async function quit(exitCode = 0): Promise<void> {
  if (quitting) return;
  quitting = true;
  tray?.destroy();
  presentation.ownerClosed();
  let speechCleanupFailed = false;
  try {
    // The Pet frame and live connection must remain available for release/cancel acknowledgments.
    await speech?.close();
  } catch {
    speechCleanupFailed = true;
  }
  settings.close();
  pet?.dispose();
  try {
    // PluginManager joins the client source's Main drain and actual worker disposal.
    const stopped = await host?.shutdown();
    await voice?.close();
    await companion?.close();
    app.exit(speechCleanupFailed || (stopped && !stopped.exitConfirmed) ? 1 : exitCode);
  } catch {
    app.exit(1);
  }
}
if (!app.isPackaged) {
  const flag = process.argv.find((arg) => arg.startsWith('--demo-acceptance='));
  if (flag && !/^--demo-acceptance=[A-Za-z0-9-]{1,64}$/.test(flag))
    throw new Error('Invalid acceptance profile');
  const profile = path.resolve(
    here,
    '../../../../.cache/',
    flag
      ? 'pet-demo-acceptance-' + flag.slice('--demo-acceptance='.length)
      : 'pet-prototype-profile',
  );
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}
if (!app.requestSingleInstanceLock()) app.exit(0);
const localRoles = [
  DESKTOP_COMPANION_PLUGIN_ID,
  VOICE_CAPTURE_PLUGIN_ID,
  SPEECH_FEATURE_PLUGIN_ID,
  APPLICATION_PLUGIN_IDS.profile,
  APPLICATION_PLUGIN_IDS.start,
  APPLICATION_PLUGIN_IDS.persona,
  APPLICATION_PLUGIN_IDS.appearance,
  APPLICATION_PLUGIN_IDS.conversation,
  'pet.avatar-default',
];
const startup = app
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
      /* Existing encrypted storage is optional; service tokens remain process-only. */
    }
    host = await DesktopHost.create({
      executable: process.execPath,
      workerEntry: path.resolve(here, '../runtime/worker.cjs'),
      builtinDirectory: app.isPackaged
        ? path.join(process.resourcesPath, 'plugins')
        : path.resolve(here, '../../../../plugins'),
      userDirectory: path.join(app.getPath('userData'), 'plugins'),
      sharedCompanion: true,
      companionLifecycle: {
        sourcePluginId: DESKTOP_COMPANION_PLUGIN_ID,
        stopFor: async (owner) => {
          await companion?.retireSource(owner);
        },
      },
      captureLifecycle: {
        sourcePluginId: VOICE_CAPTURE_PLUGIN_ID,
        stopFor: async (owner) => {
          await voice?.retireSource(owner);
        },
      },
      speechLifecycle: {
        sourcePluginId: SPEECH_FEATURE_PLUGIN_ID,
        stopFor: async (owner) => {
          await speech?.stopFor(owner);
        },
      },
      adapters: mvpReadiness(path.resolve(here, '../../../../.cache/asr-models'), true),
      onChanged: () => {
        refreshSpeech();
        void local?.refresh();
      },
      media: {
        input: (_reference, writer) => writer.cancel(),
        output: (_reference, reader) => reader.cancel(),
      },
      ...(cipher ? { cipher } : {}),
    });
    const activeHost = host;
    companion = new DesktopCompanionController(
      new DesktopCompanionHostAdapter(activeHost),
      {
        choose: async (name, senderId, signal) => {
          const owner = BrowserWindow.fromWebContents(webContentsFor(senderId));
          if (!owner || owner.isDestroyed() || signal.aborted) return null;
          const selected = await dialog.showSaveDialog(owner, {
            defaultPath: path.basename(name),
            properties: ['showOverwriteConfirmation'],
          });
          return selected.canceled || signal.aborted ? null : (selected.filePath ?? null);
        },
      },
      () => broadcast(DESKTOP_COMPANION_IPC.changed),
      (url) => shell.openExternal(url),
    );
    voice = new SharedVoiceController(
      companion,
      new SharedVoiceCaptureHost(activeHost),
      () => {
        const contents = settings.current?.webContents;
        return contents && !contents.isDestroyed() && contents.getURL() === consoleUrl
          ? contents.mainFrame
          : null;
      },
      () => broadcast(DESKTOP_VOICE_IPC.changed),
    );
    installSharedVoicePermission(session.defaultSession, settings, consoleUrl, voice);
    const activeVoice = voice;
    const voiceService = companion;
    for (const [action, channel] of Object.entries(DESKTOP_VOICE_IPC))
      if (action !== 'changed')
        ipcMain.handle(channel, (event, ...args: unknown[]) =>
          handleDesktopVoiceRequest(
            requestSource(event),
            event.senderFrame,
            action as DesktopVoiceAction,
            args,
            activeVoice,
            voiceService,
          ),
        );
    local = new LocalPresentationController(
      activeHost,
      () => ({ available: !!window && !window.isDestroyed(), shown: !!window?.isVisible() }),
      () => broadcast(DESKTOP_PRESENTATION_IPC.changed),
      (next) => {
        const wasSoundEnabled = preferences?.soundEnabled;
        preferences = next;
        if (!next.draggable) pet?.endDrag();
        window?.setAlwaysOnTop(next.alwaysOnTop);
        if (wasSoundEnabled !== false && !next.soundEnabled) stopSpeech();
        refreshSpeech();
        syncPet();
      },
    );
    const ledger = await SharedApplicationState.create(app.getPath('userData'));
    for (const id of localRoles) {
      if (ledger.disabled(id)) continue;
      const entry = activeHost.manager.get({ pluginId: id, instanceId: 'default' });
      const source = entry ? activeHost.getPackage(entry.owner) : null;
      if (!entry || entry.state === 'rejected' || !source || !admittedApplicationSource(source))
        continue;
      const review = activeHost.describeTrust(entry.owner);
      if (!review || !(await activeHost.verifyTrust(entry.owner, review.digest))) continue;
      activeHost.permissionControl.confirmTrust(
        { pluginId: id, instanceId: 'default' },
        review.digest,
        true,
      );
      const config = await activeHost.configs.get({ pluginId: id, instanceId: 'default' });
      if (config.ok)
        await activeHost.manager.enable({ pluginId: id, instanceId: 'default' }, config.value.data);
    }
    await companion.initialize();
    const activeCompanion = companion;
    const activeLocal = local;
    const securityChanged = () => {
      broadcast(CONSOLE_IPC.securityChanged);
      refreshSpeech();
      syncPet();
    };
    const consoleView = () =>
      consoleSnapshot(
        activeHost.status(),
        activeHost.manager.list(),
        {
          name: 'AI 桌宠',
          version: app.getVersion(),
          electron: process.versions.electron ?? '',
          node: process.versions.node,
          platform: `${process.platform}-${process.arch}`,
        },
        activeHost.manager.contributions(),
      );
    const security = new ConsoleSecurityRequests(activeHost, consoleView, securityChanged);
    const plugins = new ConsolePluginRequests(
      activeHost,
      consoleView,
      async (pluginId, enabled) => {
        if (localRoles.includes(pluginId)) await ledger.record(pluginId, enabled);
      },
    );
    for (const [action, channel] of Object.entries(DESKTOP_COMPANION_IPC))
      if (action !== 'changed')
        ipcMain.handle(channel, (event, ...args: unknown[]) =>
          handleDesktopCompanionRequest(
            requestSource(event),
            action as DesktopCompanionAction,
            args,
            activeCompanion,
          ),
        );
    for (const action of ['snapshot', 'save'] as const)
      ipcMain.handle(DESKTOP_PRESENTATION_IPC[action], (event, ...args: unknown[]) =>
        handleDesktopPresentationRequest(requestSource(event), action, args, activeLocal),
      );
    for (const [action, channel] of Object.entries(PRESENTATION_IPC))
      if (!['changed', 'appearanceRequested'].includes(action))
        ipcMain.handle(channel, (event, ...args: unknown[]) =>
          handlePresentationRequest(
            requestSource(event),
            action as 'snapshot' | 'publish' | 'setAppearance' | 'completeAppearance',
            args,
            presentation,
          ),
        );
    speech = new SharedSpeechController(
      activeCompanion,
      new SharedSpeechHost(activeHost),
      () => {
        const contents = window?.webContents;
        return contents && !contents.isDestroyed() && contents.getURL() === petUrl
          ? contents.mainFrame
          : null;
      },
      () => broadcast(DESKTOP_SPEECH_IPC.changed),
      (frame, event, payload) => {
        const contents = window?.webContents;
        if (
          contents &&
          !contents.isDestroyed() &&
          contents.mainFrame === frame &&
          contents.getURL() === petUrl
        )
          contents.send(DESKTOP_SPEECH_IPC.audio, event, payload);
      },
      async () => {
        if (!preferences?.soundEnabled) throw new KernelFault('not-ready');
        return preferences.speechVolume;
      },
    );
    const activeSpeech = speech;
    for (const [action, channel] of Object.entries(DESKTOP_SPEECH_IPC))
      if (!['changed', 'audio'].includes(action))
        ipcMain.handle(channel, (event, ...args: unknown[]) =>
          handleDesktopSpeechRequest(
            requestSource(event),
            event.senderFrame,
            action as DesktopSpeechAction,
            args,
            activeSpeech,
            activeCompanion,
          ),
        );
    ipcMain.handle(CONSOLE_IPC.snapshot, (event, ...args: unknown[]) =>
      handleConsoleRequest(sourceFor(event, settings.current, consoleUrl), args, consoleView),
    );
    ipcMain.handle(CONSOLE_IPC.open, (event, ...args: unknown[]) =>
      handleSettingsOpenRequest(
        sourceFor(event, window, petUrl),
        args,
        () => settings.open(),
        (request) => settings.current?.webContents.send(CONSOLE_IPC.navigate, request),
      ),
    );
    ipcMain.handle(CONSOLE_IPC.stopAll, (event, ...args: unknown[]) =>
      handleConsoleRequest(sourceFor(event, settings.current, consoleUrl), args, () => {
        stopSpeech();
        return activeHost.status();
      }),
    );
    ipcMain.handle(CONSOLE_IPC.pluginAction, async (event, ...args: unknown[]) => {
      const result = await plugins.handle(sourceFor(event, settings.current, consoleUrl), args);
      if (result.ok) {
        await activeCompanion.initialize();
        await activeLocal.refresh();
        securityChanged();
      }
      return result;
    });
    for (const [channel, action] of [
      [CONSOLE_IPC.inspectConfig, 'inspect'],
      [CONSOLE_IPC.saveConfig, 'save'],
    ] as const)
      ipcMain.handle(channel, (event, ...args: unknown[]) =>
        handleConsoleConfigRequest(
          sourceFor(event, settings.current, consoleUrl),
          action,
          args,
          activeHost,
        ),
      );
    for (const [channel, action] of [
      [CONSOLE_IPC.security, 'get'],
      [CONSOLE_IPC.trust, 'trust'],
      [CONSOLE_IPC.preset, 'preset'],
      [CONSOLE_IPC.approval, 'approval'],
      [CONSOLE_IPC.audit, 'audit'],
      [CONSOLE_IPC.restoreBuiltin, 'restore'],
    ] as const)
      ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        const result = await security.handle(
          sourceFor(event, settings.current, consoleUrl),
          action,
          args,
        );
        await activeCompanion.initialize();
        return result;
      });
    activeHost.approvals.subscribe(securityChanged);
    const status = new HostStatusRequests(() => activeHost.status());
    ipcMain.handle(HOST_IPC.status, (event, ...args: unknown[]) =>
      status.handle(sourceFor(event, window, petUrl), HOST_IPC.status, args),
    );
    for (const channel of [
      PET_IPC.snapshot,
      PET_IPC.interaction,
      PET_IPC.dragStart,
      PET_IPC.dragEnd,
      PET_IPC.preview,
      PET_IPC.quit,
    ])
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        const currentPet = pet;
        if (!currentPet) return { ok: false, error: 'unavailable' };
        const now = performance.now();
        if (now - petBudgetStart >= 1000) {
          petBudgetStart = now;
          petRequests = 0;
        }
        if (++petRequests > 240) return { ok: false, error: 'unavailable' };
        return handlePetRequest(sourceFor(event, window, petUrl), channel, args, {
          getSnapshot: () => currentPet.getSnapshot(),
          setInteraction: (value) => currentPet.setInteraction(value),
          beginDrag: () => {
            if (preferences?.draggable !== false) currentPet.beginDrag();
          },
          endDrag: () => currentPet.endDrag(),
          setState: (value) => currentPet.setState(value),
          quit: () => {
            app.quit();
          },
        });
      });
    pet = createPetWindow({
      preloadPath: preload,
      rendererPath: petEntry,
      onSnapshot: (snapshot: PetSnapshot) => window?.webContents.send(PET_IPC.changed, snapshot),
    });
    if (!(pet.window instanceof BrowserWindow)) throw new Error('Invalid pet window');
    window = pet.window;
    let speechFrame = window.webContents.mainFrame;
    window.webContents.on('did-navigate', () => {
      speech?.ownerGone(speechFrame);
      if (window && !window.webContents.isDestroyed()) speechFrame = window.webContents.mainFrame;
      refreshSpeech();
    });
    window.webContents.on('render-process-gone', () => speech?.ownerGone(speechFrame));
    window.webContents.once('destroyed', () => speech?.ownerGone(speechFrame));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    await settings.open(false);
    await activeLocal.refresh();
    await speech.refreshSource();
    syncPet();
    tray = createDemoTray({
      stopLabel: '停止本地播放',
      showPet: syncPet,
      showSettings: () => {
        void settings.open();
      },
      stop: () => {
        stopSpeech();
      },
      quit: () => app.quit(),
    });
  })
  .catch(() => {
    console.error('Shared desktop startup failed');
    void quit(1);
  });
function webContentsFor(senderId: number) {
  for (const target of [window, settings.current])
    if (target?.webContents.id === senderId) return target.webContents;
  throw new Error('Window unavailable');
}
app.on('second-instance', () => {
  void startup.then(() => settings.open());
});
if (process.argv.includes('--show-settings')) void startup.then(() => settings.open());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  event.preventDefault();
  void quit();
});
