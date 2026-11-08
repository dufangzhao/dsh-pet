import { describe, expect, it } from 'vitest';

import { connectionView } from '../shared/companion-state.js';
import { initialDesktopCompanionState } from './test-state.js';

/**
 * 侧栏底部那一行说的是连接事实，不是本地运行状态：
 * 源停用、断线、连接中各有各的说法，谁也不能冒充「已连接」。
 */
describe('连接状态行', () => {
  it('未配置时是未连接，语气中性', () => {
    const state = { ...initialDesktopCompanionState(), source: 'ready' as const };
    expect(connectionView(state)).toEqual({ tone: 'muted', label: '未连接', detail: null });
  });

  it('断线要说当前状态未知，不能把上次的运行当成现在', () => {
    const view = connectionView({
      ...initialDesktopCompanionState(),
      source: 'ready',
      phase: 'offline',
    });
    expect(view.tone).toBe('danger');
    expect(view.detail).toContain('当前状态未知');
  });

  it('源被停用与连接状态正交：即便 phase 仍是 offline 也只说停用', () => {
    const view = connectionView({
      ...initialDesktopCompanionState(),
      source: 'disabled',
      phase: 'offline',
    });
    expect(view.label).toBe('连接组件已停用');
    expect(view.detail).toContain('插件页恢复');
  });

  it('连接中带上是哪一台主机，不写成已连接', () => {
    const view = connectionView({
      ...initialDesktopCompanionState(),
      source: 'ready',
      phase: 'connecting',
      baseUrl: 'http://127.0.0.1:4120',
    });
    expect(view.tone).toBe('warn');
    expect(view.detail).toContain('127.0.0.1:4120');
  });
});
