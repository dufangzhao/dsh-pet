/**
 * 按钮：Uiverse.io by andrew-demchenk0 的 afraid-squid-51（MIT，upstream/Buttons/…，SHA-256 见 source-manifest.json）。
 *
 * 形状、2px 描边、4px 4px 硬投影与按下那一格全在 source-controls.css 的 .su-button 里，
 * 这里只把浏览器本来就有的三件事接上：原生 type、等待时的 disabled + aria-busy、
 * 其余 props 原样交给 <button>。没有 variant 开关——上游这一件只有一种样子，
 * 需要密度差别用 size="small"（同一件控件换高度与字号，不加第二种形状）。
 */
import './source-controls.css';

import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';

/**
 * 同一件按钮的轻重四档，全部只用原件已有的六个 token：
 * normal 就是 afraid-squid-51 那一份；primary 借 stupid-seahorse-9 选中那一格的说法
 * （整块填 --main-color、字变 --bg-color）；quiet 关掉描边与投影只留字；
 * danger 把描边与投影换成状态色。没有第四种形状，也没有新颜色来源。
 */
export type SourceButtonVariant = 'normal' | 'primary' | 'quiet' | 'danger';

export interface SourceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SourceButtonVariant;
  size?: 'normal' | 'small';
  /** 正在等结果：原件按下去那一格就是等待的样子，另加 aria-busy 与 disabled。 */
  busy?: boolean;
  /** 文字左边的一枚图形（本站用的是 vendored 的 Tabler 字形）。装饰性，名称仍由文字承担。 */
  leading?: ReactNode;
}

export function SourceButton({
  variant = 'normal',
  size = 'normal',
  busy = false,
  leading,
  type = 'button',
  disabled = false,
  className,
  children,
  ...rest
}: SourceButtonProps): JSX.Element {
  const names =
    'su-button' +
    (variant === 'normal' ? '' : ' su-button--' + variant) +
    (size === 'small' ? ' su-button--small' : '') +
    (className ? ' ' + className : '');
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      {...(busy ? { 'aria-busy': true as const, 'data-busy': 'true' } : {})}
      className={names}
    >
      {leading === undefined ? null : (
        <span className="su-button__lead" aria-hidden="true">
          {leading}
        </span>
      )}
      {children}
    </button>
  );
}
