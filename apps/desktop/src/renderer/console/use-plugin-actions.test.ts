import { describe, expect, it } from 'vitest';

import { makeError, type ConsolePluginChange, type ConsoleSnapshot } from '@pet/contracts';

import { UNCERTAIN } from './copy.js';
import { actionLabel, isConfirmedRejection, pluginActionOutcome } from './use-plugin-actions.js';

const snapshot: ConsoleSnapshot = {
  version: 1,
  host: {
    version: 1,
    runtime: 'ready',
    installedPlugins: 1,
    activePlugins: 0,
    unreadyPlugins: 1,
    pendingRestartPlugins: 0,
    runningTasks: 0,
    pendingWork: 0,
  },
  plugins: [],
  contributions: [],
  app: { name: 'AI 桌宠', version: '0.0.0', electron: '45', node: '24', platform: 'win32-x64' },
};

const change = (operationError: ConsolePluginChange['operationError']): ConsolePluginChange => ({
  snapshot,
  operationError,
});

/**
 * 这条规则决定界面是否把一次操作说成成功：
 * 快照里的状态可能已经变了（enable 落到 unready），但 operationError 非空就是没达成。
 */
describe('插件动作结果', () => {
  it('operationError 为 null 才算达成', () => {
    expect(pluginActionOutcome(change(null))).toEqual({ ok: true, error: null, unknown: false });
  });

  it('operationError 非空时给出固定文案，不当作成功，也不说成未确认', () => {
    const outcome = pluginActionOutcome(change(makeError('permission-denied', false)));
    expect(outcome).toEqual({ ok: false, error: '没有获得授权', unknown: false });
  });

  it('只有发生在动作之前的拒绝才算没有发生', () => {
    for (const code of [
      'permission-denied',
      'invalid-input',
      'stale-owner',
      'not-ready',
    ] as const) {
      expect(isConfirmedRejection(code)).toBe(true);
    }
    // 桥或宿主当时不可达：动作可能已经发生，不能声称已回滚。
    for (const code of ['unavailable', 'timeout', 'internal'] as const) {
      expect(isConfirmedRejection(code)).toBe(false);
    }
  });

  it('未确认的文案要求用户自己重新读取，不说成已完成', () => {
    expect(UNCERTAIN).toBe('结果未确认，请重新读取插件状态。');
    expect(UNCERTAIN).not.toMatch(/已/);
  });

  it('动作文案覆盖三个动作', () => {
    expect([actionLabel('enable'), actionLabel('disable'), actionLabel('uninstall')]).toEqual([
      '启用',
      '停用',
      '卸载',
    ]);
  });
});
