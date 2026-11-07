import type { JSX } from 'react';
import { StatusBadge } from '@pet/ui-kit';

import { clockTime } from './format.js';
import type { ClientState } from './state.js';

const PHASE_LABELS = {
  idle: '未连接',
  connecting: '正在连接',
  live: '已连接',
  offline: '连接已断开',
} as const;

/**
 * 一行连接事实：当前状态、最后确认时间、恢复入口。
 * 断开时明确说「当前状态未知」，避免把上次的 running 当成现在还在跑。
 */
export function ConnectionLine({
  state,
  onReconnect,
}: {
  state: ClientState;
  onReconnect: () => void;
}): JSX.Element {
  const tone = state.phase === 'live' ? 'ok' : state.phase === 'offline' ? 'danger' : 'neutral';
  return (
    <div className="tc-conn">
      <StatusBadge tone={tone}>{PHASE_LABELS[state.phase]}</StatusBadge>
      {state.confirmedAt === null ? null : (
        <span className="tc-conn__time">最后确认 {clockTime(state.confirmedAt)}</span>
      )}
      {state.phase === 'offline' ? (
        <>
          <span className="tc-conn__hint">当前状态未知，显示的是上次确认的内容。</span>
          <button type="button" className="tc-link" onClick={onReconnect}>
            重新连接
          </button>
        </>
      ) : null}
    </div>
  );
}
