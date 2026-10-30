/**
 * 段落外壳与抽屉段：外壳那一层板面来自 afraid-cougar-9 的卡片材质
 * （2px 描边、5px 圆角、4px 4px 硬投影、20px 内边距、20px 间隔；https://uiverse.io/andrew-demchenk0/afraid-cougar-9，
 * 只取材质，不移植它的登录与翻转业务）。
 *
 * 抽屉段是同一份语法里的延伸：原生 details/summary，展开只让箭头转一次；上游没有这一件。
 */
import './source-controls.css';
import './source-extensions.css';

import { useId, type JSX, type ReactNode } from 'react';

export interface SourcePanelProps {
  title: string;
  note?: string;
  /** 标题右边此刻的状态（一块 SourceStatus 或一句话）。 */
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
}

export function SourcePanel({
  title,
  note,
  status,
  actions,
  className,
  children,
  'data-testid': testId,
}: SourcePanelProps): JSX.Element {
  const titleId = useId();
  return (
    <section
      className={'su-panel' + (className ? ' ' + className : '')}
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <header className="su-panel__head">
        <h2 className="su-panel__title" id={titleId}>
          {title}
        </h2>
        <div className="su-panel__aside">
          {status ?? null}
          {actions ?? null}
        </div>
      </header>
      {note === undefined ? null : <p className="su-panel__note">{note}</p>}
      <div className="su-panel__body">{children}</div>
    </section>
  );
}

export interface SourceDisclosureProps {
  label: ReactNode;
  hint?: ReactNode;
  /** 受控展开。React 的 details 只认 open，所以 defaultOpen 走同一条路：写初值，之后由浏览器自己开合。 */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  defaultOpen?: boolean | undefined;
  className?: string;
  children: ReactNode;
}

export function SourceDisclosure({
  label,
  hint,
  open,
  onOpenChange,
  defaultOpen = false,
  className,
  children,
}: SourceDisclosureProps): JSX.Element {
  return (
    <details
      className={'su-fold' + (className ? ' ' + className : '')}
      open={open ?? (defaultOpen ? true : undefined)}
      onToggle={(event) => {
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary className="su-fold__summary">
        <span className="su-fold__label">{label}</span>
        {hint === undefined ? null : <span className="su-fold__hint">{hint}</span>}
        <span className="su-fold__chevron" aria-hidden="true" />
      </summary>
      <div className="su-fold__body">{children}</div>
    </details>
  );
}
