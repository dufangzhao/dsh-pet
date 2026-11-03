import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BubbleTextReveal } from './bubble-reveal.js';

describe('收到文本的逐字呈现时钟', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function clock() {
    const values: string[] = [];
    const reveal = new BubbleTextReveal((text) => values.push(text));
    return { values, reveal, last: () => values.at(-1) };
  }

  it('频繁分块不会推迟下一字，也不会倒退重播已有前缀', () => {
    const { reveal, last } = clock();
    reveal.update('你好', true, 100);
    vi.advanceTimersByTime(0);
    expect(last()).toBe('你');
    vi.advanceTimersByTime(25);
    reveal.update('你好世界', true, 100);
    expect(last()).toBe('你');
    vi.advanceTimersByTime(25);
    expect(last()).toBe('你好');
    vi.advanceTimersByTime(100);
    expect(last()).toBe('你好世界');
  });

  it('标点停顿和完整字素都保留，追加不打断正在进行的停顿', () => {
    const { reveal, last } = clock();
    reveal.update('你，', true, 100);
    vi.advanceTimersByTime(50);
    expect(last()).toBe('你，');
    reveal.update('你，👨‍👩‍👧‍👦好。继续', true, 100);
    vi.advanceTimersByTime(179);
    expect(last()).toBe('你，');
    vi.advanceTimersByTime(1);
    expect(last()).toBe('你，👨‍👩‍👧‍👦');
    vi.advanceTimersByTime(50);
    expect(last()).toBe('你，👨‍👩‍👧‍👦好');
    vi.advanceTimersByTime(50);
    expect(last()).toBe('你，👨‍👩‍👧‍👦好。');
    vi.advanceTimersByTime(319);
    expect(last()).toBe('你，👨‍👩‍👧‍👦好。');
    vi.advanceTimersByTime(1);
    expect(last()).toBe('你，👨‍👩‍👧‍👦好。继');
    vi.advanceTimersByTime(50);
    expect(last()).toBe('你，👨‍👩‍👧‍👦好。继续');
  });

  it('宿主替换文本会撤掉旧的待显示字符', () => {
    const { reveal, last } = clock();
    reveal.update('旧的消息', true, 100);
    vi.advanceTimersByTime(0);
    reveal.update('新的内容', true, 100);
    vi.advanceTimersByTime(1000);
    expect(last()).toBe('新的内容');
  });

  it('减少动画立即呈现完整文本，旧计时器不会覆盖结果', () => {
    const { reveal, values, last } = clock();
    reveal.update('完整的新消息', true, 100);
    vi.advanceTimersByTime(50);
    reveal.update('完整的新消息', false, 100);
    expect(last()).toBe('完整的新消息');
    const count = values.length;
    vi.advanceTimersByTime(1000);
    expect(values).toHaveLength(count);
  });

  it('收起或卸载会停止后续回调，重新挂载可以继续同一前缀', () => {
    const { reveal, values, last } = clock();
    reveal.update('你好世界', true, 100);
    vi.advanceTimersByTime(0);
    reveal.update('你好世界', true, 100, false);
    const count = values.length;
    vi.advanceTimersByTime(1000);
    expect(last()).toBe('你');
    expect(values).toHaveLength(count);
    reveal.update('你好世界', true, 100);
    vi.advanceTimersByTime(0);
    expect(last()).toBe('你好');
    reveal.stop();
    const stopped = values.length;
    vi.advanceTimersByTime(1000);
    expect(values).toHaveLength(stopped);
  });

  it('呈现速度遵循现有bubbleSpeed，不改变文本内容', () => {
    const { reveal, last } = clock();
    reveal.update('你好世界', true, 200);
    vi.advanceTimersByTime(75);
    expect(last()).toBe('你好世界');
  });
});
