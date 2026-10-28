/**
 * 短时表情：戳一下之后脸红，过一会儿自己收回。
 *
 * 两条硬约束：
 * - 表情只有真的画到屏幕上才算数。调用方在这里只拿到一个“可以记一条回执”的回调，
 *   而它要等两帧之后才触发：第一帧提交了这次更新，第二帧说明它已经上屏；
 *   窗口被隐藏时画面没给人看过，一律不回报。
 * - 每次戳都带自己的序号。后一次戳会作废旧计时与旧帧回调，
 *   晚到的旧结果既不能把表情收回，也不能替新的一次记事件。
 *
 * 这里不写历史：表情回执仍然走宿主既有的 interact({kind:'blush'})，一条不多、一条不少。
 */
export type PetExpression = 'neutral' | 'blush';

/** 红晕停留时长：够看清是一次回应，又不至于一直挂着像固定妆。 */
export const EXPRESSION_VISIBLE_MS = 1200;

export interface ExpressionTimelineOptions {
  /** 把表情交给 React；真正的提交与绘制由浏览器决定。 */
  onApply(expression: PetExpression): void;
  /** 表情确实出现在一帧可见画面之后，调用一次。 */
  onVisible(expression: PetExpression): void;
  /** 窗口此刻是否真的在显示（document.visibilityState === 'visible'）。 */
  isVisible(): boolean;
  durationMs?: number;
}

export class ExpressionTimeline {
  private readonly onApply: (expression: PetExpression) => void;
  private readonly onVisible: (expression: PetExpression) => void;
  private readonly isVisible: () => boolean;
  private readonly durationMs: number;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private disposed = false;

  constructor(options: ExpressionTimelineOptions) {
    this.onApply = options.onApply;
    this.onVisible = options.onVisible;
    this.isVisible = options.isVisible;
    this.durationMs = options.durationMs ?? EXPRESSION_VISIBLE_MS;
  }

  /** 戳一下：先红脸，再在可见帧之后回报一次，最后自己收回。 */
  blush(): void {
    if (this.disposed) return;
    const mine = (this.seq += 1);
    this.onApply('blush');
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      // 只有还是这一次才收回：新的戳已经把旧的计时作废。
      if (this.seq === mine) this.onApply('neutral');
    }, this.durationMs);
    this.cancelFrame();
    // 两帧：第一帧把这次更新交上去，第二帧说明它已经画出来了。
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (this.disposed || this.seq !== mine) return;
        // 隐藏窗口里没有“看见”，就不能替宿主记一条已经发生过的表情。
        if (!this.isVisible()) return;
        this.onVisible('blush');
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.seq += 1;
    this.cancelFrame();
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
