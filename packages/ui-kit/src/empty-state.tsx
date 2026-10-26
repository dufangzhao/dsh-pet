import type { JSX, ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string | undefined;
  /** 可选的下一步操作；没有真实功能时不要传。 */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="pk-empty">
      <p className="pk-empty__title">{title}</p>
      {description === undefined ? null : <p className="pk-empty__description">{description}</p>}
      {action === undefined ? null : <div className="pk-empty__action">{action}</div>}
    </div>
  );
}
