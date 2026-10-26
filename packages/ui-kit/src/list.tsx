import type { JSX, ReactNode } from 'react';

export interface ListProps {
  /** 列表整体的可访问名称，通常就是所在 Section 的标题。 */
  label: string;
  children: ReactNode;
}

export function List({ label, children }: ListProps): JSX.Element {
  return (
    <ul className="pk-list" aria-label={label}>
      {children}
    </ul>
  );
}

export interface ListItemProps {
  title: ReactNode;
  description?: ReactNode;
  /** 右侧的短信息，等宽数字排版。 */
  meta?: ReactNode;
  trailing?: ReactNode;
}

export function ListItem({ title, description, meta, trailing }: ListItemProps): JSX.Element {
  return (
    <li className="pk-list__item">
      <span className="pk-list__text">
        <span className="pk-list__title">{title}</span>
        {description === undefined ? null : (
          <span className="pk-list__description">{description}</span>
        )}
      </span>
      {meta === undefined ? null : <span className="pk-list__meta">{meta}</span>}
      {trailing === undefined ? null : <span className="pk-list__trailing">{trailing}</span>}
    </li>
  );
}
