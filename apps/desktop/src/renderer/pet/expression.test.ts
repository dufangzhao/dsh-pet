import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPRESSION_VISIBLE_MS, ExpressionTimeline, type PetExpression } from './expression.js';

/**
 * 两帧才算“画出来了”：测试里手动推帧，不依赖真实浏览器。
 * 取消的帧按 id 移除，和行为里的 cancelAnimationFrame 一致。
 */
function frameQueue() {
  let pending: { id: number; callback: () => void }[] = [];
  let nextId = 1;
  return {
    request(callback: () => void): number {
      const id = nextId;
      nextId += 1;
      pending.push({ id, callback });
      return id;
    },
    cancel(id: number): void {
      pending = pending.filter((entry) => entry.id !== id);
    },
    flush(): void {
      const current = pending;
      pending = [];
      for (const entry of current) entry.callback();
    },
  };
}

let frames = frameQueue();

function make(options: { isVisible?: () => boolean } = {}) {
  const applied: PetExpression[] = [];
  const visible: PetExpression[] = [];
  const timeline = new ExpressionTimeline({
    onApply: (expression) => applied.push(expression),
    onVisible: (expression) => visible.push(expression),
    isVisible: options.isVisible ?? (() => true),
  });
  return { timeline, applied, visible };
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = frameQueue();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.request(callback));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.cancel(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('短时表情：真的画到屏幕上才算数', () => {
  it('先上脸，两帧之后回报一次，到点自己收回', () => {
    const { timeline, applied, visible } = make();
    timeline.blush();
    expect(applied).toEqual(['blush']);
    // 还没上屏：这时回报就是替宿主编一条没发生过的表情。
    expect(visible).toEqual([]);

    frames.flush();
    expect(visible).toEqual([]);

    frames.flush();
    expect(visible).toEqual(['blush']);

    vi.advanceTimersByTime(EXPRESSION_VISIBLE_MS - 1);
    expect(applied).toEqual(['blush']);
    vi.advanceTimersByTime(1);
    expect(applied).toEqual(['blush', 'neutral']);
    timeline.dispose();
  });

  it('隐藏窗口不伪造回报，表情本身照常给出', () => {
    const { timeline, applied, visible } = make({ isVisible: () => false });
    timeline.blush();
    frames.flush();
    frames.flush();
    expect(applied).toEqual(['blush']);
    expect(visible).toEqual([]);
    timeline.dispose();
  });

  it('后一次戳作废旧帧与旧计时：只回报一次，也只收回一次', () => {
    const { timeline, applied, visible } = make();
    timeline.blush();
    frames.flush();
    timeline.blush();
    frames.flush();
    frames.flush();
    expect(visible).toEqual(['blush']);

    vi.advanceTimersByTime(EXPRESSION_VISIBLE_MS);
    expect(applied).toEqual(['blush', 'blush', 'neutral']);
    timeline.dispose();
  });

  it('dispose 之后既不再回报，也不再改表情', () => {
    const { timeline, applied, visible } = make();
    timeline.blush();
    frames.flush();
    timeline.dispose();
    frames.flush();
    vi.advanceTimersByTime(EXPRESSION_VISIBLE_MS * 3);
    expect(visible).toEqual([]);
    expect(applied).toEqual(['blush']);
  });
});
