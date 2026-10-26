import type { JSX, ReactNode } from 'react';

import type { Tone } from './tone.js';

export interface StatusBadgeProps {
  tone?: Tone;
  children: ReactNode;
}

/** 状态徽标：文字始终存在，颜色只做辅助。 */
export function StatusBadge({ tone = 'neutral', children }: StatusBadgeProps): JSX.Element {
  return <span className={`pk-badge pk-badge--${tone}`}>{children}</span>;
}
