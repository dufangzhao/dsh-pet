import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PetPrototypeBridge, PetSnapshot, PetState } from '@pet/contracts';

import { PetApp } from './App.js';
import { PetAvatar } from './PetAvatar.js';
import { PetBubble } from './PetBubble.js';
import { PrototypePanel } from './PrototypePanel.js';
import { PET_COPY, PET_STATE_ORDER, stateLabel, stateTestId } from './copy.js';
import { PetDragController, RENDERER_DRAG_TIMEOUT_MS } from './drag-controller.js';
import {
  avatarHitShapes,
  expandHitRect,
  isPointInHitShapes,
  isPointInteractive,
  mapViewBox,
  toHitRect,
} from './hit-regions.js';
import {
  callBridge,
  describeBridgeError,
  isPetPrototypeBridge,
  readBridge,
} from './use-pet-bridge.js';

function markup(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('文案与状态标识', () => {
  it('五种状态各有中文标签与稳定的 testid', () => {
    expect(PET_STATE_ORDER).toEqual(['idle', 'listening', 'thinking', 'replying', 'error']);
    for (const state of PET_STATE_ORDER) {
      expect(stateLabel(state)).not.toBe('');
      expect(stateTestId(state)).toBe(`state-${state}`);
    }
  });

  it('明确标注 M0 为模拟，不声称已录音或联网', () => {
    const notice = PET_COPY.simulationNotice;
    expect(notice).toContain('M0');
    expect(notice).toContain('模拟');
    expect(notice).toMatch(/不录音|不联网/);
    expect(PET_COPY.stateBubbles.listening).toContain('模拟');
    expect(PET_COPY.stateBubbles.replying).toContain('模拟');
  });
});

describe('矩形命中区（面板按钮等真实矩形）', () => {
  const panel = toHitRect({ left: 20, top: 240, width: 300, height: 140 });

  it('按钮矩形内判定为可交互', () => {
    expect(isPointInteractive({ x: 100, y: 300 }, [panel])).toBe(true);
  });

  it('矩形外的空白判定为穿透', () => {
    expect(isPointInteractive({ x: 5, y: 5 }, [panel])).toBe(false);
  });

  it('边缘留少量余量，避免 1px 抖动', () => {
    expect(expandHitRect(panel, 4).right).toBe(324);
    expect(isPointInteractive({ x: 322, y: 300 }, [panel])).toBe(true);
    expect(isPointInteractive({ x: 330, y: 300 }, [panel])).toBe(false);
  });

  it('多个矩形取并集', () => {
    const quit = toHitRect({ left: 20, top: 400, width: 120, height: 32 });
    expect(isPointInteractive({ x: 100, y: 300 }, [panel, quit])).toBe(true);
    // 380 距面板下沿 380 只有 0，仍落在 4px 余量内，因此用更远的 392 验证间隙。
    expect(isPointInteractive({ x: 100, y: 392 }, [panel, quit])).toBe(false);
    expect(isPointInteractive({ x: 60, y: 410 }, [panel, quit])).toBe(true);
  });

  it('没有命中区时永远穿透', () => {
    expect(isPointInteractive({ x: 100, y: 100 }, [])).toBe(false);
  });

  it('整个角色容器（含气泡）的矩形不再是命中依据', () => {
    // 这是主会话指出的旧缺陷：外接矩形会把气泡与透明角也算成可交互。
    const container = { left: 12, top: 8, width: 356, height: 300 };
    const containerRect = toHitRect(container);
    // 容器矩形本身会命中外接框内的任意点……
    expect(isPointInteractive({ x: 20, y: 20 }, [containerRect])).toBe(true);
    // ……但角色真实命中形状不会，透明角必须穿透。
    const shapes = avatarHitShapes(container);
    expect(isPointInHitShapes({ x: 20, y: 20 }, shapes)).toBe(false);
    expect(isPointInHitShapes({ x: 190, y: 84 }, shapes)).toBe(true);
  });
});

describe('角色命中区使用真实绘制形状，而不是外接矩形', () => {
  /** 与 PetAvatar 的 CSS 尺寸一致：152×152 的 viewBox 正方形。 */
  const rect = { left: 20, top: 10, width: 152, height: 152 };
  const shapes = avatarHitShapes(rect);

  it('躯干中心命中', () => {
    expect(isPointInHitShapes({ x: 96, y: 86 }, shapes)).toBe(true);
  });

  it('外接矩形的四个透明角一律穿透', () => {
    // 152 的方框里，(20,10) 是左上角，角色身体是居中的椭圆，这里完全透明。
    expect(isPointInHitShapes({ x: 22, y: 12 }, shapes)).toBe(false);
    expect(isPointInHitShapes({ x: 170, y: 12 }, shapes)).toBe(false);
    expect(isPointInHitShapes({ x: 22, y: 158 }, shapes)).toBe(false);
    expect(isPointInHitShapes({ x: 170, y: 158 }, shapes)).toBe(false);
  });

  it('耳朵的三角区域命中，耳朵外侧的空白穿透', () => {
    // viewBox 坐标 (50, 26) 落在左耳三角形内。
    const earPoint = { x: rect.left + 50, y: rect.top + 26 };
    expect(isPointInHitShapes(earPoint, shapes)).toBe(true);
    // (20, 20) 在左耳左侧、躯干上方的空白里。
    expect(isPointInHitShapes({ x: rect.left + 12, y: rect.top + 20 }, shapes)).toBe(false);
  });

  it('viewBox 等比缩放并居中，映射与浏览器 preserveAspectRatio 一致', () => {
    const mapping = mapViewBox({ left: 0, top: 0, width: 320, height: 160 });
    expect(mapping.scale).toBe(1);
    // 宽 320 高 160 的框里，160×160 的 viewBox 水平居中。
    expect(mapping.left).toBe(80);
    expect(mapping.top).toBe(0);
  });

  it('零尺寸元素不产生任何命中区', () => {
    expect(avatarHitShapes({ left: 0, top: 0, width: 0, height: 0 })).toEqual([]);
    expect(isPointInHitShapes({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('拖拽控制器：六条结束路径都要释放', () => {
  function make() {
    const calls: string[] = [];
    const captured: number[] = [];
    const released: number[] = [];
    const target = {
      setPointerCapture(pointerId: number): void {
        captured.push(pointerId);
      },
      releasePointerCapture(pointerId: number): void {
        released.push(pointerId);
      },
    };
    const active: boolean[] = [];
    const controller = new PetDragController({
      bridge: {
        beginDrag: () => calls.push('begin'),
        endDrag: () => calls.push('end'),
      },
      onActiveChange: (value) => active.push(value),
    });
    return { controller, calls, captured, released, target, active };
  }

  it('开始拖拽时捕获指针并只调用一次 beginDrag', () => {
    const { controller, calls, captured, target, active } = make();
    expect(controller.begin({ button: 0, pointerId: 7 }, target)).toBe(true);
    expect(controller.isActive()).toBe(true);
    expect(calls).toEqual(['begin']);
    expect(captured).toEqual([7]);
    expect(active).toEqual([true]);
    controller.dispose();
  });

  it('非主键不开始拖拽', () => {
    const { controller, calls, target } = make();
    expect(controller.begin({ button: 2, pointerId: 7 }, target)).toBe(false);
    expect(controller.isActive()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('重复 begin 不会重复上报主进程', () => {
    const { controller, calls, target } = make();
    controller.begin({ button: 0, pointerId: 1 }, target);
    controller.begin({ button: 0, pointerId: 2 }, target);
    expect(calls).toEqual(['begin']);
    controller.dispose();
  });

  it.each([
    ['pointerup', () => 'pointerup' as const],
    ['pointercancel', () => 'pointercancel' as const],
    ['lostpointercapture', () => 'lostpointercapture' as const],
    ['blur', () => 'blur' as const],
    ['escape', () => 'escape' as const],
  ])('结束路径 %s 恰好调用一次 endDrag 并释放捕获', (_name, reason) => {
    const { controller, calls, released, target, active } = make();
    controller.begin({ button: 0, pointerId: 3 }, target);
    controller.end(reason());
    expect(calls).toEqual(['begin', 'end']);
    expect(released).toEqual([3]);
    expect(controller.isActive()).toBe(false);
    expect(active).toEqual([true, false]);
    // 再结束一次不应重复调用。
    controller.end(reason());
    expect(calls).toEqual(['begin', 'end']);
    controller.dispose();
  });

  it('超时自动结束拖拽', () => {
    vi.useFakeTimers();
    try {
      const { controller, calls, target } = make();
      controller.begin({ button: 0, pointerId: 4 }, target);
      vi.advanceTimersByTime(RENDERER_DRAG_TIMEOUT_MS - 1);
      expect(controller.isActive()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(controller.isActive()).toBe(false);
      expect(calls).toEqual(['begin', 'end']);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('卸载 dispose 也会结束拖拽，不留计时器', () => {
    vi.useFakeTimers();
    try {
      const { controller, calls, target } = make();
      controller.begin({ button: 0, pointerId: 5 }, target);
      controller.dispose();
      expect(calls).toEqual(['begin', 'end']);
      vi.advanceTimersByTime(RENDERER_DRAG_TIMEOUT_MS * 2);
      expect(calls).toEqual(['begin', 'end']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('beginDrag 抛错时不进入拖拽态，避免本地与主进程状态分裂', () => {
    const active: boolean[] = [];
    const controller = new PetDragController({
      bridge: {
        beginDrag: () => {
          throw new Error('ipc down');
        },
        endDrag: () => {
          throw new Error('ipc down');
        },
      },
      onActiveChange: (value) => active.push(value),
    });
    expect(controller.begin({ button: 0, pointerId: 11 }, null)).toBe(false);
    expect(controller.isActive()).toBe(false);
    expect(active).toEqual([true, false]);
    expect(() => controller.end('pointerup')).not.toThrow();
  });

  it('beginDrag 抛错时归还已经取得的 pointer capture', () => {
    // 回归：捕获成功、主进程 beginDrag 失败时，若不释放捕获，
    // 元素会继续独占该指针，后续 pointerup 被重定向到它，窗口卡在拖拽态。
    const captured: number[] = [];
    const released: number[] = [];
    const target = {
      setPointerCapture(pointerId: number): void {
        captured.push(pointerId);
      },
      releasePointerCapture(pointerId: number): void {
        released.push(pointerId);
      },
    };
    const calls: string[] = [];
    const controller = new PetDragController({
      bridge: {
        beginDrag: () => {
          calls.push('begin');
          throw new Error('ipc down');
        },
        endDrag: () => calls.push('end'),
      },
    });

    expect(controller.begin({ button: 0, pointerId: 21 }, target)).toBe(false);
    expect(captured).toEqual([21]);
    expect(released).toEqual([21]);
    expect(controller.isActive()).toBe(false);
    // 主进程从未进入拖拽态，因此不能补一次 endDrag。
    expect(calls).toEqual(['begin']);
    expect(controller.endReason()).toBeNull();
  });

  it('捕获本身就失败时，beginDrag 抛错不再重复释放', () => {
    const released: number[] = [];
    const target = {
      setPointerCapture(): void {
        throw new Error('not in document');
      },
      releasePointerCapture(pointerId: number): void {
        released.push(pointerId);
      },
    };
    const controller = new PetDragController({
      bridge: {
        beginDrag: () => {
          throw new Error('ipc down');
        },
        endDrag: () => undefined,
      },
    });
    expect(controller.begin({ button: 0, pointerId: 22 }, target)).toBe(false);
    // 从未捕获成功，就不该假装释放。
    expect(released).toEqual([]);
    expect(controller.isActive()).toBe(false);
  });

  it('beginDrag 抛错后释放失败也不掩盖原始失败，且状态机已复位', () => {
    const target = {
      setPointerCapture(): void {},
      releasePointerCapture(): void {
        throw new Error('already released');
      },
    };
    const active: boolean[] = [];
    const controller = new PetDragController({
      bridge: {
        beginDrag: () => {
          throw new Error('ipc down');
        },
        endDrag: () => undefined,
      },
      onActiveChange: (value) => active.push(value),
    });
    expect(() => controller.begin({ button: 0, pointerId: 23 }, target)).not.toThrow();
    expect(controller.isActive()).toBe(false);
    expect(active).toEqual([true, false]);
    // 复位之后可以重新开始，不会永久卡死。
    const ok = new PetDragController({ bridge: { beginDrag: () => {}, endDrag: () => {} } });
    expect(ok.begin({ button: 0, pointerId: 24 }, null)).toBe(true);
    ok.dispose();
  });

  it('记录结束原因，便于排查拖拽为什么中断', () => {
    const { controller, target } = make();
    controller.begin({ button: 0, pointerId: 12 }, target);
    expect(controller.endReason()).toBeNull();
    controller.end('lostpointercapture');
    expect(controller.endReason()).toBe('lostpointercapture');
  });

  it('捕获/释放抛错不影响状态机', () => {
    const calls: string[] = [];
    const controller = new PetDragController({
      bridge: {
        beginDrag: () => calls.push('begin'),
        endDrag: () => calls.push('end'),
      },
    });
    const throwing = {
      setPointerCapture(): void {
        throw new Error('not in document');
      },
      releasePointerCapture(): void {
        throw new Error('already released');
      },
    };
    expect(() => controller.begin({ button: 0, pointerId: 9 }, throwing)).not.toThrow();
    expect(() => controller.end('pointerup')).not.toThrow();
    expect(calls).toEqual(['begin', 'end']);
  });
});

describe('桥失败不再静默', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const baseSnapshot: PetSnapshot = {
    state: 'idle',
    bounds: { x: 0, y: 0, width: 380, height: 420 },
    displayId: 1,
    displayCount: 1,
    scaleFactor: 1,
    clickThrough: true,
    dragging: false,
  };

  function makeBridge(overrides: Partial<Record<string, unknown>> = {}): PetPrototypeBridge {
    return {
      version: 1,
      getSnapshot: () => Promise.resolve({ ok: true as const, value: baseSnapshot }),
      setInteraction: () => Promise.resolve({ ok: true as const, value: baseSnapshot }),
      beginDrag: () => Promise.resolve({ ok: true as const, value: baseSnapshot }),
      endDrag: () => Promise.resolve({ ok: true as const, value: baseSnapshot }),
      previewState: () => Promise.resolve({ ok: true as const, value: baseSnapshot }),
      quit: () => Promise.resolve({ ok: true as const, value: null }),
      onSnapshot: () => () => {},
      ...overrides,
    } as unknown as PetPrototypeBridge;
  }

  it('callBridge 在 ok:false 时上报失败而不是静默忽略', async () => {
    const errors: string[] = [];
    const values: unknown[] = [];
    await callBridge(
      makeBridge(),
      () => Promise.resolve({ ok: false as const, error: 'untrusted-sender' }),
      (message) => errors.push(message),
      (value) => values.push(value),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(describeBridgeError('untrusted-sender', ''));
    expect(values).toEqual([]);
  });

  it('callBridge 在 Promise 抛错时上报失败', async () => {
    const errors: string[] = [];
    await callBridge(
      makeBridge(),
      () => Promise.reject(new Error('boom')),
      () => errors.push('failed'),
      () => undefined,
    );
    expect(errors).toEqual(['failed']);
  });

  it('callBridge 在桥缺失时安全空操作', async () => {
    const errors: string[] = [];
    await callBridge(
      null,
      () => Promise.resolve({ ok: true as const, value: null }),
      () => errors.push('failed'),
      () => undefined,
    );
    expect(errors).toEqual([]);
  });

  it('三个契约错误码各有面向用户的中文提示', () => {
    for (const code of ['invalid-request', 'untrusted-sender', 'unavailable']) {
      const text = describeBridgeError(code, 'fallback');
      expect(text).not.toBe('fallback');
      expect(text.length).toBeGreaterThan(8);
    }
    expect(describeBridgeError('something-else', 'fallback')).toBe('fallback');
  });

  it('退出失败时给出提示文案', () => {
    expect(PET_COPY.quitFailed).toContain('退出');
    expect(PET_COPY.quitFailed).not.toBe(PET_COPY.bridgeError);
  });
});

describe('窗口桥校验', () => {
  const valid = {
    version: 1,
    getSnapshot: () => Promise.resolve({ ok: true, value: null }),
    setInteraction: () => Promise.resolve({ ok: true, value: null }),
    beginDrag: () => Promise.resolve({ ok: true, value: null }),
    endDrag: () => Promise.resolve({ ok: true, value: null }),
    previewState: () => Promise.resolve({ ok: true, value: null }),
    quit: () => Promise.resolve({ ok: true, value: null }),
    onSnapshot: () => () => {},
  } as unknown as PetPrototypeBridge;

  it('接受符合契约的桥', () => {
    expect(isPetPrototypeBridge(valid)).toBe(true);
  });

  it('拒绝版本不对或缺少方法的对象', () => {
    expect(isPetPrototypeBridge({ ...valid, version: 2 })).toBe(false);
    expect(isPetPrototypeBridge({ ...valid, quit: undefined })).toBe(false);
    expect(isPetPrototypeBridge({ ...valid, onSnapshot: 1 })).toBe(false);
    expect(isPetPrototypeBridge(null)).toBe(false);
    expect(isPetPrototypeBridge('pet')).toBe(false);
  });

  it('没有 window.pet 时返回 null，页面不崩', () => {
    expect(readBridge({})).toBeNull();
    expect(readBridge({ pet: {} })).toBeNull();
    expect(readBridge({ pet: valid })).toBe(valid);
  });
});

describe('角色渲染', () => {
  it('渲染原创 SVG 并带稳定 testid', () => {
    const html = markup(<PetAvatar state="idle" />);
    expect(html).toContain('data-testid="pet-avatar"');
    expect(html).toContain('data-state="idle"');
    expect(html).toContain('role="img"');
    // 不使用远端资源：除 SVG 命名空间外没有 http(s) 引用，也没有 <image> 标签。
    expect(html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')).not.toMatch(/https?:/);
    expect(html).not.toContain('<image');
    expect(html).not.toMatch(/url\(['"]?https?:/);
  });

  it.each(PET_STATE_ORDER)('状态 %s 有独立的外观钩子', (state: PetState) => {
    const html = markup(<PetAvatar state={state} />);
    expect(html).toContain(`pet-avatar--${state}`);
  });
});

describe('气泡与原型面板', () => {
  it('气泡用 status 角色播报状态文案', () => {
    const html = markup(<PetBubble state="thinking" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(PET_COPY.stateBubbles.thinking);
  });

  it('面板提供五个状态按钮与退出按钮', () => {
    const html = markup(
      <PrototypePanel state="idle" onPreview={() => {}} onQuit={() => {}} quitDisabled={false} />,
    );
    expect(html).toContain('data-testid="prototype-panel"');
    for (const state of PET_STATE_ORDER) {
      expect(html).toContain(`data-testid="state-${state}"`);
    }
    expect(html).toContain('data-testid="pet-quit"');
    expect(html).toContain('aria-pressed="true"');
    // 按钮是真实 button，键盘可达。
    expect(html.match(/<button/g)?.length).toBe(PET_STATE_ORDER.length + 1);
  });

  it('退出按钮在桥不可用时禁用，避免空操作', () => {
    const html = markup(
      <PrototypePanel state="idle" onPreview={() => {}} onQuit={() => {}} quitDisabled />,
    );
    expect(html).toMatch(/data-testid="pet-quit"[^>]*disabled/);
  });
});

describe('页面骨架', () => {
  it('无桥时仍渲染舞台、角色与面板，并给出说明', () => {
    const html = markup(<PetApp bridge={null} />);
    expect(html).toContain('data-testid="pet-stage"');
    expect(html).toContain('data-testid="pet-avatar"');
    expect(html).toContain('data-testid="prototype-panel"');
    expect(html).toContain('data-testid="pet-notice"');
    expect(html).toContain(PET_COPY.bridgeMissing);
  });

  it('有桥时初始状态为待机且不显示错误提示', () => {
    const bridge = {
      version: 1,
      getSnapshot: () => Promise.resolve({ ok: false, error: 'unavailable' }),
      setInteraction: () => Promise.resolve({ ok: true, value: null }),
      beginDrag: () => Promise.resolve({ ok: true, value: null }),
      endDrag: () => Promise.resolve({ ok: true, value: null }),
      previewState: () => Promise.resolve({ ok: true, value: null }),
      quit: () => Promise.resolve({ ok: true, value: null }),
      onSnapshot: () => () => {},
    };
    const html = markup(<PetApp bridge={bridge} />);
    expect(html).toContain('data-testid="pet-avatar"');
    expect(html).toContain('data-state="idle"');
    expect(html).not.toContain('data-testid="pet-notice"');
  });

  it('页面不引用远端字体、图片或网络地址', () => {
    const html = markup(<PetApp bridge={null} />);
    // xmlns 是 SVG 命名空间标识符，不会发起网络请求，先排除再检查。
    const withoutNamespace = html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    expect(withoutNamespace).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('@import');
  });
});
