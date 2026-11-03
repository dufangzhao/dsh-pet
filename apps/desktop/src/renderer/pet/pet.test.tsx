import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PET_STATES,
  type ApplicationDialog,
  type PetPrototypeBridge,
  type PetSnapshot,
} from '@pet/contracts';

import { HoverTracker, PetApp, createPetInteractionSession, reconcileHover } from './App.js';
import { PetAvatar } from './PetAvatar.js';
import { PetBubble } from './PetBubble.js';
import { PetComposer } from './PetComposer.js';
import { PetDialog, dialogFocusTarget, planDialogSubmit } from './PetDialog.js';
import { PetMenu } from './PetMenu.js';
import { PET_COPY, stateBubble } from './copy.js';
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

/** 按 data-testid 取出真实渲染出来的标签，用于断言 disabled 之类逐元素属性。 */
function tag(html: string, testId: string): string {
  const match = new RegExp('<[a-z]+[^>]*data-testid="' + testId + '"[^>]*>').exec(html);
  expect(match, '找不到 data-testid=' + testId + ' 的元素').not.toBeNull();
  return match?.[0] ?? '';
}

describe('文案与状态标识', () => {
  it('五种状态都有面向用户的中文气泡文案', () => {
    expect(PET_STATES).toEqual(['idle', 'listening', 'thinking', 'replying', 'error']);
    for (const state of PET_STATES) {
      expect(stateBubble(state)).not.toBe('');
    }
  });

  it('产品文案里没有开发期的模拟或预览说明', () => {
    // 桌宠窗口只讲真实发生的事：脚本演示仍要标注，M0 模拟与面板预览已从产品移除。
    const copy = JSON.stringify(PET_COPY);
    expect(copy).not.toContain('M0');
    expect(copy).not.toMatch(/模拟/);
    expect(PET_COPY.replyTag).toBe('脚本演示｜');
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

describe('圆角气泡命中跟随实际绘制面', () => {
  const surface = {
    kind: 'roundedRect' as const,
    left: 10,
    top: 20,
    right: 256,
    bottom: 80,
    radius: 18,
  };
  it('正文与边线命中，四个透明角保持穿透', () => {
    expect(isPointInHitShapes({ x: 100, y: 45 }, [surface], 0)).toBe(true);
    expect(isPointInHitShapes({ x: 28, y: 20 }, [surface], 0)).toBe(true);
    for (const point of [
      { x: 11, y: 21 },
      { x: 255, y: 21 },
      { x: 11, y: 79 },
      { x: 255, y: 79 },
    ])
      expect(isPointInHitShapes(point, [surface])).toBe(false);
  });
  it('滚出内容视口的部分不会继续挡住透明窗口', () => {
    const clipped = { ...surface, clip: { left: 20, top: 30, right: 240, bottom: 70 } };
    expect(isPointInHitShapes({ x: 100, y: 25 }, [surface], 0)).toBe(true);
    expect(isPointInHitShapes({ x: 100, y: 25 }, [clipped], 0)).toBe(false);
    expect(isPointInHitShapes({ x: 100, y: 45 }, [clipped], 0)).toBe(true);
  });
  it('缩回后的边界不再覆盖原来的可点位置', () => {
    const point = { x: 245, y: 45 };
    expect(isPointInHitShapes(point, [surface], 0)).toBe(true);
    expect(isPointInHitShapes(point, [{ ...surface, right: 226, radius: 15 }], 0)).toBe(false);
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
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    // 不使用远端资源：除 SVG 命名空间外没有 http(s) 引用，也没有 <image> 标签。
    expect(html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')).not.toMatch(/https?:/);
    expect(html).not.toContain('<image');
    expect(html).not.toMatch(/url\(['"]?https?:/);
  });

  it.each(PET_STATES)('状态 %s 有独立的外观钩子', (state) => {
    const html = markup(<PetAvatar state={state} />);
    expect(html).toContain(`pet-avatar--${state}`);
  });

  it('平时不画腮红，只有短时表情才画出来', () => {
    const neutral = markup(<PetAvatar state="idle" />);
    expect(neutral).toContain('data-expression="neutral"');
    // 红晕是一次回应，不是角色一直带着的妆：没戳过就不该有这两个椭圆。
    expect(neutral).not.toContain('pet-avatar__blush');

    const blush = markup(<PetAvatar state="idle" expression="blush" />);
    expect(blush).toContain('data-expression="blush"');
    expect(blush.match(/pet-avatar__blush/g)?.length).toBe(2);
  });
});

describe('气泡、提示与菜单', () => {
  it('气泡用 status 角色播报状态文案', () => {
    const html = markup(<PetBubble state="thinking" text={PET_COPY.stateBubbles.thinking} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(PET_COPY.stateBubbles.thinking);
  });

  it('气泡优先显示宿主给的真实文本', () => {
    const html = markup(<PetBubble state="listening" text="今天阴天，适合写代码。" />);
    expect(html).toContain('今天阴天，适合写代码。');
    expect(html).toContain('role="status"');
    expect(markup(<PetBubble state="listening" text={null} />)).toBe('');
  });

  it('菜单只有真实入口：设置、引导、停止（宿主说能停才出现）与退出', () => {
    const html = markup(
      <PetMenu
        name="小蓝"
        canStop
        stopping={false}
        onStop={() => {}}
        guideDisabled={false}
        guideBusy={false}
        onGuide={() => {}}
        quitDisabled={false}
        onQuit={() => {}}
      />,
    );
    expect(html).toContain('data-testid="pet-menu"');
    expect(html).toContain('data-testid="pet-name"');
    expect(html).toContain('小蓝');
    for (const id of ['pet-settings', 'pet-guide', 'pet-stop', 'pet-quit']) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    // 开发期的状态预览按钮不属于产品界面。
    expect(html).not.toContain('data-testid="state-idle"');
    expect(html.match(/<button/g)?.length).toBe(4);
  });

  it('宿主说不能停时不画停止按钮，没读到名字就留空，不可用的入口禁用', () => {
    const html = markup(
      <PetMenu
        name={null}
        canStop={false}
        stopping={false}
        onStop={() => {}}
        guideDisabled
        guideBusy={false}
        onGuide={() => {}}
        quitDisabled
        onQuit={() => {}}
      />,
    );
    expect(html).not.toContain('data-testid="pet-stop"');
    expect(html).not.toContain('data-testid="pet-name"');
    expect(tag(html, 'pet-guide')).toContain('disabled');
    expect(tag(html, 'pet-quit')).toContain('disabled');
  });

  it('提示渲染宿主给的标题、正文与选项，主选项有唯一标记', () => {
    const dialog: ApplicationDialog = {
      id: 'guide-1',
      step: 'name',
      title: '怎么称呼你',
      text: '这个名字会出现在气泡里。',
      choices: [
        { id: 'keep', label: '就叫小蓝', primary: true },
        { id: 'later', label: '稍后再说' },
      ],
      busy: false,
    };
    const html = markup(
      <PetDialog dialog={dialog} state="idle" pending={false} onAnswer={() => {}} />,
    );
    expect(html).toContain('data-testid="pet-dialog"');
    expect(html).toContain('怎么称呼你');
    expect(html).toContain('这个名字会出现在气泡里。');
    expect(tag(html, 'pet-dialog-choice-keep')).toContain('data-primary="true"');
    expect(tag(html, 'pet-dialog-choice-later')).toContain('data-primary="false"');
    // 没有输入框就没有掩码字段，界面上不多出一个假入口。
    expect(html).not.toContain('pet-dialog-input');
  });

  it('掩码输入只跟着能承载文本的选项，其余选项不带值', () => {
    const dialog: ApplicationDialog = {
      id: 'guide-2',
      step: 'key',
      title: '填写密钥',
      text: '只交给宿主保存。',
      choices: [
        { id: 'save', label: '保存', primary: true },
        { id: 'cancel', label: '取消' },
      ],
      input: { kind: 'secret', label: '密钥' },
      busy: true,
    };
    const plan = planDialogSubmit(dialog);
    expect(plan.carrier?.id).toBe('save');
    expect(plan.plain.map((choice) => choice.id)).toEqual(['cancel']);
    expect(plan.inputUsable).toBe(true);
    const html = markup(
      <PetDialog dialog={dialog} state="idle" pending={false} onAnswer={() => {}} />,
    );
    expect(html).toContain('type="password"');
    expect(html).toContain(PET_COPY.dialog.secretHint);
    // 宿主说这一步还在处理：控件全部禁用，界面不假装已经提交。
    expect(tag(html, 'pet-dialog-choice-save')).toContain('disabled');
    expect(html).toContain('data-testid="pet-dialog-busy"');
    // 有输入框时焦点先落在输入上，不用 Tab 穿过选项。
    expect(dialogFocusTarget(dialog)).toBe('input');
  });

  it('没有可承载文本的选项时不假装能输入', () => {
    const dialog: ApplicationDialog = {
      id: 'guide-3',
      step: 'ask',
      title: '补充一句',
      text: '这一步没有选项。',
      choices: [],
      input: { kind: 'text', label: '说明' },
      busy: false,
    };
    expect(planDialogSubmit(dialog).inputUsable).toBe(false);
    const html = markup(
      <PetDialog dialog={dialog} state="idle" pending={false} onAnswer={() => {}} />,
    );
    expect(html).toContain('data-testid="pet-dialog-unusable"');
    expect(PET_COPY.dialog.noChoice).toContain('设置');
    expect(tag(html, 'pet-dialog-input-text')).toContain('disabled');
  });

  it('空白不给发送，宿主未就绪时仍能保留和编辑草稿', () => {
    const ready = markup(<PetComposer canSend sending={false} onSend={async () => true} />);
    expect(tag(ready, 'pet-composer-input')).not.toContain('disabled');
    // 空输入只禁用发送按钮，输入框照样能打字。
    expect(tag(ready, 'pet-composer-send')).toContain('disabled');
    expect(ready).toContain(PET_COPY.sendPlaceholder);

    const blocked = markup(
      <PetComposer canSend={false} sending={false} onSend={async () => true} />,
    );
    expect(tag(blocked, 'pet-composer-input')).not.toContain('disabled');
    expect(tag(blocked, 'pet-composer-input')).toContain('rows="1"');
    expect(tag(blocked, 'pet-composer-input')).toContain('<textarea');
    expect(tag(blocked, 'pet-composer-send')).toContain('disabled');
  });
});

/**
 * 回归（主会话待证假设的渲染器侧）：主进程 stopDrag 之后的“120ms 自动释放”
 * 会让渲染器的 interactiveRef 停留在 true，移动去重从此永远跳过上报，
 * 光标停在角色上再按下时事件根本到不了渲染器——表现为“永久点不动”。
 *
 * 修复后的不变式：
 * 1. 命中状态变化才上报（去重仍然保留）；
 * 2. 拖拽中只记录位置、不切换穿透；
 * 3. 松手后按最后一次位置重算并重述意图；
 * 4. 权威快照与本地缓存分叉时能自愈，不需要等一次 pointerleave。
 */
describe('hover 意图缓存与权威快照对账', () => {
  const rect = { left: 20, top: 10, width: 152, height: 152 };
  const shapes = avatarHitShapes(rect);
  const center = { x: rect.left + 76, y: rect.top + 76 };
  const corner = { x: rect.left + 2, y: rect.top + 2 };

  it('同一位置的重复移动只上报一次（pointermove 与 mousemove 会重复到达）', () => {
    const tracker = new HoverTracker();
    expect(tracker.move(center, shapes)).toBe(true);
    expect(tracker.interactive).toBe(true);
    expect(tracker.move(center, shapes)).toBe(false);
    expect(tracker.move({ ...center }, shapes)).toBe(false);
    // 透明角必须回到穿透。
    expect(tracker.move(corner, shapes)).toBe(true);
    expect(tracker.interactive).toBe(false);
  });

  it('拖拽中只记录位置不改变状态，松手后按最后位置重算', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);

    // 拖拽期间 App 只调用 track()：状态不变，主进程保持非穿透。
    tracker.track({ x: center.x + 30, y: center.y + 20 });
    expect(tracker.interactive).toBe(true);

    // 松手：重算后仍然命中角色，且不需要“变化”也能重述意图。
    expect(tracker.resync(shapes)).toBe(false);
    expect(tracker.interactive).toBe(true);
    expect(tracker.lastPoint).toEqual({ x: center.x + 30, y: center.y + 20 });
  });

  it('松手时指针已经移出角色，重算后必须转为穿透', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    tracker.track(corner);
    expect(tracker.resync(shapes)).toBe(true);
    expect(tracker.interactive).toBe(false);
  });

  it('pointerleave 丢弃位置，松手不会用过期坐标复活交互', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    expect(tracker.leave()).toBe(true);
    expect(tracker.interactive).toBe(false);
    expect(tracker.lastPoint).toBeNull();
    // 没有位置信息时重算一律按穿透处理，不会凭空申请交互。
    expect(tracker.resync(shapes)).toBe(false);
    expect(tracker.interactive).toBe(false);
  });

  it('主进程单方面释放后，forget + 同点移动能重新上报（不再永久点不动）', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    // 主进程失焦/隐藏后释放了交互，权威快照 clickThrough=true。
    expect(reconcileHover({ clickThrough: true, dragging: false }, tracker.interactive)).toBe(
      'forget',
    );
    tracker.forget();
    // 关键：同一个点再移动一次必须重新上报 true，否则用户必须先把指针移出去再移回来。
    expect(tracker.move(center, shapes)).toBe(true);
    expect(tracker.interactive).toBe(true);
  });

  it('reconcileHover 只在对账确有分叉时动手，拖拽中与无快照一律不干预', () => {
    expect(reconcileHover(null, true)).toBe('none');
    expect(reconcileHover({ clickThrough: false, dragging: true }, false)).toBe('none');
    expect(reconcileHover({ clickThrough: true, dragging: false }, false)).toBe('none');
    expect(reconcileHover({ clickThrough: false, dragging: false }, true)).toBe('none');
    // 主进程已穿透、本地仍以为可交互：只清缓存，不重复发请求。
    expect(reconcileHover({ clickThrough: true, dragging: false }, true)).toBe('forget');
    // 主进程仍挡着、指针已经离开：主动释放，避免永久挡住下层应用。
    expect(reconcileHover({ clickThrough: false, dragging: false }, false)).toBe('release');
  });

  it('拖拽控制器先通知 inactive 再调用 endDrag，保证重述意图先于主进程决策', () => {
    const order: string[] = [];
    const controller = new PetDragController({
      bridge: {
        beginDrag: () => order.push('beginDrag'),
        endDrag: () => order.push('endDrag'),
      },
      onActiveChange: (active) => order.push(active ? 'active' : 'inactive'),
    });
    controller.begin({ button: 0, pointerId: 31 }, null);
    controller.end('pointerup');
    // App 的 onActiveChange 在这里 resync + setInteraction(true)，必须早于 endDrag，
    // 否则主进程 stopDrag 读到的还是旧意图，光标停在角色上也会被判定为离开。
    expect(order).toEqual(['active', 'beginDrag', 'inactive', 'endDrag']);
    controller.dispose();
  });
});

/**
 * 回归（主会话指出的两个边界，均已复现）：
 *
 * 边界1 —— 缓存被当成事实。
 * `forget()` 只把“上次上报值”清成 false，而 `lastPoint` 仍停在角色内。
 * 若随后收到一条 clickThrough=false 的快照（正是主进程对本地
 * setInteraction(true) 的回执），拿缓存 false 对账就会判定“指针已经离开”，
 * 反手发出 release，把仍位于命中区的窗口重新放回穿透。
 *
 * 边界2 —— StrictMode 复用已 dispose 的控制器。
 * `useMemo` 里的控制器在 cleanup 里被 dispose，第二次 setup 拿到的还是同一个
 * 已失效实例；`unmounting` 也被第一次 cleanup 永久置 true。
 */
describe('边界1：缓存值不得冒充真实指针位置', () => {
  const rect = { left: 20, top: 10, width: 152, height: 152 };
  const shapes = avatarHitShapes(rect);
  const center = { x: rect.left + 76, y: rect.top + 76 };
  const corner = { x: rect.left + 2, y: rect.top + 2 };

  it('确定性序列：旧 clickThrough=true 触发 forget 后，clickThrough=false 回执不得 release', () => {
    const tracker = new HoverTracker();
    const applied: string[] = [];
    /** 复刻 App 里那个对账 effect：只在 release 时下发 setInteraction(false)。 */
    const reconcile = (snapshot: { clickThrough: boolean; dragging: boolean }): void => {
      const action = reconcileHover(snapshot, tracker.interactive, tracker.hit);
      applied.push(action);
      if (action === 'forget') tracker.forget();
      if (action === 'release') {
        tracker.forget();
        applied.push('setInteraction(false)');
      }
    };

    // 1) 指针停在角色上，上报 true，主进程开始挡着。
    expect(tracker.move(center, shapes)).toBe(true);
    expect(tracker.interactive).toBe(true);
    expect(tracker.hit).toBe(true);

    // 2) 主进程因失焦/隐藏单方面释放，先广播一条较旧的 clickThrough=true 快照。
    reconcile({ clickThrough: true, dragging: false });
    expect(applied).toEqual(['forget']);
    expect(tracker.interactive).toBe(false);

    // 3) 指针一步都没动：真实位置仍在角色内，只是去重缓存被清了。
    expect(tracker.lastPoint).toEqual(center);
    expect(tracker.hit).toBeNull();

    // 4) 紧接着收到主进程对本地 setInteraction(true) 的回执（clickThrough=false）。
    //    这一步以前会返回 'release'，把窗口放回穿透。
    reconcile({ clickThrough: false, dragging: false });
    expect(applied).toEqual(['forget', 'none']);
    expect(applied).not.toContain('release');
    expect(applied).not.toContain('setInteraction(false)');
  });

  it('反证：只拿缓存 false 对账，同一序列确实会误判 release', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    tracker.forget();
    expect(tracker.interactive).toBe(false);
    // 旧签名（第三个参数缺省时退化为缓存值）与显式传缓存，都会得出 release。
    expect(reconcileHover({ clickThrough: false, dragging: false }, false)).toBe('release');
    expect(reconcileHover({ clickThrough: false, dragging: false }, false, false)).toBe('release');
    // 而带上真实命中结果后不再释放：这就是修复点。
    expect(reconcileHover({ clickThrough: false, dragging: false }, false, true)).toBe('none');
  });

  it('forget 后真实命中未知，而不是被断言为“在外”', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    tracker.forget();
    expect(tracker.hit).toBeNull();
    // 未知不得驱动 release（否则就是凭“没有证据”改变窗口行为）。
    expect(reconcileHover({ clickThrough: false, dragging: false }, false, tracker.hit)).toBe(
      'none',
    );
    // 但位置仍在，重算即可恢复真实意图，无需等一次 pointerleave。
    expect(tracker.resync(shapes)).toBe(true);
    expect(tracker.interactive).toBe(true);
    expect(tracker.hit).toBe(true);
  });

  it('修复不能永久挡住底层：指针真实移出命中区后仍必须释放', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    tracker.forget();
    // 真实移动到透明角：命中结果明确为 false。
    // 缓存本来就已是 false（刚 forget），因此这次移动不需要再上报。
    expect(tracker.move(corner, shapes)).toBe(false);
    expect(tracker.interactive).toBe(false);
    expect(tracker.hit).toBe(false);
    // 此时主进程仍挡着 -> 必须主动释放，不能因为“修缓存问题”就一直挡着。
    expect(
      reconcileHover({ clickThrough: false, dragging: false }, tracker.interactive, tracker.hit),
    ).toBe('release');
  });

  it('pointerleave 仍然是“确实离开”：清位置且命中为 false', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    expect(tracker.leave()).toBe(true);
    expect(tracker.lastPoint).toBeNull();
    expect(tracker.hit).toBe(false);
    expect(tracker.interactive).toBe(false);
    // 位置未知时重算只清缓存，不凭空申请交互。
    expect(tracker.resync(shapes)).toBe(false);
    expect(tracker.interactive).toBe(false);
  });

  it('拖拽中不参与对账，松手后按真实位置重述', () => {
    const tracker = new HoverTracker();
    tracker.move(center, shapes);
    tracker.forget();
    // 拖拽中主进程的快照一律不干预。
    expect(reconcileHover({ clickThrough: true, dragging: true }, false, null)).toBe('none');
    // 松手时位置仍在角色上：重述 true，主进程据此保持非穿透。
    expect(tracker.resync(shapes)).toBe(true);
    expect(tracker.interactive).toBe(true);
  });
});

describe('边界2：StrictMode 下会话可重复初始化', () => {
  function makeHarness(overrides: Partial<Parameters<typeof createPetInteractionSession>[0]> = {}) {
    const calls: string[] = [];
    const interactions: boolean[] = [];
    const dragging: boolean[] = [];
    let unmounting = false;
    const session = createPetInteractionSession({
      beginDrag: () => calls.push('beginDrag'),
      endDrag: () => calls.push('endDrag'),
      collectHitShapes: () => [],
      setInteraction: (value) => interactions.push(value),
      onDraggingChange: (value) => dragging.push(value),
      isUnmounting: () => unmounting,
      ...overrides,
    });
    return {
      session,
      calls,
      interactions,
      dragging,
      markUnmounting: () => {
        unmounting = true;
      },
    };
  }

  const target = {
    setPointerCapture(): void {},
    releasePointerCapture(): void {},
  };

  it('dispose 之后契约保持不变：不可再拖拽，也不再产生副作用', () => {
    const { session, calls, dragging } = makeHarness();
    session.dispose();
    expect(session.isActive()).toBe(false);
    // 未开始过拖拽，dispose 不应凭空调用 endDrag。
    expect(calls).toEqual([]);
    expect(dragging).toEqual([]);
    // dispose 后不可再用：begin 必须拒绝，不能半开一次拖拽。
    expect(session.begin({ button: 0, pointerId: 1 }, target)).toBe(false);
    expect(session.isActive()).toBe(false);
    // 重复 dispose / end / cancel 都是安全空操作。
    expect(() => session.dispose()).not.toThrow();
    expect(() => session.end('pointerup')).not.toThrow();
    expect(() => session.cancel('escape')).not.toThrow();
    expect(calls).toEqual([]);
    expect(dragging).toEqual([]);
  });

  it('拖拽中 dispose 恰好结束一次，之后不可再用', () => {
    const { session, calls, dragging } = makeHarness();
    expect(session.begin({ button: 0, pointerId: 7 }, target)).toBe(true);
    session.dispose();
    expect(calls).toEqual(['beginDrag', 'endDrag']);
    expect(dragging).toEqual([true, false]);
    expect(session.isActive()).toBe(false);
    expect(session.begin({ button: 0, pointerId: 8 }, target)).toBe(false);
    expect(calls).toEqual(['beginDrag', 'endDrag']);
  });

  it('setup→cleanup→setup：第二次 setup 后拖拽与松手重述都仍然有效', () => {
    const shapes = avatarHitShapes({ left: 0, top: 0, width: 152, height: 152 });
    const calls: string[] = [];
    const interactions: boolean[] = [];
    const dragging: boolean[] = [];
    // 与 App 的 cleanup 顺序一致：先置卸载标记，再 dispose，第二次 setup 复位。
    let unmounting = false;
    const options = {
      beginDrag: () => calls.push('beginDrag'),
      endDrag: () => calls.push('endDrag'),
      collectHitShapes: () => shapes,
      setInteraction: (value: boolean) => interactions.push(value),
      onDraggingChange: (value: boolean) => dragging.push(value),
      isUnmounting: () => unmounting,
    };

    // ── 第一次 setup ──
    unmounting = false;
    const first = createPetInteractionSession(options);
    first.tracker.track({ x: 76, y: 76 });
    expect(first.begin({ button: 0, pointerId: 1 }, target)).toBe(true);

    // ── StrictMode 的 cleanup ──
    unmounting = true;
    first.dispose();
    // dispose 期间不得再向主进程申请交互。
    expect(interactions).toEqual([]);

    // ── 第二次 setup ──
    unmounting = false;
    const second = createPetInteractionSession(options);
    expect(second).not.toBe(first);
    second.tracker.track({ x: 76, y: 76 });
    expect(second.begin({ button: 0, pointerId: 2 }, target)).toBe(true);
    expect(second.isActive()).toBe(true);
    second.end('pointerup');

    // 关键：第二次拖拽结束后仍会按真实位置重述 hover 意图。
    // 旧实现里 unmounting 被第一次 cleanup 永久置 true，这一步被整个跳过，
    // 主进程只能按过期意图决定穿透——光标停在角色上却再也点不动。
    expect(interactions).toEqual([true]);
    // 卸载期间的 dispose 不再 setState（所以第一次的 false 被有意跳过），
    // 第二次会话的 active/inactive 照常上报。
    expect(dragging).toEqual([true, true, false]);
    // cleanup 必须结束第一份仍活跃的拖拽；第二份会话随后独立 begin/end。
    // 卸载禁止重新申请交互和 setState，不等于可以省掉主程资源释放。
    expect(calls).toEqual(['beginDrag', 'endDrag', 'beginDrag', 'endDrag']);
  });

  it('复用同一个已 dispose 的会话会永久拖不动（被新工厂取代的旧行为）', () => {
    const { session, calls } = makeHarness();
    session.dispose();
    // 旧实现就是在这里失败：StrictMode 第二次 setup 拿到的还是这个实例。
    expect(session.begin({ button: 0, pointerId: 3 }, target)).toBe(false);
    expect(session.isActive()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('cleanup 期间（已标记卸载）dispose 不得再申请交互或 setState', () => {
    const { session, interactions, dragging, markUnmounting } = makeHarness();
    expect(session.begin({ button: 0, pointerId: 4 }, target)).toBe(true);
    // 卸载：先置标记再 dispose（与 App 的 cleanup 顺序一致）。
    markUnmounting();
    session.dispose();
    // dispose 会同步回调 active=false，但那一步不能再 setInteraction / setState。
    expect(interactions).toEqual([]);
    expect(dragging).toEqual([true]);
  });

  it('卸载标记在重新 setup 时复位，回调恢复工作', () => {
    let unmounting = true;
    const dragging: boolean[] = [];
    const session = createPetInteractionSession({
      beginDrag: () => undefined,
      endDrag: () => undefined,
      collectHitShapes: () => [],
      setInteraction: () => undefined,
      onDraggingChange: (value) => dragging.push(value),
      isUnmounting: () => unmounting,
    });
    // 模拟第二次 setup 把标记复位。
    unmounting = false;
    expect(session.begin({ button: 0, pointerId: 5 }, target)).toBe(true);
    expect(dragging).toEqual([true]);
    session.dispose();
    expect(dragging).toEqual([true, false]);
  });

  it('松手时按真实位置重述意图，且重述早于 endDrag', () => {
    const order: string[] = [];
    const shapes = avatarHitShapes({ left: 0, top: 0, width: 152, height: 152 });
    const session = createPetInteractionSession({
      beginDrag: () => order.push('beginDrag'),
      endDrag: () => order.push('endDrag'),
      collectHitShapes: () => shapes,
      setInteraction: (value) => order.push(value ? 'interaction(true)' : 'interaction(false)'),
      onDraggingChange: (value) => order.push(value ? 'active' : 'inactive'),
      isUnmounting: () => false,
    });
    session.tracker.track({ x: 76, y: 76 });
    expect(session.begin({ button: 0, pointerId: 6 }, target)).toBe(true);
    session.end('pointerup');
    expect(order).toEqual(['active', 'beginDrag', 'interaction(true)', 'inactive', 'endDrag']);
  });
});

describe('页面骨架', () => {
  it('无桥时渲染角色与实际错误，菜单和输入框保持关闭', () => {
    const html = markup(<PetApp bridge={null} />);
    expect(html).toContain('data-testid="pet-stage"');
    expect(html).toContain('data-testid="pet-avatar"');
    expect(html).not.toContain('data-testid="pet-menu"');
    expect(html).not.toContain('data-testid="pet-composer"');
    expect(html).toContain('data-testid="pet-bubble"');
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
