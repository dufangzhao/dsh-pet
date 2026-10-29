/**
 * 设置台外壳：可折叠侧栏、页面骨架、分节与对齐行。用的是原创控件层同一套记号（见 kit.css 顶部）。
 *
 * 外壳不固定任何页面清单，也不认识「人设」「语音输入」这些具体入口：
 * 入口数组、当前项、选择回调与插槽内容都由父级给。外部页面启用、停用或消失时
 * 只改父级给的数组，这里跟着走。
 *
 * 侧栏展开 248px、折叠 72px。折叠后每项只剩一枚线性图标：完整名称仍然是按钮里的文字（只是不占位），
 * 读屏与悬停提示都拿得到。折叠状态记在本机，下次打开还是这样。
 *
 * 分节（SettingsSection）比通用分组多一件事：标题右边挂着真实状态，那一枚是 kit 的状态牌。
 * 行（SettingsRow）补的是设置台里缺的那件事：名称与说明在左轨，值与控件右端对齐到同一条轨，
 * 行间用细线而不是卡片墙。
 */
import './settings-shell.css';

import { useCallback, useId, useRef, useState, type JSX, type ReactNode } from 'react';

import type { FieldControl } from './original-ui/kit.js';
import { Status } from './original-ui/kit.js';
import { BrandMark, NavIcon, type SettingsNavIcon } from './icons.js';

const SIDEBAR_LABEL = '设置';
const NAV_LABEL = '设置页导航';
const SKIP_LABEL = '跳到主要内容';
const RAIL_COLLAPSE_LABEL = '收起侧栏';
const RAIL_EXPAND_LABEL = '展开侧栏';
const RAIL_STORAGE_KEY = 'pet.console.rail';

export interface SettingsNavItem {
  /** 父级的入口标识；外壳只把它原样回传给 onSelect。 */
  id: string;
  label: string;
  /**
   * 折叠侧栏上画的那一枚图标。语义名由父级按页面给（内置视图、恢复入口各有其名），
   * 外部插件页给不出来就用通用格子——外壳不认识具体页面，也不替它编一个含义。
   */
  icon?: SettingsNavIcon | undefined;
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
  /** 标题右边整页级的低强调操作（例如「使用向导」），与标题同一行。 */
  actions?: ReactNode;
  /** 标题区的补充：状态行、贴着整页的说明等。 */
  header?: ReactNode;
  /** 跨页提示条，停在内容区顶部；没有内容时连容器一起不出现。 */
  notice?: ReactNode;
  /** 侧栏底部：运行状态与主题这类需要常驻的选择。 */
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
  actions,
  header,
  notice,
  footer,
  children,
}: SettingsShellProps): JSX.Element {
  const mainRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<boolean>(readStoredRail);
  const everyday = items.filter((item) => item.quiet !== true);
  const recovery = items.filter((item) => item.quiet === true);

  const toggleRail = useCallback((): void => {
    const next = !collapsed;
    // 先写存储再改状态：写失败只影响下次启动的默认值，当前这一次要立刻生效。
    storeRailCollapsed(next);
    setCollapsed(next);
  }, [collapsed]);

  return (
    <div
      className="pb-shell"
      data-rail={collapsed ? 'collapsed' : 'expanded'}
      data-testid="settings-shell"
    >
      <button
        type="button"
        className="pb-shell__skip"
        data-testid="settings-skip"
        onClick={() => mainRef.current?.focus()}
      >
        {SKIP_LABEL}
      </button>

      <aside className="pb-rail" aria-label={SIDEBAR_LABEL} data-testid="settings-sidebar">
        <div className="pb-rail__brand-row">
          <p className="pb-rail__brand">
            <BrandMark />
            <span className="pb-rail__brand-name">{brand}</span>
          </p>
          <button
            type="button"
            className="pb-rail__toggle"
            aria-label={collapsed ? RAIL_EXPAND_LABEL : RAIL_COLLAPSE_LABEL}
            aria-expanded={!collapsed}
            onClick={toggleRail}
          >
            {/* 折叠后只剩这个箭头：箭头与文字在同一个按钮里，读屏拿到的是完整名称。 */}
            <svg
              className="pb-rail__chevron"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 5 8 12l7 7" />
            </svg>
            <span className="pb-rail__toggle-text">
              {collapsed ? RAIL_EXPAND_LABEL : RAIL_COLLAPSE_LABEL}
            </span>
          </button>
        </div>

        <nav className="pb-rail__nav" aria-label={NAV_LABEL} data-testid="settings-nav">
          <ul className="pb-rail__list">
            {everyday.map((item) => (
              <li key={item.id}>
                <NavButton item={item} selected={selected} onSelect={onSelect} />
              </li>
            ))}
          </ul>
          {recovery.length === 0 ? null : (
            <ul className="pb-rail__list pb-rail__list--quiet">
              {recovery.map((item) => (
                <li key={item.id}>
                  <NavButton item={item} selected={selected} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </nav>
        {footer === undefined ? null : <div className="pb-rail__footer">{footer}</div>}
      </aside>

      <main className="pb-main" ref={mainRef} tabIndex={-1} data-testid="settings-main">
        <div className="pb-main__inner">
          {notice === undefined ? null : (
            <div className="pb-main__notice" data-testid="settings-notice">
              {notice}
            </div>
          )}
          <div className="pb-main__header">
            <div className="pb-main__title-row">
              <h1 className="pb-main__title">{title}</h1>
              {actions === undefined ? null : <div className="pb-main__actions">{actions}</div>}
            </div>
            {summary === undefined ? null : <p className="pb-main__summary">{summary}</p>}
            {header === undefined ? null : <div className="pb-main__header-extra">{header}</div>}
          </div>
          <div className="pb-main__body" data-testid="settings-content">
            {children}
          </div>
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
      className="pb-nav"
      title={item.label}
      onClick={() => onSelect(item.id)}
      aria-current={item.id === selected ? 'page' : undefined}
    >
      <NavIcon icon={item.icon} className="pb-nav__icon" />
      <span className="pb-nav__text">{item.label}</span>
    </button>
  );
}

/** 存储不可用时按展开处理：折叠只是省地方的偏好，不该让界面打不开。 */
function readStoredRail(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function storeRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(RAIL_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // 存不下就这一次不记住，当前窗口照样折叠。
  }
}

export interface SettingsRowsProps {
  children: ReactNode;
}

/** 一组行共用同一套分隔线与密度；分组标题仍由 SettingsSection 负责。 */
export function SettingsRows({ children }: SettingsRowsProps): JSX.Element {
  return <div className="pb-rows">{children}</div>;
}

/**
 * 行交给控件的关联契约：单个控件用 inputId，控件组（单选、分段）用 labelledBy。
 * labelId 与 labelledBy 是同一个 id，后者只是可以直接填进 aria-labelledby。
 */
export interface SettingsRowControl extends FieldControl {
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
   * 函数＝这一行持有控件，除 kit 字段的 inputId、describedBy、invalid 外，
   * 还给出名称的 labelId / labelledBy，供控件组标注。
   */
  children: ReactNode | ((control: SettingsRowControl) => ReactNode);
}

/**
 * 一行一个设置：名称与它的说明、错误留在左轨，控件永远落在右端同一条轨上，
 * 纵向扫读时所有值对齐。关联方式与 kit 的 Field 一致（label→id、aria-describedby、role=alert），
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
  const inputId = id + '-input';
  const labelId = id + '-name';
  const descriptionId = id + '-description';
  const errorId = id + '-error';
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
    <div className={wide ? 'pb-row pb-row--stack' : 'pb-row'}>
      <div className="pb-row__label">
        <span className="pb-row__head">
          {holdsControl && !namesGroup ? (
            <label className="pb-row__name" id={labelId} htmlFor={inputId}>
              {label}
            </label>
          ) : (
            <span className="pb-row__name" id={holdsControl ? labelId : undefined}>
              {label}
            </span>
          )}
          {hint === undefined ? null : <span className="pb-row__hint">{hint}</span>}
        </span>
        {description === undefined ? null : (
          <p className="pb-row__description" id={descriptionId}>
            {description}
          </p>
        )}
        {error === undefined ? null : (
          <p className="pb-row__error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="pb-row__value">{control}</div>
    </div>
  );
}

/** 分节标题右边那一枚状态牌的语气。 */
export type SettingsPillTone = 'neutral' | 'on' | 'off';

export interface SettingsSectionProps {
  title: string;
  /** 标题右边的状态；没有真实状态时不传，外壳不猜。 */
  state?: { text: string; tone: SettingsPillTone } | undefined;
  description?: string | undefined;
  /** 标题同一行右侧的操作。 */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * 设置台里的分节：一条上轨、一个标题、一句说明，然后才是内容。
 *
 * 标题右边常年挂着真实状态（在桌面上、已连接），所以外壳自己画这一段；
 * 那一枚状态用 kit 的状态牌，五个版式因此共用同一种状态语言。
 */
export function SettingsSection({
  title,
  state,
  description,
  actions,
  children,
}: SettingsSectionProps): JSX.Element {
  const titleId = useId();

  return (
    <section className="pb-sheet" aria-labelledby={titleId}>
      <div className="pb-sheet__head">
        <h2 className="pb-sheet__title" id={titleId}>
          {title}
          {state === undefined ? null : <Status tone={state.tone}>{state.text}</Status>}
        </h2>
        {actions === undefined ? null : <div className="pb-sheet__actions">{actions}</div>}
      </div>
      {description === undefined ? null : <p className="pb-sheet__description">{description}</p>}
      <div className="pb-sheet__body">{children}</div>
    </section>
  );
}
