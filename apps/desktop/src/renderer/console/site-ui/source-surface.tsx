/**
 * 来源控件的那一层归属容器：把 .su-source 摊在 children 外面。
 *
 * 六个 token 的值不在这儿决定：source-controls.css 让它们读 theme.ts 刷到 <html> 上的
 * 同一批配色变量。默认那条记录就是网站原件那一份（白底、#323232 描边、#2d8cf0 焦点），
 * 所以没自定义过的机器打开看到的就是网站上那一份，配色工作室的草稿起点也是同一套值。
 * 换内置、换自定义、试色、撤销试色，都由那一个 paintTheme 落地，这一层没有分支、订阅或第二份状态。
 */
import type { JSX, ReactNode } from 'react';

export const SOURCE_SURFACE_CLASS = 'su-source';

export interface SourceSurfaceProps {
  /** 外面那一层已有的类名（比如设置台外壳自己的 pb-shell）；归属类名合在它后面。 */
  className?: string;
  children: ReactNode;
}

export function SourceSurface({ className, children }: SourceSurfaceProps): JSX.Element {
  const merged =
    className === undefined ? SOURCE_SURFACE_CLASS : className + ' ' + SOURCE_SURFACE_CLASS;
  return <div className={merged}>{children}</div>;
}
