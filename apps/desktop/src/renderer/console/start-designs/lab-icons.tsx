/**
 * 版式共用的状态图标：自己画的 24 格线性形状，交给 morphicons 做形状之间的过渡。
 *
 * 只有真的状态变化才用变形——播放/暂停、看得见/看不见、白/黑、话筒/停止；
 * 不给一个不动的东西加动画。减少动画有两层，都要认：系统的 prefers-reduced-motion
 * 由 reducedMotion="user" 交给库处理，应用里那项「减少动画」打开时直接跳到终点
 * （reducedMotion="always"）。不自己写第二套补间引擎。
 */
import { MorphIcon, type IconNode } from 'morphicons/react';
import type { JSX } from 'react';

/** 一对形状：idle 与 active，切换就是这两者之间变形。 */
export interface LabGlyph {
  readonly idle: IconNode;
  readonly active: IconNode;
}

const path = (d: string): IconNode => [['path', { d }]];

export const LAB_GLYPHS = {
  /** 回应：双竖线是在跑（可暂停），三角是已暂停（可继续）。 */
  response: { idle: path('M9.4 5.5v13M14.6 5.5v13'), active: path('M8.5 5.6 18 12l-9.5 6.4Z') },
  /** 桌面上有没有这一只：睁眼与闭眼。 */
  desktop: {
    idle: path('M2.8 12C6 7.4 18 7.4 21.2 12 18 16.6 6 16.6 2.8 12Z'),
    active: path('M4.4 4.4 19.6 19.6M6.6 7.1C8.3 6.6 10.1 6.4 12 6.4c5.4 0 8.4 3.6 9.2 5.6'),
  },
  /** 这块预览的灯：日与月。 */
  light: {
    idle: path('M12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z'),
    active: path('M20 14.8A8.6 8.6 0 1 1 9.2 4a6.9 6.9 0 0 0 10.8 10.8Z'),
  },
  /** 说话：话筒与方块（在录时给停止）。 */
  voice: {
    idle: path('M12 4.4a2.6 2.6 0 0 1 2.6 2.6v4.4a2.6 2.6 0 0 1-5.2 0V7A2.6 2.6 0 0 1 12 4.4Z'),
    active: path('M7.8 7.8h8.4v8.4H7.8Z'),
  },
} satisfies Record<string, LabGlyph>;

export interface LabIconProps {
  readonly glyph: LabGlyph;
  readonly active: boolean;
  /** 应用「减少动画」这一项：打开就直接跳，不等系统设置。 */
  readonly motionReduced: boolean;
  /** 有名字就是图形（role=img + title），没名字就是纯装饰。 */
  readonly label?: string | undefined;
  readonly size?: number | string | undefined;
}

export function LabIcon({ glyph, active, motionReduced, label, size }: LabIconProps): JSX.Element {
  return (
    <MorphIcon
      icon={active ? glyph.active : glyph.idle}
      reducedMotion={motionReduced ? 'always' : 'user'}
      strokeWidth={1.6}
      size={size ?? 20}
      {...(label === undefined ? {} : { label })}
      color="currentColor"
    />
  );
}
