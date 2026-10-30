/**
 * 设置台导航与工具行的图标：这一层的图形来自 vendored 的 Tabler outline 真字形
 * （site-ui/assets/，MIT © Paweł Kuna，逐枚 SHA-256 见 site-ui/source-manifest.json），
 * 由已装的 morphicons 2.0.2 渲染，线宽 2、弹簧用库里那个 preset 名。
 *
 * 文件末尾留下的是这套产品自己的两件事：品牌标记（切角牌 + 肉垫）与桌宠本尊那一枚方头猫。
 * 它们不是网站资源，也不冒充网站资源——导航与状态那九格已经全部换成真字形，
 * 这三枚只说“这是这一只”，不需要第二套图标库。
 */
import type { JSX } from 'react';

import { SiteGlyphIcon, type SiteGlyph } from './site-ui/site-icons.js';

export type SettingsNavIcon =
  'play' | 'bot' | 'shirt' | 'activity' | 'message' | 'puzzle' | 'shield' | 'info' | 'panel';

/** 语义名 → vendored 那一枚：父级按页面给语义名，这里只换成真字形。 */
const NAV_GLYPH: Readonly<Record<SettingsNavIcon, SiteGlyph>> = {
  play: 'player-play',
  bot: 'robot',
  shirt: 'shirt',
  activity: 'activity',
  message: 'message-circle',
  puzzle: 'puzzle',
  shield: 'shield',
  info: 'info-circle',
  panel: 'layout-dashboard',
};

interface IconProps {
  className?: string | undefined;
}

/** 外壳按父级给的语义名取图标；没给语义名就是外部页，走面板格子。 */
export function NavIcon({
  icon,
  className,
}: {
  icon?: SettingsNavIcon | undefined;
  className?: string | undefined;
}): JSX.Element {
  return <SiteGlyphIcon name={NAV_GLYPH[icon ?? 'panel']} size={20} className={className} />;
}

/** 开始：播放形，说的是“向导与连接从这里起步”，不是媒体按钮。 */
export function PlayIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="player-play" size={20} {...props} />;
}

/** 人设：方头机器人，指桌面上那个会说话的家伙。 */
export function BotIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="robot" size={20} {...props} />;
}

/** 装扮：一件上衣的轮廓。 */
export function ShirtIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="shirt" size={20} {...props} />;
}

/** 语音输入：一条声纹。 */
export function ActivityIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="activity" size={20} {...props} />;
}

/** 对话：一只气泡。 */
export function MessageIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="message-circle" size={20} {...props} />;
}

/** 扩展：一块拼图。 */
export function PuzzleIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="puzzle" size={20} {...props} />;
}

/** 权限：一面盾。 */
export function ShieldIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="shield" size={20} {...props} />;
}

/** 关于：一枚信息圈。 */
export function InfoIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="info-circle" size={20} {...props} />;
}

/** 外部页给不出语义名时的通用格子。 */
export function PanelIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="layout-dashboard" size={20} {...props} />;
}

/** 隐藏：一只划掉的眼，说的是桌面上的可见性，不是内容折叠。 */
export function HideIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="eye-off" size={20} {...props} />;
}

/** 夜相：一弯月，与白天的太阳成一对，用在日夜切换那一挡。 */
export function MoonIcon(props: IconProps): JSX.Element {
  return <SiteGlyphIcon name="moon" size={20} {...props} />;
}

/* ------------------------------------------------------------------ 产品自己的两件事 */

/**
 * 品牌标记：一块右上角切掉一格的牌，里面一枚肉垫。
 * 切角与肉垫是这套产品自己的记号（外壳铭牌与等待动画用它），不属于网站来源。
 */
export function BrandMark({ className, size = 26 }: IconProps & { size?: number }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="AI 桌宠"
    >
      <path d="M7 4.5h7.2l5.3 5.1V17a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 17V7A2.5 2.5 0 0 1 7 4.5Z" />
      <path d="M8.6 14.4h6.8a3 3 0 0 1-3.4 2.9 3 3 0 0 1-3.4-2.9Z" />
      <path d="M9.4 11.2h.01M12 10h.01M14.6 11.2h.01" />
    </svg>
  );
}

/** 桌宠本尊：一只方头猫，耳朵与两眼花的是“桌面上那个家伙”，不做表情演绎。 */
export function CatIcon(props: IconProps & { size?: number }): JSX.Element {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      width={props.size ?? 20}
      height={props.size ?? 20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.6 10 6.6 5.2l3.3 2.4h4.2l3.3-2.4 1 4.8a6.6 6.6 0 0 1 0 6.4c-1.5 1.9-3.6 2.9-6.4 2.9s-4.9-1-6.4-2.9a6.6 6.6 0 0 1 0-6.4Z" />
      <path d="M9.6 12.4h.01M14.4 12.4h.01" />
      <path d="M12 14.6v1.3" />
    </svg>
  );
}

/** 肉垫：四趾加掌心，用作等待与“它在听”的记号。 */
export function PawIcon(props: IconProps & { size?: number }): JSX.Element {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      width={props.size ?? 20}
      height={props.size ?? 20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.6" cy="9.2" r="1.8" />
      <circle cx="11" cy="6.8" r="1.8" />
      <circle cx="14.6" cy="8.6" r="1.8" />
      <path d="M11.9 11.6c2.5 0 4.4 1.7 4.4 3.8 0 1.8-1.5 3-4.4 3s-4.4-1.2-4.4-3c0-2.1 1.9-3.8 4.4-3.8Z" />
    </svg>
  );
}
