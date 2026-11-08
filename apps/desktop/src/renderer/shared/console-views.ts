/**
 * 共享组合的设置台导航：四页日常 + 三个恢复入口。
 *
 * 这是**当前组合**的页面清单，不是宿主给的页面清单：共享阶段只有这四个真实视图，
 * 扩展自己的配置仍从插件页进入。旧的设计实验（start-designs / style-families）
 * 保留在仓库里但不再挂载，它们用自己那份更宽的 AppView 类型。
 */
import type { SettingsNavIcon } from '../console/icons.js';
import type { SettingsNavItem } from '../console/settings-shell.js';

export type ConsoleView = 'start' | 'conversation' | 'persona' | 'appearance';

/** 日常入口；顺序就是侧栏顺序。 */
export const CONSOLE_VIEWS: readonly { id: ConsoleView; label: string }[] = [
  { id: 'start', label: '开始' },
  { id: 'conversation', label: '对话' },
  { id: 'persona', label: '人格' },
  { id: 'appearance', label: '外观' },
];

export const CONSOLE_VIEW_SUMMARY: Readonly<Record<ConsoleView, string>> = {
  // 开始页没有整页说明：要用户判断的那句话在「连接服务」那一节里，只写一次。
  start: '',
  conversation: '和同一个助手说过的话、它做过的事，都在这一条时间线上。',
  persona: '服务里的助手是谁；以及这台机器上它怎么说话。',
  appearance: '桌面上的样子：形态、配色、大小和是否显示。',
};

const VIEW_ICON: Readonly<Record<ConsoleView, SettingsNavIcon>> = {
  start: 'play',
  persona: 'bot',
  appearance: 'shirt',
  conversation: 'message',
};

export function consoleNavItems(): SettingsNavItem[] {
  return CONSOLE_VIEWS.map((item) => ({
    id: item.id,
    label: item.label,
    icon: VIEW_ICON[item.id],
  }));
}

export function isConsoleView(value: string): value is ConsoleView {
  return CONSOLE_VIEWS.some((item) => item.id === value);
}
