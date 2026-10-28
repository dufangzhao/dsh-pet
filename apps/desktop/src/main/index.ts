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
import { handleConsoleConfigRequest } from './console-config-request.js';
import { ConsolePluginRequests } from './console-plugin-request.js';
import { ConsoleSecurityRequests } from './console-security-request.js';
import { DemoController } from './demo-controller.js';
import { createDemoTray } from './demo-tray.js';
import { handleDemoRequest, type DemoAction } from './demo-request.js';
import { demoReadiness } from './demo-readiness.js';
import { installDemoMediaPermission } from './demo-media-permission.js';
import { DEMO_IPC, DEMO_PLUGIN_IDS } from '@pet/contracts';
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
const settings = new ConsoleWindow(consolePath, path.resolve(here, '../preload/index.cjs'), () => {
  host?.approvals.clear();
  demo?.onConsoleClosed();
});
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
let demo: DemoController | undefined;
let tray: ReturnType<typeof createDemoTray> | undefined;
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
  ipcMain.removeHandler(CONSOLE_IPC.inspectConfig);
  ipcMain.removeHandler(CONSOLE_IPC.saveConfig);
  ipcMain.removeHandler(CONSOLE_IPC.pluginAction);
  for (const channel of Object.values(DEMO_IPC))
    if (channel !== DEMO_IPC.changed) ipcMain.removeHandler(channel);
  for (const channel of [
    CONSOLE_IPC.security,
    CONSOLE_IPC.trust,
    CONSOLE_IPC.preset,
    CONSOLE_IPC.approval,
    CONSOLE_IPC.audit,
    CONSOLE_IPC.restoreBuiltin,
  ])
    ipcMain.removeHandler(channel);
  tray?.destroy();
  tray = undefined;
  demo?.close();
  settings.close();
  controller?.dispose();
  void (async () => {
    const active = host ?? (await hostStarting?.catch(() => undefined));
    const stopped = await active?.shutdown();
    app.exit(stopped && !stopped.exitConfirmed ? 1 : code);
  })().catch(() => app.exit(1));
}
if (!app.isPackaged) {
  const acceptanceFlag = process.argv.find((arg) => arg.startsWith('--demo-acceptance='));
  if (acceptanceFlag && !/^--demo-acceptance=[A-Za-z0-9-]{1,64}$/.test(acceptanceFlag))
    throw new Error('Invalid acceptance profile');
  const acceptanceProfile = acceptanceFlag
    ? 'pet-demo-acceptance-' + acceptanceFlag.slice('--demo-acceptance='.length)
    : 'pet-demo-acceptance-profile';
  const profile = path.resolve(
    here,
    '../../../../.cache/',
    process.argv.includes('--demo-acceptance') || acceptanceFlag !== undefined
      ? acceptanceProfile
      : process.argv.includes('--m1-host-smoke')
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
if (!app.requestSingleInstanceLock()) app.exit(0);
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
      // No approved encryption backend: leave credentials unavailable, never use plaintext.
    }
    const modelRoot = path.resolve(here, '../../../../.cache/asr-models');
    const syncAvatar = () => {
      if (!window || window.isDestroyed()) return;
      const avatar = host?.manager.get({ pluginId: DEMO_PLUGIN_IDS.avatar, instanceId: 'default' });
      const enabled =
        !!avatar && avatar.origin === 'builtin' && host!.manager.isActive(avatar.owner);
      if (enabled && !window.isVisible()) window.showInactive();
      if (!enabled && window.isVisible()) window.hide();
    };
    const notifyDemo = () => {
      syncAvatar();
      for (const target of [window, settings.current])
        if (target && !target.isDestroyed()) target.webContents.send(DEMO_IPC.changed);
    };
    hostStarting = DesktopHost.create({
      adapters: demoReadiness(modelRoot),
      media: {
        input: (reference, writer) => {
          if (demo) demo.input(reference, writer);
          else writer.cancel();
        },
        output: (reference, reader) => {
          if (demo) demo.output(reference, reader);
          else reader.cancel();
        },
        capabilityTask: (parent, child, capability, method) =>
          demo?.capabilityTask(parent, child, capability, method),
      },
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
    demo = await DemoController.create(host!, modelRoot, notifyDemo);
    installDemoMediaPermission(session.defaultSession, settings, consoleUrl, demo);
    const acceptanceTrace: Array<Record<string, unknown>> | undefined = process.argv.some(
      (arg) => arg === '--demo-acceptance' || arg.startsWith('--demo-acceptance='),
    )
      ? []
      : undefined;
    if (acceptanceTrace)
      Object.assign(globalThis, { petDemoAcceptance: { events: acceptanceTrace } });
    for (const [action, channel] of Object.entries(DEMO_IPC))
      if (action !== 'changed')
        ipcMain.handle(channel, async (event, ...args: unknown[]) => {
          const consoleSource = windowSource(event, settings.current, consoleUrl);
          const source = isTrustedPetSource(consoleSource)
            ? { ...consoleSource, role: 'console' as const }
            : { ...windowSource(event, window, expectedUrl), role: 'pet' as const };
          const result = await handleDemoRequest(source, action as DemoAction, args, demo!);
          if (acceptanceTrace && action !== 'snapshot' && (action !== 'pcm' || !result.ok)) {
            const body = args[0] as Record<string, unknown> | undefined;
            acceptanceTrace.push({
              at: Date.now(),
              action,
              role: source.role,
              code: result.ok ? null : result.error.code,
              ...(action === 'captureError' ? { reason: body?.['reason'] } : {}),
            });
            if (acceptanceTrace.length > 64) acceptanceTrace.shift();
          }
          return result;
        });
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
    const snapshot = () =>
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
      );
    ipcMain.handle(CONSOLE_IPC.snapshot, (event, ...args: unknown[]) =>
      handleConsoleRequest(windowSource(event, settings.current, consoleUrl), args, snapshot),
    );
    const notifySecurity = () => {
      const target = settings.current;
      if (target && !target.isDestroyed()) target.webContents.send(CONSOLE_IPC.securityChanged);
      notifyDemo();
    };
    const securityRequests = new ConsoleSecurityRequests(host!, snapshot, notifySecurity);
    for (const [channel, action] of [
      [CONSOLE_IPC.security, 'get'],
      [CONSOLE_IPC.trust, 'trust'],
      [CONSOLE_IPC.preset, 'preset'],
      [CONSOLE_IPC.approval, 'approval'],
      [CONSOLE_IPC.audit, 'audit'],
      [CONSOLE_IPC.restoreBuiltin, 'restore'],
    ] as const)
      ipcMain.handle(channel, (event, ...args: unknown[]) =>
        securityRequests.handle(windowSource(event, settings.current, consoleUrl), action, args),
      );
    host!.approvals.subscribe(() => {
      if (host!.approvals.snapshot().length)
        void settings
          .open()
          .then(notifySecurity)
          .catch(() => host!.approvals.clear());
      else notifySecurity();
    });
    const pluginRequests = new ConsolePluginRequests(host!, snapshot);
    ipcMain.handle(CONSOLE_IPC.pluginAction, async (event, ...args: unknown[]) => {
      const result = await pluginRequests.handle(
        windowSource(event, settings.current, consoleUrl),
        args,
      );
      if (result.ok) notifySecurity();
      return result;
    });
    ipcMain.handle(CONSOLE_IPC.stopAll, (event, ...args: unknown[]) =>
      handleConsoleRequest(windowSource(event, settings.current, consoleUrl), args, () => {
        const status = host!.stopAll();
        demo?.onAllStopped();
        return status;
      }),
    );
    for (const [channel, action] of [
      [CONSOLE_IPC.inspectConfig, 'inspect'],
      [CONSOLE_IPC.saveConfig, 'save'],
    ] as const)
      ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        const result = await handleConsoleConfigRequest(
          windowSource(event, settings.current, consoleUrl),
          action,
          args,
          host!,
        );
        if (action === 'save' && result.ok) notifyDemo();
        return result;
      });
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
    syncAvatar();
    tray = createDemoTray({
      showPet: () => {
        syncAvatar();
        if (!window?.isVisible()) showSettingsForLaunch();
      },
      showSettings: showSettingsForLaunch,
      stop: () => {
        host?.stopAll();
        demo?.onAllStopped();
        notifySecurity();
      },
      quit: () => app.quit(),
    });
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
function showSettingsForLaunch(): void {
  void startup
    .then(async () => {
      if (!quitting) await settings.open();
    })
    .catch(() => {
      console.error('Settings window failed to open');
      quitWithCode(1);
    });
}
app.on('second-instance', showSettingsForLaunch);
if (process.argv.includes('--show-settings')) showSettingsForLaunch();
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  event.preventDefault();
  quitWithCode(0);
});
