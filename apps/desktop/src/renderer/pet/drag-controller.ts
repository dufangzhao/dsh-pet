/**
 * 渲染器侧的拖拽状态机（纯逻辑，不依赖 DOM，便于单元测试）。
 *
 * 职责：保证“按下开始 → 无论以何种方式结束，都恰好调用一次 endDrag”。
 * 结束路径有六条，缺一条就会让窗口卡在拖拽态（主进程认为还在拖，渲染器已松手）：
 *   pointerup / pointercancel / lostpointercapture / blur / Escape / 超时。
 *
 * 坐标完全不经过这里：窗口位置由主进程读 screen.getCursorScreenPoint() 计算，
 * 渲染器只上报“开始拖”和“结束拖”。
 */
export interface DragBridge {
  beginDrag(): void;
  endDrag(): void;
}

/** 指针捕获目标；真实环境传 HTMLDivElement，测试传假对象。 */
export interface PointerCaptureTarget {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
}

export type DragEndReason =
  'pointerup' | 'pointercancel' | 'lostpointercapture' | 'blur' | 'escape' | 'timeout' | 'dispose';

/** 与主进程看门狗一致，避免指针事件丢失后两边状态不一致。 */
export const RENDERER_DRAG_TIMEOUT_MS = 30_000;

export interface PetDragControllerOptions {
  bridge: DragBridge;
  timeoutMs?: number;
  /** 拖拽开始/结束时通知 React 更新视觉状态（例如 cursor）。 */
  onActiveChange?: (active: boolean) => void;
  /** 状态变化回调抛错不应打断状态机。 */
}

export class PetDragController {
  private readonly bridge: DragBridge;
  private readonly timeoutMs: number;
  private readonly onActiveChange: ((active: boolean) => void) | undefined;
  private active = false;
  private pointerId: number | null = null;
  private captureTarget: PointerCaptureTarget | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEndReason: DragEndReason | null = null;

  constructor(options: PetDragControllerOptions) {
    this.bridge = options.bridge;
    this.timeoutMs = options.timeoutMs ?? RENDERER_DRAG_TIMEOUT_MS;
    this.onActiveChange = options.onActiveChange;
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * 尝试开始拖拽。只接受主键（button === 0）；已经在拖拽中时返回 false，
   * 避免重复 beginDrag 让主进程多开一个计时器。
   */
  begin(
    event: { button: number; pointerId: number },
    target: PointerCaptureTarget | null,
  ): boolean {
    if (this.active) return false;
    if (event.button !== 0) return false;

    this.active = true;
    this.pointerId = event.pointerId;
    this.captureTarget = target;
    this.notify(true);

    // 指针捕获：指针移出窗口（甚至拖到屏幕外）时仍能收到 pointerup，
    // 否则 window 的 pointerup 可能收不到，窗口会卡在拖拽态。
    if (target !== null) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // 某些环境下元素尚未插入文档，捕获会抛错；不影响拖拽本身。
      }
    }

    try {
      this.bridge.beginDrag();
    } catch {
      // 主进程调用失败时不能留下“本地在拖拽、主进程不知道”的分裂状态。
      this.active = false;
      this.pointerId = null;
      this.captureTarget = null;
      this.notify(false);
      return false;
    }
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.end('timeout');
    }, this.timeoutMs);
    return true;
  }

  /** 结束拖拽；未在拖拽中时是安全空操作，保证 endDrag 恰好调用一次。 */
  end(reason: DragEndReason = 'pointerup'): void {
    if (!this.active) return;
    this.active = false;
    this.clearTimer();
    const pointerId = this.pointerId;
    const target = this.captureTarget;
    this.pointerId = null;
    this.captureTarget = null;

    if (target !== null && pointerId !== null) {
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // 捕获已经因为 lostpointercapture 被系统释放，重复释放会抛错。
      }
    }

    this.lastEndReason = reason;
    this.notify(false);
    try {
      this.bridge.endDrag();
    } catch {
      // 结束调用失败也要保持本地已结束，避免卡在拖拽态。
    }
  }

  /** 最近一次结束原因，便于排查“为什么拖拽断了”。 */
  endReason(): DragEndReason | null {
    return this.lastEndReason;
  }

  /** 窗口失焦、Esc、卸载都走这里，语义上都是“无条件收尾”。 */
  cancel(reason: DragEndReason): void {
    this.end(reason);
  }

  dispose(): void {
    this.end('dispose');
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private notify(active: boolean): void {
    if (this.onActiveChange === undefined) return;
    try {
      this.onActiveChange(active);
    } catch {
      // 订阅方的渲染错误不应让状态机停在中间态。
    }
  }
}
