/**
 * 设置台导航的线性图标：24 单位一格，一律 1.6 线宽、currentColor、圆端点。
 *
 * 图标只补一件事——折叠到 72px 那一栏时导航仍然认得出是哪一页；含义始终由文字承担，
 * 所以这里不画彩色，外部页面给不出对应语义时用统一的 panel 格子。
 *
 * 文件末尾是这套产品自己的形状：品牌标记（切角牌 + 肉垫）与猫、肉垫、隐藏、夜相四枚。
 * 它们与导航同一格、同一线宽，因此不需要第二个图标包；morphicons 2.0.2 的 MorphIcon
 * 仍然可以拿这些字形数据做两态形变（见 research/design-system.md 的用法与限制）。
 */
import type { JSX, ReactNode } from 'react';

export type SettingsNavIcon =
  'play' | 'bot' | 'shirt' | 'activity' | 'message' | 'puzzle' | 'shield' | 'info' | 'panel';

interface IconProps {
  className?: string | undefined;
}

function Frame({ children, className }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 开始：一个播放形，说的是“向导与连接从这里起步”，不是媒体按钮。 */
export function PlayIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M9 6.5 17.5 12 9 17.5Z" />
    </Frame>
  );
}

/** 人设：方头加两只眼，指桌面上那个会说话的家伙。 */
export function BotIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <rect x="4" y="7.5" width="16" height="12" rx="3.5" />
      <path d="M12 4v3.5" />
      <path d="M9 13h.01M15 13h.01" />
    </Frame>
  );
}

/** 装扮：一件上衣的轮廓。 */
export function ShirtIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M9 4 5 6.5 3.5 11l3 1.5V20h11v-7.5l3-1.5L15 6.5 12 8.5Z" />
    </Frame>
  );
}

/** 语音输入：一条声纹折线。 */
export function ActivityIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M3 12.5h3.5L9 5.5l3.5 13 2.5-9h5.5" />
    </Frame>
  );
}

/** 对话：一只气泡。 */
export function MessageIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M4 6h16v10H10l-4 3v-3H4Z" />
    </Frame>
  );
}

/** 扩展：一块带凸角的小拼图。 */
export function PuzzleIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M4 5h6v2.5a2 2 0 1 0 4 0V5h6v5h-2.5a2 2 0 1 0 0 4H20v5H4Z" />
    </Frame>
  );
}

/** 权限与数据：一面盾。 */
export function ShieldIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M12 3.5 19 6v6c0 4-3 6.8-7 8.5-4-1.7-7-4.5-7-8.5V6Z" />
    </Frame>
  );
}

/** 关于：一个圈里的一竖两点。 */
export function InfoIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.6h.01" />
    </Frame>
  );
}

/** 外部页面给的入口：一格面板，不猜它的语义。 */
export function PanelIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <path d="M4 9.5h16" />
    </Frame>
  );
}

/* ------------------------------------------------------------------ 自家形状 */

/**
 * 品牌标记：一块右上角切掉一格的牌，里面一枚肉垫。
 * 切角与肉垫就是这套产品反复出现的两件事——外壳铭牌、状态牌、字段铭牌用的是同一个记号。
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
export function CatIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M5.6 10 6.6 5.2l3.3 2.4h4.2l3.3-2.4 1 4.8a6.6 6.6 0 0 1 0 6.4c-1.5 1.9-3.6 2.9-6.4 2.9s-4.9-1-6.4-2.9a6.6 6.6 0 0 1 0-6.4Z" />
      <path d="M9.6 12.4h.01M14.4 12.4h.01" />
      <path d="M12 14.6v1.3" />
    </Frame>
  );
}

/** 肉垫：四趾加掌心，用作等待与“它在听”的记号。 */
export function PawIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <circle cx="7.6" cy="9.2" r="1.8" />
      <circle cx="11" cy="6.8" r="1.8" />
      <circle cx="14.6" cy="8.6" r="1.8" />
      <path d="M11.9 11.6c2.5 0 4.4 1.7 4.4 3.8 0 1.8-1.5 3-4.4 3s-4.4-1.2-4.4-3c0-2.1 1.9-3.8 4.4-3.8Z" />
    </Frame>
  );
}

/** 隐藏：一只划掉的眼，说的是桌面上的可见性，不是内容折叠。 */
export function HideIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M3.6 12S7 6.6 12 6.6 20.4 12 20.4 12 17 17.4 12 17.4 3.6 12 3.6 12Z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="m5 19 14-14" />
    </Frame>
  );
}

/** 夜相：一弯月，与白天的太阳成一对，用在日夜切换那一挡。 */
export function MoonIcon(props: IconProps): JSX.Element {
  return (
    <Frame {...props}>
      <path d="M20 14.6A8.6 8.6 0 1 1 9.4 4a6.9 6.9 0 0 0 10.6 10.6Z" />
    </Frame>
  );
}

const ICONS: Readonly<Record<SettingsNavIcon, (props: IconProps) => JSX.Element>> = {
  play: PlayIcon,
  bot: BotIcon,
  shirt: ShirtIcon,
  activity: ActivityIcon,
  message: MessageIcon,
  puzzle: PuzzleIcon,
  shield: ShieldIcon,
  info: InfoIcon,
  panel: PanelIcon,
};

/** 外壳按父级给的语义名取图标；没给语义名就是外部页，走面板格子。 */
export function NavIcon({
  icon,
  className,
}: {
  icon?: SettingsNavIcon | undefined;
  className?: string | undefined;
}): JSX.Element {
  const Component = ICONS[icon ?? 'panel'];
  return <Component className={className} />;
}
