import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { PetSnapshot, PetState } from '@pet/contracts';

import type { DisplayFacade, ElectronFacade, WindowFacade } from './electron-runtime.js';
import { createPetWindow, type PetWindowDependencies } from './pet-window.js';

interface MockWindow extends WindowFacade {
  options: Record<string, unknown>;
  bounds: { x: number; y: number; width: number; height: number };
  destroyed: boolean;
  visible: boolean;
  ignoreMouseCalls: Array<{ ignore: boolean; options?: { forward?: boolean } }>;
  listeners: Map<string, Array<(...args: unknown[]) => void>>;
  emit(event: string): void;
  setBoundsCalls: Array<{ x: number; y: number; width: number; height: number }>;
  loadFileCalls: string[];
}

const primary: DisplayFacade = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

const secondary: DisplayFacade = {
  id: 2,
  bounds: { x: -2560, y: 0, width: 2560, height: 1440 },
  workArea: { x: -2560, y: 0, width: 2560, height: 1400 },
  scaleFactor: 1.5,
};

function createHarness(
  overrides: {
    displays?: DisplayFacade[];
    cursor?: { x: number; y: number };
    loadFile?: () => Promise<void>;
  } = {},
) {
  const windows: MockWindow[] = [];
  const displays = overrides.displays ?? [primary];
  let cursor = overrides.cursor ?? { x: 0, y: 0 };

  class BrowserWindowMock implements MockWindow {
    options: Record<string, unknown>;
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    destroyed = false;
    visible = false;
    ignoreMouseCalls: Array<{ ignore: boolean; options?: { forward?: boolean } }> = [];
    listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    setBoundsCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
    loadFileCalls: string[] = [];

    constructor(options: Record<string, unknown>) {
      this.options = options;
      const x = typeof options['x'] === 'number' ? options['x'] : 0;
      const y = typeof options['y'] === 'number' ? options['y'] : 0;
      const width = typeof options['width'] === 'number' ? options['width'] : 0;
      const height = typeof options['height'] === 'number' ? options['height'] : 0;
      this.bounds = { x, y, width, height };
      windows.push(this);
    }

    setBounds(next: { x: number; y: number; width: number; height: number }): void {
      this.bounds = { ...next };
      this.setBoundsCalls.push({ ...next });
    }
    getBounds() {
      return { ...this.bounds };
    }
    setPosition(x: number, y: number): void {
      this.bounds = { ...this.bounds, x, y };
    }
    setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
      this.ignoreMouseCalls.push(options === undefined ? { ignore } : { ignore, options });
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    isVisible(): boolean {
      return this.visible;
    }
    showInactive(): void {
      this.visible = true;
    }
    destroy(): void {
      this.destroyed = true;
      this.emit('closed');
    }
    on(event: string, listener: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
      return this;
    }
    once(event: string, listener: (...args: unknown[]) => void): this {
      return this.on(event, listener);
    }
    loadFile(filePath: string): Promise<void> {
      this.loadFileCalls.push(filePath);
      return overrides.loadFile ? overrides.loadFile() : Promise.resolve();
    }
    emit(event: string): void {
      for (const listener of this.listeners.get(event) ?? []) listener();
    }
  }

  const displayListeners = new Map<string, Array<() => void>>();
  const screenMock = {
    getPrimaryDisplay: () => primary,
    getAllDisplays: () => displays,
    getCursorScreenPoint: () => cursor,
    on(event: string, listener: () => void): void {
      const list = displayListeners.get(event) ?? [];
      list.push(listener);
      displayListeners.set(event, list);
    },
    off(event: string, listener: () => void): void {
      const list = (displayListeners.get(event) ?? []).filter((item) => item !== listener);
      displayListeners.set(event, list);
    },
  };
  const electron: ElectronFacade = {
    screen: screenMock as unknown as ElectronFacade['screen'],
    BrowserWindow: BrowserWindowMock as unknown as ElectronFacade['BrowserWindow'],
  };

  return {
    electron,
    windows,
    moveCursor(next: { x: number; y: number }): void {
      cursor = next;
    },
    emitDisplayEvent(event: string): void {
      for (const listener of displayListeners.get(event) ?? []) listener();
    },
    displayListenerCount(event: string): number {
      return (displayListeners.get(event) ?? []).length;
    },
    get cursor() {
      return cursor;
    },
  };
}

const baseOptions = {
  preloadPath: 'C:/build/preload/pet.mjs',
  rendererPath: 'C:/build/renderer/pet/index.html',
  onSnapshot: (): void => {},
};

describe('createPetWindow 创建与安全基线', () => {
  it('拒绝缺失的构建产物路径与回调', () => {
    expect(() =>
      createPetWindow({ ...baseOptions, preloadPath: '' }, { electron: createHarness().electron }),
    ).toThrow(/preloadPath/);
    expect(() =>
      createPetWindow({ ...baseOptions, rendererPath: '' }, { electron: createHarness().electron }),
    ).toThrow(/rendererPath/);
    const withoutCallback = {
      preloadPath: baseOptions.preloadPath,
      rendererPath: baseOptions.rendererPath,
    } as unknown as Parameters<typeof createPetWindow>[0];
    expect(() => createPetWindow(withoutCallback, { electron: createHarness().electron })).toThrow(
      /onSnapshot/,
    );
  });

  it('使用透明无边框置顶、不抢焦点的窗口参数', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, { electron: harness.electron });
    const options = harness.windows[0]?.options ?? {};
    expect(options['transparent']).toBe(true);
    expect(options['frame']).toBe(false);
    expect(options['alwaysOnTop']).toBe(true);
    expect(options['show']).toBe(false);
    expect(options['skipTaskbar']).toBe(true);
    expect(options['resizable']).toBe(false);

    const web = options['webPreferences'] as Record<string, unknown>;
    expect(web['sandbox']).toBe(true);
    expect(web['contextIsolation']).toBe(true);
    expect(web['nodeIntegration']).toBe(false);
    expect(web['preload']).toBe(baseOptions.preloadPath);
    expect(web['webviewTag']).toBe(false);
    controller.dispose();
  });

  it('默认开启鼠标穿透并转发移动事件，ready-to-show 才 showInactive', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, { electron: harness.electron });
    const window = harness.windows[0] as MockWindow;

    expect(window.ignoreMouseCalls[0]).toEqual({ ignore: true, options: { forward: true } });
    expect(window.visible).toBe(false);

    window.emit('ready-to-show');
    expect(window.visible).toBe(true);
    controller.dispose();
  });

  it('loadFile 使用主会话给的绝对渲染器路径', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, { electron: harness.electron });
    expect((harness.windows[0] as MockWindow).loadFileCalls).toEqual([baseOptions.rendererPath]);
    controller.dispose();
  });

  it('loadFile 失败时切到 error 状态并上报，不抛未处理异常', async () => {
    const snapshots: PetSnapshot[] = [];
    const harness = createHarness({ loadFile: () => Promise.reject(new Error('ENOENT')) });
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(snapshots.at(-1)?.state).toBe('error');
    controller.dispose();
  });

  it('初始快照是 idle 且几何在屏幕可见区域内', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, { electron: harness.electron });
    const snapshot = controller.getSnapshot();
    expect(snapshot.state).toBe('idle');
    expect(snapshot.dragging).toBe(false);
    expect(snapshot.clickThrough).toBe(true);
    expect(snapshot.displayId).toBe(primary.id);
    expect(snapshot.displayCount).toBe(1);
    expect(snapshot.scaleFactor).toBe(1);
    expect(snapshot.bounds.x + snapshot.bounds.width).toBeLessThanOrEqual(
      primary.workArea.x + primary.workArea.width,
    );
    controller.dispose();
  });
});

describe('交互与穿透切换', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('命中区请求交互时关闭穿透，离开后恢复穿透', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      interactionReleaseDelayMs: 100,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    window.ignoreMouseCalls.length = 0;

    controller.setInteraction(true);
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: false, options: { forward: true } });
    expect(controller.getSnapshot().clickThrough).toBe(false);

    controller.setInteraction(false);
    vi.advanceTimersByTime(100);
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: true, options: { forward: true } });
    expect(controller.getSnapshot().clickThrough).toBe(true);
    controller.dispose();
  });

  it('重复上报交互不会反复切换穿透状态', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    window.ignoreMouseCalls.length = 0;
    controller.setInteraction(true);
    controller.setInteraction(true);
    controller.setInteraction(true);
    expect(window.ignoreMouseCalls).toHaveLength(1);
    controller.dispose();
  });

  it('失焦立即结束拖拽并恢复穿透', () => {
    const harness = createHarness({ cursor: { x: 100, y: 100 } });
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    controller.setInteraction(true);
    controller.beginDrag();
    expect(controller.getSnapshot().dragging).toBe(true);

    window.emit('blur');
    expect(controller.getSnapshot().dragging).toBe(false);
    expect(controller.getSnapshot().clickThrough).toBe(true);
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: true, options: { forward: true } });
    controller.dispose();
  });
});

describe('拖拽几何', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(deps: Partial<PetWindowDependencies> = {}) {
    const harness = createHarness({ cursor: { x: 900, y: 500 } });
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0, ...deps },
    );
    return { harness, controller, snapshots, window: harness.windows[0] as MockWindow };
  }

  it('只按光标 DIP 差值移动，渲染器不参与坐标', () => {
    const { harness, controller, window } = make();
    const start = window.getBounds();
    controller.beginDrag();
    harness.moveCursor({ x: 950, y: 460 });
    vi.advanceTimersByTime(16);
    expect(window.getBounds()).toEqual({
      x: start.x + 50,
      y: start.y - 40,
      width: start.width,
      height: start.height,
    });
    controller.endDrag();
    controller.dispose();
  });

  it('跨到负坐标副屏时按 DIP 平移，不因 scaleFactor 二次缩放', () => {
    const harness = createHarness({ displays: [primary, secondary], cursor: { x: 100, y: 300 } });
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    const start = window.getBounds();
    controller.beginDrag();
    harness.moveCursor({ x: -2500, y: 300 });
    vi.advanceTimersByTime(16);
    expect(window.getBounds().x).toBe(start.x - 2600);
    expect(controller.getSnapshot().displayId).toBe(secondary.id);
    expect(controller.getSnapshot().scaleFactor).toBe(1.5);
    expect(controller.getSnapshot().displayCount).toBe(2);
    controller.endDrag();
    controller.dispose();
  });

  it('拖拽期间保持非穿透，结束后按指针位置决定', () => {
    const { controller, window } = make();
    window.ignoreMouseCalls.length = 0;
    controller.beginDrag();
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: false, options: { forward: true } });
    controller.endDrag();
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: true, options: { forward: true } });
    controller.dispose();
  });

  it('拖拽超时自动结束，不会卡在拖拽态', () => {
    const { controller } = make({ dragTimeoutMs: 1000, dragTickMs: 100 });
    controller.beginDrag();
    expect(controller.getSnapshot().dragging).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(controller.getSnapshot().dragging).toBe(false);
    controller.dispose();
  });

  it('重复 beginDrag 不会叠加计时器', () => {
    const { controller } = make({ dragTimeoutMs: 1000, dragTickMs: 100 });
    controller.beginDrag();
    controller.beginDrag();
    controller.beginDrag();
    vi.advanceTimersByTime(999);
    expect(controller.getSnapshot().dragging).toBe(true);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().dragging).toBe(false);
    controller.dispose();
  });

  it('dispose 后计时器不再触发回调', () => {
    const { controller, snapshots } = make({ dragTimeoutMs: 1000, dragTickMs: 100 });
    controller.beginDrag();
    const count = snapshots.length;
    controller.dispose();
    vi.advanceTimersByTime(5000);
    expect(snapshots.length).toBe(count);
  });
});

describe('状态与生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('接受五种状态并去重广播', () => {
    const harness = createHarness();
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    const states: PetState[] = ['listening', 'thinking', 'replying', 'error', 'idle'];
    for (const state of states) controller.setState(state);
    expect(snapshots.map((s) => s.state)).toEqual(['idle', ...states]);
    const before = snapshots.length;
    controller.setState('idle');
    expect(snapshots.length).toBe(before);
    controller.dispose();
  });

  it('拒绝未声明的状态值', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    controller.setState('recording' as PetState);
    expect(controller.getSnapshot().state).toBe('idle');
    controller.dispose();
  });

  it('onSnapshot 抛错不影响窗口生命周期', () => {
    const harness = createHarness();
    const controller = createPetWindow(
      {
        ...baseOptions,
        onSnapshot: () => {
          throw new Error('广播失败');
        },
      },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    expect(() => controller.setState('thinking')).not.toThrow();
    expect(controller.getSnapshot().state).toBe('thinking');
    controller.dispose();
  });

  it('dispose 销毁窗口并清空计时器，之后调用是安全的空操作', () => {
    const harness = createHarness();
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    controller.beginDrag();
    controller.dispose();
    expect(window.destroyed).toBe(true);
    expect(() => controller.dispose()).not.toThrow();
    expect(() => controller.setState('error')).not.toThrow();
    expect(() => controller.setInteraction(true)).not.toThrow();
    expect(() => controller.beginDrag()).not.toThrow();
    expect(() => controller.endDrag()).not.toThrow();
    expect(window.setBoundsCalls.length).toBe(0);
    expect(harness.displayListenerCount('display-removed')).toBe(0);
  });

  it('窗口被外部关闭后不再广播快照', () => {
    const harness = createHarness();
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    const window = harness.windows[0] as MockWindow;
    const count = snapshots.length;
    window.destroy();
    controller.setState('error');
    controller.setInteraction(true);
    expect(snapshots.length).toBe(count);
    controller.dispose();
  });
});

describe('拖拽期间的穿透不变式', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(deps: Partial<PetWindowDependencies> = {}) {
    const harness = createHarness({ cursor: { x: 900, y: 500 } });
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0, ...deps },
    );
    return { harness, controller, snapshots, window: harness.windows[0] as MockWindow };
  }

  it('拖拽途中 pointerleave 清零 hover 意图但绝不开启原生穿透', () => {
    const { controller, snapshots, window } = make({ interactionReleaseDelayMs: 0 });
    controller.setInteraction(true);
    controller.beginDrag();
    window.ignoreMouseCalls.length = 0;

    // 渲染器在拖拽中收到 pointerleave 时会上报 setInteraction(false)。
    controller.setInteraction(false);

    // 关键回归：拖拽期间不得出现任何 ignore=true 的调用。
    expect(window.ignoreMouseCalls.filter((call) => call.ignore)).toEqual([]);
    const last = snapshots.at(-1);
    expect(last?.dragging).toBe(true);
    // 快照必须与 OS 行为一致：仍在拖拽 => 不能报穿透。
    expect(last?.clickThrough).toBe(false);
    expect(controller.getSnapshot().clickThrough).toBe(false);

    controller.endDrag();
    controller.dispose();
  });

  it('拖拽中 hover 意图被清零后，结束拖拽立即恢复穿透（不再等释放延迟）', () => {
    const { controller, window } = make({ interactionReleaseDelayMs: 500 });
    controller.setInteraction(true);
    controller.beginDrag();
    controller.setInteraction(false);
    window.ignoreMouseCalls.length = 0;

    controller.endDrag();
    // 意图已经清零，endDrag 后必须马上恢复穿透，而不是留下 500ms 的可交互窗口。
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: true, options: { forward: true } });
    expect(controller.getSnapshot().clickThrough).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: true, options: { forward: true } });
    controller.dispose();
  });

  it('拖拽中重复 setInteraction(false) 不会累积释放计时器或切换穿透', () => {
    const { controller, window } = make({ interactionReleaseDelayMs: 100 });
    controller.setInteraction(true);
    controller.beginDrag();
    window.ignoreMouseCalls.length = 0;
    controller.setInteraction(false);
    controller.setInteraction(false);
    vi.advanceTimersByTime(100);
    expect(window.ignoreMouseCalls.filter((call) => call.ignore)).toEqual([]);
    expect(controller.getSnapshot().dragging).toBe(true);
    controller.dispose();
  });

  it('拖拽中失焦走同一路径：先结束拖拽再恢复穿透', () => {
    const { controller, window } = make({ interactionReleaseDelayMs: 0 });
    controller.setInteraction(true);
    controller.beginDrag();
    controller.setInteraction(false);
    window.ignoreMouseCalls.length = 0;
    window.emit('blur');
    expect(controller.getSnapshot().dragging).toBe(false);
    expect(window.ignoreMouseCalls.at(-1)).toEqual({ ignore: true, options: { forward: true } });
    expect(controller.getSnapshot().clickThrough).toBe(true);
    controller.dispose();
  });
});

describe('拖拽结束后的完整可见恢复', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('结束拖拽时把窗口完整夹回工作区，而不是只留 48DIP 透明边', () => {
    const harness = createHarness({ cursor: { x: 900, y: 500 } });
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    const window = harness.windows[0] as MockWindow;
    controller.beginDrag();
    // 拖到主屏右下角之外，只剩一条边在屏幕上。
    window.setBounds({ x: 1870, y: 900, width: 380, height: 420 });
    controller.endDrag();

    const bounds = window.getBounds();
    const area = primary.workArea;
    expect(bounds.x).toBeGreaterThanOrEqual(area.x);
    expect(bounds.y).toBeGreaterThanOrEqual(area.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
    // 最后一条快照必须与 OS 几何一致，否则 UI 会显示过期坐标。
    expect(snapshots.at(-1)?.bounds).toEqual(bounds);
    expect(snapshots.at(-1)?.dragging).toBe(false);
    controller.dispose();
  });

  it('拖拽跟手过程中不吸附：越界位置原样保留，只有结束才恢复', () => {
    const harness = createHarness({ cursor: { x: 900, y: 500 } });
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    const start = window.getBounds();
    controller.beginDrag();
    // 把光标拖到主屏右下角之外，跟手位置本身就已经越界。
    harness.moveCursor({ x: 4000, y: 4000 });
    vi.advanceTimersByTime(16);
    const during = window.getBounds();
    expect(during.x).toBe(start.x + 3100);
    expect(during.y).toBe(start.y + 3500);
    // 拖拽期间继续推进 tick，位置不应被可见恢复逻辑“吸”回屏幕。
    vi.advanceTimersByTime(16 * 5);
    expect(window.getBounds()).toEqual(during);

    controller.endDrag();
    const after = window.getBounds();
    expect(after).not.toEqual(during);
    expect(after.x).toBeLessThanOrEqual(primary.workArea.x + primary.workArea.width - after.width);
    expect(after.y).toBeLessThanOrEqual(
      primary.workArea.y + primary.workArea.height - after.height,
    );
    controller.dispose();
  });

  it('小屏放不下整个窗口时，结束时仍尽量多留可见像素', () => {
    const tiny: DisplayFacade = {
      id: 9,
      bounds: { x: 0, y: 0, width: 320, height: 240 },
      workArea: { x: 0, y: 0, width: 320, height: 200 },
      scaleFactor: 1,
    };
    const harness = createHarness({ displays: [tiny], cursor: { x: 0, y: 0 } });
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    controller.beginDrag();
    window.setBounds({ x: -2000, y: -2000, width: 380, height: 420 });
    controller.endDrag();
    const bounds = window.getBounds();
    // 小屏放不下整个窗口：窗口盖满工作区，可见面积最大化（不再只留 48DIP 透明边）。
    expect(bounds.x).toBeLessThanOrEqual(tiny.workArea.x);
    expect(bounds.y).toBeLessThanOrEqual(tiny.workArea.y);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(tiny.workArea.x + tiny.workArea.width);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(tiny.workArea.y + tiny.workArea.height);
    expect(bounds.width).toBe(380);
    controller.dispose();
  });
});

describe('显示器/DPI 变化后的快照广播', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds 未变但 DPI 变化时仍广播新快照', () => {
    const displays = [primary];
    const harness = createHarness({ displays });
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    const window = harness.windows[0] as MockWindow;
    const boundsBefore = window.getBounds();
    expect(snapshots.at(-1)?.scaleFactor).toBe(1);
    const countBefore = snapshots.length;

    // 用户把主屏缩放从 100% 调到 150%：窗口 DIP 几何不变。
    displays[0] = { ...primary, scaleFactor: 1.5 };
    harness.emitDisplayEvent('display-metrics-changed');

    expect(window.getBounds()).toEqual(boundsBefore);
    expect(window.setBoundsCalls).toEqual([]);
    expect(snapshots.length).toBe(countBefore + 1);
    expect(snapshots.at(-1)?.scaleFactor).toBe(1.5);
    controller.dispose();
  });

  it('新增显示器后即使几何不变也广播新的 displayCount', () => {
    const displays = [primary];
    const harness = createHarness({ displays });
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    expect(snapshots.at(-1)?.displayCount).toBe(1);

    displays.push(secondary);
    harness.emitDisplayEvent('display-added');

    expect(snapshots.at(-1)?.displayCount).toBe(2);
    expect(snapshots.at(-1)?.displayId).toBe(primary.id);
    controller.dispose();
  });

  it('屏幕变化后按完整可见恢复，而不是只留 48DIP 透明边', () => {
    const displays = [primary, secondary];
    const harness = createHarness({ displays });
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    // 副屏被拔掉后，窗口只与主屏右下角相交一条边。
    window.setBounds({ x: 1870, y: 900, width: 380, height: 420 });
    displays.splice(1, 1);
    harness.emitDisplayEvent('display-removed');

    const bounds = window.getBounds();
    const area = primary.workArea;
    expect(bounds.x).toBeGreaterThanOrEqual(area.x);
    expect(bounds.y).toBeGreaterThanOrEqual(area.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
    expect(controller.getSnapshot().bounds).toEqual(bounds);
    controller.dispose();
  });

  it('窗口已经完整可见时，显示器事件不移动窗口但照样广播', () => {
    const displays = [primary];
    const harness = createHarness({ displays });
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    const window = harness.windows[0] as MockWindow;
    const before = window.getBounds();
    const count = snapshots.length;

    displays[0] = { ...primary, scaleFactor: 1.25 };
    harness.emitDisplayEvent('display-metrics-changed');

    expect(window.getBounds()).toEqual(before);
    expect(window.setBoundsCalls).toEqual([]);
    expect(snapshots.length).toBe(count + 1);
    expect(snapshots.at(-1)?.scaleFactor).toBe(1.25);
    controller.dispose();
  });

  it('所有显示器事件类型都会发布快照', () => {
    const displays = [primary];
    const harness = createHarness({ displays });
    const snapshots: PetSnapshot[] = [];
    const controller = createPetWindow(
      { ...baseOptions, onSnapshot: (snapshot) => snapshots.push(snapshot) },
      { electron: harness.electron, snapshotDebounceMs: 0 },
    );
    for (const event of ['display-removed', 'display-added', 'display-metrics-changed']) {
      const before = snapshots.length;
      harness.emitDisplayEvent(event);
      expect(snapshots.length).toBe(before + 1);
    }
    controller.dispose();
  });
});

describe('屏幕变化后的可见恢复', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('副屏被移除后窗口回到主屏可见区域', () => {
    const displays = [primary, secondary];
    const harness = createHarness({ displays });
    const controller = createPetWindow(baseOptions, {
      electron: harness.electron,
      snapshotDebounceMs: 0,
    });
    const window = harness.windows[0] as MockWindow;
    window.setBounds({ x: -2400, y: 200, width: 360, height: 420 });
    expect(controller.getSnapshot().displayId).toBe(secondary.id);

    // 模拟 OS 移除副屏：display 列表变化后触发 display-removed。
    displays.splice(1, 1);
    harness.emitDisplayEvent('display-removed');

    const recovered = window.getBounds();
    expect(recovered.x).toBeGreaterThanOrEqual(primary.workArea.x - 360);
    expect(recovered.x + recovered.width).toBeGreaterThan(primary.workArea.x);
    expect(controller.getSnapshot().displayCount).toBe(1);
    expect(controller.getSnapshot().displayId).toBe(primary.id);
    controller.dispose();
  });
});
