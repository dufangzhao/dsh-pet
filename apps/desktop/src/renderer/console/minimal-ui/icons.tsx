/**
 * 极简设置台自己的图标：24 格线性 SVG，线宽 2，默认 18px。
 *
 * 只画界面里真在用的动作与页面。图形是装饰，名称由按钮的 aria-label/title
 * 或旁边文字承担；需要独立读出的位置才传 label。
 */
import type { JSX, ReactNode } from 'react';

export type IconName =
  | 'sliders'
  | 'plug'
  | 'unplug'
  | 'refresh'
  | 'power'
  | 'stop'
  | 'external-link'
  | 'eye'
  | 'eye-off'
  | 'key'
  | 'check'
  | 'x'
  | 'chevron-left'
  | 'server'
  | 'model'
  | 'qq'
  | 'chat'
  | 'cat'
  | 'microphone'
  | 'volume'
  | 'puzzle'
  | 'sun'
  | 'moon';

const GLYPHS: Readonly<Record<IconName, ReactNode>> = {
  sliders: (
    <>
      <path d="M4 6h9" />
      <path d="M17 6h3" />
      <circle cx="15" cy="6" r="2" />
      <path d="M4 12h3" />
      <path d="M11 12h9" />
      <circle cx="9" cy="12" r="2" />
      <path d="M4 18h11" />
      <path d="M19 18h1" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v4" />
      <path d="M15 3v4" />
      <path d="M7 7h10v4a5 5 0 0 1-10 0V7Z" />
      <path d="M12 16v5" />
    </>
  ),
  unplug: (
    <>
      <path d="M9 3v4" />
      <path d="M15 3v4" />
      <path d="M7 7h10v4a5 5 0 0 1-9.4 1.5" />
      <path d="M12 16v5" />
      <path d="m3 3 18 18" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.3" />
      <path d="M21 3v6h-6" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3" />
      <path d="M3 21v-6h6" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.2 6.2a8 8 0 1 0 11.6 0" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  'external-link': (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M10.7 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.2 2.8" />
      <path d="M6.2 6.5A15 15 0 0 0 2.5 12S6 18 12 18c1.3 0 2.5-.2 3.6-.6" />
      <path d="m3 3 18 18" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8" />
      <path d="m17 4 3 3" />
      <path d="m15 6 2 2" />
    </>
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
  x: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  model: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  qq: (
    <>
      <path d="M14 8.5A6.5 6.5 0 0 0 7.5 2 6.5 6.5 0 0 0 1 8.5c0 1.7.7 3.3 1.8 4.5L2 17l4-1.6c.5.1 1 .1 1.5.1" />
      <path d="M23 15.5a6.5 6.5 0 0 1-6.5 6.5c-.7 0-1.4-.1-2-.3L10 23l.6-3.1A6.5 6.5 0 0 1 16.5 9 6.5 6.5 0 0 1 23 15.5Z" />
    </>
  ),
  chat: (
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H8l-4 3v-6.2A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z" />
  ),
  cat: (
    <>
      <path d="M5.6 10 6.6 5.2l3.3 2.4h4.2l3.3-2.4 1 4.8a6.6 6.6 0 0 1 0 6.4c-1.5 1.9-3.6 2.9-6.4 2.9s-4.9-1-6.4-2.9a6.6 6.6 0 0 1 0-6.4Z" />
      <path d="M9.6 12.4h.01M14.4 12.4h.01" />
      <path d="M12 14.6v1.3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  // 语音输入：一支话筒，说的是「收声音」，不是播放键。
  microphone: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </>
  ),
  // 语音输出：一支扬声器加两道声波。
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  puzzle: (
    <path d="M10 4.5a2 2 0 1 1 4 0V6h3a1.5 1.5 0 0 1 1.5 1.5v3H17a2 2 0 1 0 0 4h1.5v3A1.5 1.5 0 0 1 17 19h-3v-1.5a2 2 0 1 0-4 0V19H7a1.5 1.5 0 0 1-1.5-1.5v-3H7a2 2 0 1 0 0-4H5.5v-3A1.5 1.5 0 0 1 7 6h3Z" />
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />,
};

export interface IconProps {
  name: IconName;
  size?: number | undefined;
  className?: string | undefined;
  /** 图形本身需要被读出的地方（例如纯图标状态）；按钮内不传。 */
  label?: string | undefined;
}

export function Icon({ name, size = 18, className, label }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label === undefined
        ? { 'aria-hidden': true as const }
        : { role: 'img' as const, 'aria-label': label })}
    >
      {GLYPHS[name]}
    </svg>
  );
}
