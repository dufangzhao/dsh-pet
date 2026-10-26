import { useId, type JSX, type ReactNode } from 'react';

export interface SectionProps {
  title: string;
  description?: string | undefined;
  /** 标题右侧的操作，通常是 Button。 */
  actions?: ReactNode;
  children: ReactNode;
}

/** 单栏内容分组：一个标题、一段可选说明、一条细分隔线，不做卡片容器。 */
export function Section({ title, description, actions, children }: SectionProps): JSX.Element {
  const titleId = useId();

  return (
    <section className="pk-section" aria-labelledby={titleId}>
      <div className="pk-section__header">
        <h2 className="pk-section__title" id={titleId}>
          {title}
        </h2>
        {actions === undefined ? null : <div className="pk-section__actions">{actions}</div>}
      </div>
      {description === undefined ? null : <p className="pk-section__description">{description}</p>}
      <div className="pk-section__body">{children}</div>
    </section>
  );
}
