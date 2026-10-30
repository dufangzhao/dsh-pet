/**
 * 目录瓦片：来源包没有这一件，按同一份语法补的延伸。
 * 形状是那三件原件的（2px 描边、5px 圆角、4px 4px 硬投影、按下 translate(3px, 3px) 且投影归零）；
 * 选中态直接用 stupid-seahorse-9 选中那一格的说法：整块填 --main-color，字变 --bg-color。
 *
 * 默认是切换按钮；一组里必须单选时，调用方直接传原生 role="radio" 与 aria-checked——props 全透传。
 */
import './source-extensions.css';

import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';

export interface SourceTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** 名称左边的一枚图形（厂商标记或 vendored 字形）。装饰性，名称仍在文字里。 */
  leading?: ReactNode;
  /** 名称下面那句状态：未接入、国际平台、已存有 Key。 */
  note?: ReactNode;
}

export function SourceTile({
  selected = false,
  leading,
  note,
  type = 'button',
  disabled = false,
  className,
  children,
  ...rest
}: SourceTileProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-pressed={selected ? true : undefined}
      data-selected={selected ? 'true' : 'false'}
      className={'su-tile' + (className ? ' ' + className : '')}
    >
      <span className="su-tile__head">
        {leading === undefined ? null : (
          <span className="su-tile__mark" aria-hidden="true">
            {leading}
          </span>
        )}
        <span className="su-tile__name">{children}</span>
      </span>
      {note === undefined ? null : <span className="su-tile__note">{note}</span>}
    </button>
  );
}
