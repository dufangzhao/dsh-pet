import { describe, expect, it } from 'vitest';

import { runState } from './console-app.js';

/**
 * 侧栏那枚回应开关常年可见，说的话只有三种：桌宠没启动、正在回应、已暂停。
 * 这里守的是"能不能按"与"按下去是什么"不互相冒充——
 * 没启动时不能按，就不许写成可以继续。
 */
describe('侧栏回应开关的状态', () => {
  it('桌宠未启动：状态说未启动，按钮按不动', () => {
    expect(runState(false, false)).toEqual({
      status: '桌宠未启动',
      action: '暂停回应',
      hint: '桌宠未启动，现在没有可暂停的回应',
      enabled: false,
    });
  });

  it('在跑：按下去是暂停', () => {
    const state = runState(true, false);
    expect(state.status).toBe('运行中');
    expect(state.action).toBe('暂停回应');
    expect(state.enabled).toBe(true);
  });

  it('已暂停：按下去是继续，不写回暂停', () => {
    const state = runState(true, true);
    expect(state.status).toBe('已暂停');
    expect(state.action).toBe('继续回应');
    expect(state.enabled).toBe(true);
  });
});
