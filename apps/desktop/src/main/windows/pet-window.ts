/**
 * M0-06 桌宠窗口控制器：透明、无边框、置顶、默认鼠标穿透、不抢焦点。
 *
 * 边界（与 qa/M0-06-bridge.md 一致）：
 * - 不注册 IPC、不创建菜单、不开新窗口、不做外部导航；IPC 由主会话实现。
 * - 拖拽只读主进程 screen.getCursorScreenPoint() 的 DIP 坐标，渲染器不传任何坐标。
 * - 默认 ignoreMouseEvents(true, { forward: true })；只有渲染器上报“指针在角色或按钮的
 *   实际命中区”时才临时关闭穿透；空白区域、失焦、隐藏时恢复穿透。
 * - 拖拽用有界轮询 + 看门狗超时，光标停在窗口外也不会卡死；结束、失焦、关闭、dispose
 *   都释放计时器，dispose 后的回调一律不再广播。
 *
 * 这是 M0 验证用原型，M2-07 会迁入可停用的角色插件，不要在此处继续堆正式功能。
 */
import { createRequire } from 'node:module';

import { isPetState, type PetBounds, type PetSnapshot, type PetState } from '@pet/contracts';

import type { DisplayFacade, ElectronFacade, WindowFacade } from './electron-runtime.js';

export type { DisplayFacade, ElectronFacade, WindowFacade } from './electron-runtime.js';
export type { DisplayLike, Point, Rect } from './pet-geometry.js';
import {
  dragPosition,
  initialBounds,
  restoreVisible,
  roundRect,
  type DisplayLike,
} from './pet-geometry.js';

export interface CreatePetWindowOptions {
  /** 主会话提供的绝对构建产物路径；渲染器不能指定。 */
  preloadPath: string;
  /** 主会话提供的绝对构建产物路径；渲染器不能指定。 */
  rendererPath: string;
  /** 状态或几何变化时的回调，由主会话广播固定事件。 */
  onSnapshot: (snapshot: PetSnapshot) => void;
}

export interface PetWindowController {
  window: WindowFacade;
  getSnapshot(): PetSnapshot;
  setInteraction(interactive: boolean): void;
  beginDrag(): void;
  endDrag(): void;
  setState(state: PetState): void;
  dispose(): void;
}

export interface PetWindowSize {
  width: number;
  height: number;
}

export interface PetWindowDependencies {
  /** 缺省用 electron 的 screen/BrowserWindow；单元测试注入 mock。 */
  electron?: ElectronFacade;
  size?: PetWindowSize;
  /** 拖拽跟随光标的轮询周期。 */
  dragTickMs?: number;
  /** 拖拽看门狗：超过此时长仍未结束就自动结束，避免窗口卡在拖拽态。 */
  dragTimeoutMs?: number;
  /** 状态事件去重窗口，避免短时间内重复广播。 */
  snapshotDebounceMs?: number;
  /** 指针离开命中区后延迟恢复穿透，容忍子元素之间的短暂间隙。 */
  interactionReleaseDelayMs?: number;
}

export const PET_WINDOW_DEFAULT_SIZE: PetWindowSize = { width: 380, height: 420 };
export const PET_WINDOW_DRAG_TICK_MS = 16;
export const PET_WINDOW_DRAG_TIMEOUT_MS = 30_000;
export const PET_WINDOW_SNAPSHOT_DEBOUNCE_MS = 40;
export const PET_WINDOW_INTERACTION_RELEASE_MS = 120;

/**
 * 只在真正创建窗口时才加载 electron：单元测试可以完全注入 mock，
 * 纯 node 环境也不会在 import 阶段就触发 Electron 的二进制查找。
 */
function loadElectron(): ElectronFacade {
  let loaded: ElectronFacade | undefined;
  try {
    loaded = createRequire(import.meta.url)('electron') as ElectronFacade;
  } catch {
    loaded = undefined;
  }
  if (!loaded?.screen || typeof loaded.BrowserWindow !== 'function') {
    throw new Error(
      '无法加载 electron 的 screen/BrowserWindow；请在 ESM 主进程中调用，或通过 createPetWindow 的第二个参数注入 electron',
    );
  }
  return loaded;
}

function toDisplayLike(display: DisplayFacade): DisplayLike {
  return {
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  };
}

function sameBounds(a: PetBounds, b: PetBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function overlapArea(a: PetBounds, b: PetBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

export function createPetWindow(
  options: CreatePetWindowOptions,
  dependencies: PetWindowDependencies = {},
): PetWindowController {
  if (typeof options.preloadPath !== 'string' || options.preloadPath.length === 0) {
    throw new Error('createPetWindow 需要主会话提供的 preloadPath');
  }
  if (typeof options.rendererPath !== 'string' || options.rendererPath.length === 0) {
    throw new Error('createPetWindow 需要主会话提供的 rendererPath');
  }
  if (typeof options.onSnapshot !== 'function') {
    throw new Error('createPetWindow 需要 onSnapshot 回调');
  }

  const electron = dependencies.electron ?? loadElectron();
  const size = dependencies.size ?? PET_WINDOW_DEFAULT_SIZE;
  const dragTickMs = dependencies.dragTickMs ?? PET_WINDOW_DRAG_TICK_MS;
  const dragTimeoutMs = dependencies.dragTimeoutMs ?? PET_WINDOW_DRAG_TIMEOUT_MS;
  const snapshotDebounceMs = dependencies.snapshotDebounceMs ?? PET_WINDOW_SNAPSHOT_DEBOUNCE_MS;
  const releaseDelayMs =
    dependencies.interactionReleaseDelayMs ?? PET_WINDOW_INTERACTION_RELEASE_MS;

  const readDisplays = (): DisplayFacade[] => {
    const all = electron.screen.getAllDisplays();
    if (all.length > 0) return all;
    return [electron.screen.getPrimaryDisplay()];
  };

  const initial = initialBounds(
    electron.screen.getPrimaryDisplay().workArea,
    size,
    readDisplays().map(toDisplayLike),
  );

  const window = new electron.BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    acceptFirstMouse: true,
    webPreferences: {
      preload: options.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  window.setAlwaysOnTop?.(true, 'floating');
  window.setMenuBarVisibility?.(false);
  window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });

  let disposed = false;
  let state: PetState = 'idle';
  let dragging = false;
  let interactive = false;
  let dragStartBounds: PetBounds = roundRect(initial);
  let dragStartCursor: { x: number; y: number } | null = null;
  let lastSnapshot: PetSnapshot | null = null;

  let dragTick: ReturnType<typeof setInterval> | null = null;
  let dragWatchdog: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(
    handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null,
    kind: 'timeout' | 'interval',
  ): null {
    if (handle === null) return null;
    if (kind === 'interval') clearInterval(handle as ReturnType<typeof setInterval>);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
    return null;
  }

  function isAlive(): boolean {
    return !disposed && !window.isDestroyed();
  }

  function applyClickThrough(next: boolean): void {
    if (!isAlive()) return;
    window.setIgnoreMouseEvents(next, { forward: true });
  }

  function currentBounds(): PetBounds {
    if (!isAlive()) return roundRect(dragStartBounds);
    return roundRect(window.getBounds());
  }

  function buildSnapshot(): PetSnapshot {
    const bounds = currentBounds();
    const all = readDisplays();
    let matched: DisplayFacade | undefined;
    let bestArea = -1;
    for (const display of all) {
      const area = overlapArea(bounds, display.bounds);
      if (area > bestArea) {
        bestArea = area;
        matched = display;
      }
    }
    return {
      state,
      bounds,
      displayId: matched?.id ?? 0,
      displayCount: all.length,
      scaleFactor: matched?.scaleFactor ?? 1,
      clickThrough: !(interactive || dragging),
      dragging,
    };
  }

  function emitNow(): void {
    if (disposed) return;
    const snapshot = buildSnapshot();
    lastSnapshot = snapshot;
    try {
      options.onSnapshot(snapshot);
    } catch {
      // 订阅方（主会话广播）出错不应打断窗口生命周期。
    }
  }

  /** 首次快照立即发送，后续合并短时间内的重复变化。 */
  function scheduleSnapshot(): void {
    if (disposed) return;
    if (lastSnapshot === null || snapshotDebounceMs <= 0) {
      emitNow();
      return;
    }
    if (snapshotTimer !== null) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      emitNow();
    }, snapshotDebounceMs);
  }

  /**
   * 清除 hover 意图。拖拽期间只能清意图，绝不允许开启原生穿透：
   * 渲染器在拖拽途中收到 pointerleave（指针移出窗口/命中区）会调用它，
   * 若此时 setIgnoreMouseEvents(true)，窗口会在拖拽中途丢失鼠标事件，
   * 快照却仍报 dragging=true，OS 行为与快照矛盾。穿透统一由 stopDrag 恢复。
   */
  function releaseInteraction(): void {
    releaseTimer = clearTimer(releaseTimer, 'timeout');
    if (!interactive) return;
    interactive = false;
    if (dragging) {
      // 拖拽中：只清意图，保持非穿透，等 stopDrag 再决定。
      scheduleSnapshot();
      return;
    }
    applyClickThrough(true);
    scheduleSnapshot();
  }

  function scheduleInteractionRelease(): void {
    if (!interactive || dragging) return;
    releaseTimer = clearTimer(releaseTimer, 'timeout');
    if (releaseDelayMs <= 0) {
      releaseInteraction();
      return;
    }
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      releaseInteraction();
    }, releaseDelayMs);
  }

  /** 拖拽结束后把窗口完整夹回目标屏可见范围；拖拽过程中不调用，避免吸附。 */
  function restoreAfterDrag(): void {
    if (!isAlive()) return;
    const before = currentBounds();
    const next = restoreVisible(before, readDisplays().map(toDisplayLike));
    if (!sameBounds(before, next)) window.setBounds(next, false);
  }

  function stopDrag(): void {
    dragWatchdog = clearTimer(dragWatchdog, 'timeout');
    dragTick = clearTimer(dragTick, 'interval');
    if (!dragging) return;
    dragging = false;
    dragStartCursor = null;
    // 先恢复几何，再决定穿透，保证最后一条快照里的 bounds 与 OS 一致。
    restoreAfterDrag();
    // 拖拽结束不抢焦点；指针仍在角色上时保持可交互，否则恢复穿透。
    if (interactive) {
      applyClickThrough(false);
      scheduleInteractionRelease();
    } else {
      applyClickThrough(true);
    }
    scheduleSnapshot();
  }

  function followCursor(): void {
    if (!isAlive() || !dragging) return;
    const start = dragStartCursor;
    if (start === null) return;
    let cursor: { x: number; y: number };
    try {
      cursor = electron.screen.getCursorScreenPoint();
    } catch {
      stopDrag();
      return;
    }
    const target = dragPosition(dragStartBounds, start, cursor);
    const next = roundRect({ ...dragStartBounds, ...target });
    if (!sameBounds(next, currentBounds())) {
      window.setBounds(next, false);
      scheduleSnapshot();
    }
  }

  /**
   * 屏幕被移除、分辨率或缩放变化后，把窗口拉回目标屏的可见区域。
   *
   * 用 restoreVisible 而不是 ensureVisible：屏幕变化后如果目标屏放得下整个窗口，
   * 就要夹回完整可见范围，否则用户可能只剩一条 48DIP 的透明边在屏幕上，
   * 角色和退出按钮都看不见。已经完全可见的窗口不会被移动（不产生抖动）。
   *
   * 即使 bounds 没有变化也必须广播：DPI 或显示器数量变化不会改变窗口几何，
   * 但 displayId/displayCount/scaleFactor 已经变了，UI 依赖这些字段。
   */
  function recoverVisibility(): void {
    if (!isAlive()) return;
    const before = currentBounds();
    const next = restoreVisible(before, readDisplays().map(toDisplayLike));
    if (!sameBounds(before, next)) window.setBounds(next, false);
    scheduleSnapshot();
  }

  function detachDisplayListeners(): void {
    const screenWithOff = electron.screen as unknown as {
      off?(event: string, listener: () => void): unknown;
    };
    if (typeof screenWithOff.off !== 'function') return;
    for (const { event, listener } of displayListeners) {
      screenWithOff.off(event, listener);
    }
    displayListeners.length = 0;
  }

  function handleReadyToShow(): void {
    if (!isAlive()) return;
    // showInactive：显示时不抢当前应用的前台焦点。
    window.showInactive();
  }

  function handleBlur(): void {
    if (disposed) return;
    stopDrag();
    releaseInteraction();
  }

  function handleUnresponsive(): void {
    if (disposed) return;
    stopDrag();
    releaseInteraction();
  }

  function handleClosed(): void {
    // 关闭后只清理本地状态与计时器，不再回调窗口或广播。
    disposed = true;
    dragTick = clearTimer(dragTick, 'interval');
    dragWatchdog = clearTimer(dragWatchdog, 'timeout');
    snapshotTimer = clearTimer(snapshotTimer, 'timeout');
    releaseTimer = clearTimer(releaseTimer, 'timeout');
    dragStartCursor = null;
    dragging = false;
    interactive = false;
    detachDisplayListeners();
  }

  window.once('ready-to-show', handleReadyToShow);
  window.on('blur', handleBlur);
  window.once('unresponsive', handleUnresponsive);
  window.on('closed', handleClosed);

  // 屏幕被拔出、分辨率或缩放变化时，把窗口拉回可见区域。
  const displayEvents = electron.screen as unknown as {
    on?(event: string, listener: () => void): unknown;
  };
  const displayListeners: Array<{ event: string; listener: () => void }> = [];
  for (const event of ['display-removed', 'display-added', 'display-metrics-changed']) {
    const listener = (): void => {
      if (!disposed) recoverVisibility();
    };
    if (typeof displayEvents.on === 'function') {
      displayEvents.on(event, listener);
      displayListeners.push({ event, listener });
    }
  }

  // 加载失败不能让窗口静默空白：切到 error 状态并由主会话决定后续提示。
  const loadFile = window.loadFile;
  if (typeof loadFile === 'function') {
    void loadFile.call(window, options.rendererPath).catch(() => {
      if (disposed) return;
      state = 'error';
      scheduleSnapshot();
    });
  }

  emitNow();

  const controller: PetWindowController = {
    window,
    getSnapshot(): PetSnapshot {
      // 实时读取窗口几何：窗口可能被 OS 直接移动，缓存值会过期。
      if (disposed) return lastSnapshot ?? buildSnapshot();
      return buildSnapshot();
    },
    setInteraction(next: boolean): void {
      if (disposed) return;
      if (next) {
        releaseTimer = clearTimer(releaseTimer, 'timeout');
        if (interactive && !dragging) return;
        interactive = true;
        if (!dragging) applyClickThrough(false);
        scheduleSnapshot();
        return;
      }
      releaseInteraction();
    },
    beginDrag(): void {
      if (disposed || dragging) return;
      dragging = true;
      releaseTimer = clearTimer(releaseTimer, 'timeout');
      dragStartBounds = currentBounds();
      try {
        dragStartCursor = electron.screen.getCursorScreenPoint();
      } catch {
        dragStartCursor = null;
      }
      // 拖拽期间必须能接收鼠标事件，否则窗口无法跟随光标。
      applyClickThrough(false);
      dragTick = clearTimer(dragTick, 'interval');
      dragTick = setInterval(followCursor, dragTickMs);
      dragWatchdog = clearTimer(dragWatchdog, 'timeout');
      dragWatchdog = setTimeout(() => {
        dragWatchdog = null;
        stopDrag();
      }, dragTimeoutMs);
      scheduleSnapshot();
    },
    endDrag(): void {
      if (disposed) return;
      stopDrag();
    },
    setState(next: PetState): void {
      if (disposed) return;
      if (!isPetState(next)) return;
      if (next === state) return;
      state = next;
      scheduleSnapshot();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      dragTick = clearTimer(dragTick, 'interval');
      dragWatchdog = clearTimer(dragWatchdog, 'timeout');
      snapshotTimer = clearTimer(snapshotTimer, 'timeout');
      releaseTimer = clearTimer(releaseTimer, 'timeout');
      dragStartCursor = null;
      dragging = false;
      interactive = false;
      detachDisplayListeners();
      if (!window.isDestroyed()) window.destroy();
    },
  };

  return controller;
}
