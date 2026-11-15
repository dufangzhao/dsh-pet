/**
 * 测试用的真实初始态：与 Main 的 initialDesktopCompanionState 同形，
 * 不从渲染器猜一个"看起来已连接"的对象。
 */
import type { DesktopCompanionState } from '@pet/contracts';

export function initialDesktopCompanionState(): DesktopCompanionState {
  return {
    version: 1,
    revision: 0,
    source: 'unavailable',
    baseUrl: '',
    configRevision: 0,
    connectionId: null,
    phase: 'idle',
    confirmedAt: null,
    snapshot: null,
    pending: [],
    error: null,
  };
}
