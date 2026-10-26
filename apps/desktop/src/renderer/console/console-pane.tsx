import type { JSX, ReactNode } from 'react';

export interface ConsolePaneProps {
  title: string;
  /** 标题下的一句说明，只在能补充信息时给。 */
  summary?: string | undefined;
  children: ReactNode;
}

/** 每页共用的内容骨架：唯一的 h1、可选一句说明、单栏内容。 */
export function ConsolePane({ title, summary, children }: ConsolePaneProps): JSX.Element {
  return (
    <div className="console-pane">
      <div className="console-pane__header">
        <h1 className="console-pane__title">{title}</h1>
        {summary === undefined ? null : <p className="console-pane__summary">{summary}</p>}
      </div>
      <div className="console-pane__body">{children}</div>
    </div>
  );
}
