import type { JSX, ReactNode } from 'react';

export interface ConsolePaneProps {
  title: string;
  /** 标题下的一句说明，保持一行以内。 */
  summary?: string | undefined;
  children: ReactNode;
}

/** 每页共用的内容骨架：唯一的 h1、一句说明、单栏内容。 */
export function ConsolePane({ title, summary, children }: ConsolePaneProps): JSX.Element {
  return (
    <div className="console-pane">
      <h1 className="console-pane__title">{title}</h1>
      {summary === undefined ? null : <p className="console-pane__summary">{summary}</p>}
      <div className="console-pane__body">{children}</div>
    </div>
  );
}
