/**
 * 设置台导航的线性图标：24 单位一格，一律 1.6 线宽、currentColor、圆端点。
 *
 * 图标只补一件事——折叠到 72px 那一栏时导航仍然认得出是哪一页；含义始终由文字承担，
 * 所以这里不画彩色、不带品牌形状，外部页面给不出对应语义时用统一的 panel 格子。
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
