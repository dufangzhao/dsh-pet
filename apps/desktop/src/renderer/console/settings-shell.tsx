/**
 * 设置台外壳：导航、页面骨架与对齐行。
 *
 * 外壳不固定任何页面清单，也不认识「人设」「语音输入」这些具体入口：
 * 入口数组、当前项、选择回调与插槽内容都由父级给。外部页面启用、停用或消失时
 * 只改父级给的数组，这里跟着走。
 *
 * 分组继续用 @pet/ui-kit 的 Section；行（SettingsRow）只补它在设置台里缺的那件事：
 * 标签在左轨，值与控件右端对齐到同一条 260px 轨，行间用细线而不是卡片。
 */
import './settings-shell.css';

import { useId, useRef, type JSX, type ReactNode } from 'react';

import type { FieldControl } from '@pet/ui-kit';

const SIDEBAR_LABEL = '设置';
const NAV_LABEL = '设置页导航';
const SKIP_LABEL = '跳到主要内容';

export interface SettingsNavItem {
  /** 父级的入口标识；外壳只把它原样回传给 onSelect。 */
  id: string;
  label: string;
  /** 恢复类入口（扩展、关于）：仍然可达，但不与日常入口抢视觉重心。 */
  quiet?: boolean | undefined;
}

export interface SettingsShellProps {
  items: readonly SettingsNavItem[];
  selected: string;
  onSelect: (id: string) => void;
  /** 侧栏顶部的项目名。 */
  brand: string;
  /** 内容区唯一的 h1。 */
  title: string;
  /** 标题下的一句说明。 */
  summary?: string | undefined;
  /** 标题区的补充：状态行、贴着整页的低强调操作等。 */
  header?: ReactNode;
  /** 跨页提示条，停在内容区顶部；没有内容时连容器一起不出现。 */
  notice?: ReactNode;
  /** 侧栏底部：主题一类需要常驻的选择。 */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * 导航用真实按钮加 aria-current，Tab 顺序与视觉顺序一致。
 * 不用锚点或 hash：宿主按完整 URL 校验请求来源，改 URL 会让后续请求被拒。
 */
export function SettingsShell({
  items,
  selected,
  onSelect,
  brand,
  title,
  summary,
  header,
  notice,
  footer,
  children,
}: SettingsShellProps): JSX.Element {
  const mainRef = useRef<HTMLElement>(null);
  const everyday = items.filter((item) => item.quiet !== true);
  const recovery = items.filter((item) => item.quiet === true);

  return (
    <div className="pk-settings">
      <button type="button" className="pk-settings__skip" onClick={() => mainRef.current?.focus()}>
        {SKIP_LABEL}
      </button>

      <aside className="pk-settings__sidebar" aria-label={SIDEBAR_LABEL}>
        <p className="pk-settings__brand">{brand}</p>
        <nav className="pk-settings__nav" aria-label={NAV_LABEL}>
          <ul className="pk-settings__list">
            {everyday.map((item) => (
              <li key={item.id}>
                <NavButton item={item} selected={selected} onSelect={onSelect} />
              </li>
            ))}
          </ul>
          {recovery.length === 0 ? null : (
            <ul className="pk-settings__list pk-settings__list--quiet">
              {recovery.map((item) => (
                <li key={item.id}>
                  <NavButton item={item} selected={selected} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </nav>
        {footer === undefined ? null : <div className="pk-settings__footer">{footer}</div>}
      </aside>

      <main className="pk-settings__main" ref={mainRef} tabIndex={-1}>
        {notice === undefined ? null : <div className="pk-settings__notice">{notice}</div>}
        <div className="pk-settings__pane">
          <div className="pk-settings__header">
            <h1 className="pk-settings__title">{title}</h1>
            {summary === undefined ? null : <p className="pk-settings__summary">{summary}</p>}
            {header === undefined ? null : (
              <div className="pk-settings__header-extra">{header}</div>
            )}
          </div>
          <div className="pk-settings__body">{children}</div>
        </div>
      </main>
    </div>
  );
}

function NavButton({
  item,
  selected,
  onSelect,
}: {
  item: SettingsNavItem;
  selected: string;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="pk-settings__nav-button"
      aria-current={item.id === selected ? 'page' : undefined}
      onClick={() => onSelect(item.id)}
    >
      {item.label}
    </button>
  );
}

export interface SettingsRowsProps {
  children: ReactNode;
}

/** 一组行共用同一套分隔线与密度；分组标题仍由 Section 负责。 */
export function SettingsRows({ children }: SettingsRowsProps): JSX.Element {
  return <div className="pk-rows">{children}</div>;
}

/**
 * 行交给控件的关联契约：单个控件用 inputId，控件组（单选、分段）用 labelledBy。
 * labelId 与 labelledBy 是同一个 id，后者只是可以直接填进 aria-labelledby。
 */
export interface SettingsRowControl extends FieldControl {
  /** 名称元素的 id。 */
  labelId: string;
  /** 给控件组做 aria-labelledby 用。 */
  labelledBy: string;
}

export interface SettingsRowProps {
  /** 左轨的名称。给控件时它就是控件的可访问名称。 */
  label: string;
  /** 名称旁的短句（生效方式、代价），不进可访问名称。 */
  hint?: ReactNode;
  /**
   * 名称标注的是行内单个控件还是控件组。
   * 'control'（默认）渲染 <label for=inputId>；
   * 'group' 渲染带 id 的普通文本，由控件组自己写 aria-labelledby=labelledBy，
   * 这样不会留下一个指向不存在控件的 label。
   */
  labelFor?: 'control' | 'group' | undefined;
  /** 左轨下的一句说明。 */
  description?: string | undefined;
  /** 左轨下的失败原因：出现时控件标为 aria-invalid，并立即播报。 */
  error?: string | undefined;
  /** 控件放不下右轨时（Key 输入、一组按钮）整行退成上下两段。 */
  wide?: boolean | undefined;
  /**
   * 节点＝这一行只展示当前值或只读内容；
   * 函数＝这一行持有控件，除 ui-kit Field 的 inputId、describedBy、invalid 外，
   * 还给出名称的 labelId / labelledBy，供控件组标注。
   */
  children: ReactNode | ((control: SettingsRowControl) => ReactNode);
}

/**
 * 一行一个设置：名称与它的说明、错误留在左轨，控件永远落在右端同一条轨上，
 * 纵向扫读时所有值对齐。关联方式与 Field 一致（label→id、aria-describedby、role=alert），
 * 只是把上下堆叠换成左右两轨；需要堆叠的长表单继续直接用 Field。
 */
export function SettingsRow({
  label,
  hint,
  labelFor = 'control',
  description,
  error,
  wide = false,
  children,
}: SettingsRowProps): JSX.Element {
  const id = useId();
  const inputId = `${id}-input`;
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy =
    [description === undefined ? '' : descriptionId, error === undefined ? '' : errorId]
      .filter(Boolean)
      .join(' ') || undefined;

  const holdsControl = typeof children === 'function';
  const namesGroup = holdsControl && labelFor === 'group';
  const control = holdsControl
    ? children({
        inputId,
        labelId,
        labelledBy: labelId,
        describedBy,
        invalid: error !== undefined,
      })
    : children;

  return (
    <div className={wide ? 'pk-row pk-row--stack' : 'pk-row'}>
      <div className="pk-row__label">
        <span className="pk-row__head">
          {holdsControl && !namesGroup ? (
            <label className="pk-row__name" id={labelId} htmlFor={inputId}>
              {label}
            </label>
          ) : (
            <span className="pk-row__name" id={holdsControl ? labelId : undefined}>
              {label}
            </span>
          )}
          {hint === undefined ? null : <span className="pk-row__hint">{hint}</span>}
        </span>
        {description === undefined ? null : (
          <p className="pk-row__description" id={descriptionId}>
            {description}
          </p>
        )}
        {error === undefined ? null : (
          <p className="pk-row__error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="pk-row__value">{control}</div>
    </div>
  );
}
