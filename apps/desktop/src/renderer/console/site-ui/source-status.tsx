/**
 * 状态牌与回执：来源包里没有这两件，按同一份语法补的延伸（见 source-extensions.css 顶上那条规矩）。
 * 说法来自那三件原件：2px --main-color 描边、5px 圆角、4px 4px 硬投影、15px/600 的字；
 * 记号色只有 --su-ok / --su-warn / --su-error / --input-focus 四格，文字永远在场，色只是辅助。
 *
 * danger 走 role=alert（失败要打断），其余按 live 决定 role=status 或不播报。
 */
import '../site-ui/source-extensions.css';

import type { JSX, ReactNode } from 'react';

export type SourceStatusTone = 'neutral' | 'on' | 'off' | 'ok' | 'warn' | 'danger';
export type SourceNoticeTone = 'neutral' | 'ok' | 'warn' | 'danger';

export interface SourceStatusProps {
  tone?: SourceStatusTone;
  className?: string;
  children: ReactNode;
}

export function SourceStatus({
  tone = 'neutral',
  className,
  children,
}: SourceStatusProps): JSX.Element {
  return (
    <span className={'su-status' + (className ? ' ' + className : '')} data-tone={tone}>
      <span className="su-status__lamp" aria-hidden="true" />
      <span className="su-status__text">{children}</span>
    </span>
  );
}

export interface SourceNoticeProps {
  tone?: SourceNoticeTone;
  /** 结果回执要立刻播报（默认是）；只是说明性的一段时关掉。 */
  live?: boolean;
  /** 一句后续动作，例如「重新读取」。 */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function SourceNotice({
  tone = 'neutral',
  live = true,
  action,
  className,
  children,
}: SourceNoticeProps): JSX.Element {
  return (
    <div
      className={'su-notice' + (className ? ' ' + className : '')}
      data-tone={tone}
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <div className="su-notice__body">{children}</div>
      {action === undefined ? null : <div className="su-notice__action">{action}</div>}
    </div>
  );
}
