/**
 * 极简设置台的外壳：一扇窗（标题栏 + 侧栏 + 内容区），结构照 qa/minimal-settings-preview 的
 * .window / .titlebar / .body / .rail / .content / .page。
 *
 * 外壳仍然不认识任何具体页面：入口数组、当前项、选择回调与插槽内容都由父级给，
 * 扩展被停用或撤掉一页时只改父级给的数组。折叠不在这里记：窗口窄到 980px 以下时
 * 侧栏自己收成图标轨（foundation.css 的媒体查询），省掉一条本机偏好与一个按钮。
 *
 * props 沿用 settings-shell.tsx 导出的那一份类型：换默认呈现只换组件，调用处一个字不改。
 */
import { useId, useRef, type JSX } from 'react';

import { BrandMark, NavIcon } from '../icons.js';
import type { SettingsNavItem, SettingsShellProps } from '../settings-shell.js';

const SIDEBAR_LABEL = '设置';
const NAV_LABEL = '设置页导航';
const SKIP_LABEL = '跳到主要内容';

export function MinimalShell({
  items,
  selected,
  onSelect,
  brand,
  title,
  actions,
  header,
  notice,
  footer,
  children,
}: SettingsShellProps): JSX.Element {
  const titleId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const everyday = items.filter((item) => item.quiet !== true);
  const recovery = items.filter((item) => item.quiet === true);

  return (
    <div className="window" data-testid="settings-shell">
      {/* 只在键盘聚焦时出现：侧栏可能有一串入口，跳过它们是这一层唯一的捷径。 */}
      <button
        type="button"
        className="skip"
        data-testid="settings-skip"
        onClick={() => mainRef.current?.focus()}
      >
        {SKIP_LABEL}
      </button>

      <header className="titlebar">
        <span className="titlebar__mark" aria-hidden="true">
          <BrandMark size={22} />
        </span>
        <h1 className="titlebar__name">{brand}</h1>
        <span className="titlebar__spacer" />
      </header>

      <div className="body">
        <aside className="rail" aria-label={SIDEBAR_LABEL} data-testid="settings-sidebar">
          <nav className="rail__nav" aria-label={NAV_LABEL} data-testid="settings-nav">
            <ul className="rail__list">
              {everyday.map((item) => (
                <li key={item.id}>
                  <NavButton item={item} selected={selected} onSelect={onSelect} />
                </li>
              ))}
            </ul>
            {recovery.length === 0 ? null : (
              <ul className="rail__list rail__list--quiet">
                {recovery.map((item) => (
                  <li key={item.id}>
                    <NavButton item={item} selected={selected} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            )}
          </nav>
          {footer === undefined ? null : <div className="rail__foot">{footer}</div>}
        </aside>

        <main className="content" ref={mainRef} tabIndex={-1} data-testid="settings-main">
          {notice === undefined ? null : (
            <div className="content__notice" data-testid="settings-notice">
              {notice}
            </div>
          )}
          <section className="page" aria-labelledby={titleId} data-testid="settings-content">
            <div className="page__head">
              <h2 className="page__title" id={titleId}>
                {title}
              </h2>
              {actions === undefined ? null : <div className="page__actions">{actions}</div>}
            </div>
            {header === undefined ? null : <div className="page__extra">{header}</div>}
            {children}
          </section>
        </main>
      </div>
    </div>
  );
}

/**
 * 导航是真实按钮加 aria-current，Tab 顺序与视觉顺序一致。
 * 不用锚点或 hash：宿主按完整 URL 校验请求来源，改 URL 会让后续请求被拒。
 */
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
      className="nav"
      data-testid={'nav-' + item.id}
      title={item.label}
      aria-current={item.id === selected ? 'page' : undefined}
      onClick={() => onSelect(item.id)}
    >
      <NavIcon icon={item.icon} className="nav__icon" />
      <span className="nav__label">{item.label}</span>
    </button>
  );
}
