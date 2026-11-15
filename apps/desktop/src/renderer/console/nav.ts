/**
 * 设置台日常入口：按「连接 / 助手 / 插件」三组排列。
 *
 * 分组是侧栏唯一的层级；恢复入口仍由 RECOVERY_ITEMS 提供并落在底部。
 * 这里只管页面清单与文案，不认识具体页面组件。
 *
 * 本机 QQ 接入不是独立页：它是 QQ 页里的第二张 Card（见 pages/qq.tsx）。
 * 语音拆成输入（ASR）与输出（TTS）两页，各自回答一件事。
 */
import type { SettingsNavIcon } from './icons.js';
import type { SettingsNavItem } from './settings-shell.js';

export type ConsoleView =
  'start' | 'conversation' | 'persona' | 'appearance' | 'pet' | 'model' | 'qq' | 'asr' | 'tts';

export interface ConsoleNavGroup {
  readonly id: 'main' | 'assistant' | 'plugins';
  readonly label: string;
}

export const CONSOLE_NAV_GROUPS: readonly ConsoleNavGroup[] = [
  { id: 'main', label: '连接' },
  { id: 'assistant', label: '助手' },
  { id: 'plugins', label: '插件' },
];

const VIEW_ICON: Readonly<Record<ConsoleView, SettingsNavIcon>> = {
  start: 'connect',
  conversation: 'chat',
  persona: 'bot',
  appearance: 'shirt',
  pet: 'cat',
  model: 'model',
  qq: 'qq',
  asr: 'microphone',
  tts: 'volume',
};

export const CONSOLE_VIEWS: readonly {
  id: ConsoleView;
  label: string;
  group: ConsoleNavGroup['id'];
}[] = [
  { id: 'start', label: '开始', group: 'main' },
  { id: 'conversation', label: '对话', group: 'main' },
  { id: 'persona', label: '人格', group: 'assistant' },
  { id: 'appearance', label: '外观', group: 'assistant' },
  { id: 'pet', label: '桌宠', group: 'assistant' },
  { id: 'model', label: '模型', group: 'plugins' },
  { id: 'qq', label: 'QQ', group: 'plugins' },
  { id: 'asr', label: '语音输入', group: 'plugins' },
  { id: 'tts', label: '语音输出', group: 'plugins' },
];

export const CONSOLE_VIEW_SUMMARY: Readonly<Record<ConsoleView, string>> = {
  // 开始页只说连接；令牌与地址的事实都在卡里。
  start: '',
  conversation: '和同一个助手说过的话、它做过的事，都在这一条时间线上。',
  persona: '服务里的助手是谁，以及这台机器上它怎么说话。',
  appearance: '桌面上的样子：形态、配色、大小和是否显示。',
  pet: '桌宠在这台机器上的显示与交互。',
  model: '服务里的模型连接与当前回复来源。',
  qq: '服务里的 QQ 通道，以及这台机器上接入的 QQ 客户端。',
  asr: '你说的话怎么变成文字。',
  tts: '回复怎么变成声音。',
};

/**
 * 旧深链到新入口的映射。
 *
 * `SettingsDestination`（packages/contracts/src/console.ts）只有 voice 这一格，
 * 而语音现在拆成输入与输出两页：深链进语音一律落在「语音输入」，
 * 另一页从侧栏一步可达。原 local-host 页已并入 QQ，不再有对应入口。
 */
const DEEP_LINK: Readonly<Record<string, ConsoleView>> = {
  voice: 'asr',
  'local-host': 'qq',
};

export function consoleNavItems(): SettingsNavItem[] {
  return CONSOLE_VIEWS.map((item) => ({
    id: item.id,
    label: item.label,
    icon: VIEW_ICON[item.id],
    group: item.group,
  }));
}

export function consoleViewLabel(view: ConsoleView): string {
  return CONSOLE_VIEWS.find((item) => item.id === view)?.label ?? view;
}

export function isConsoleView(value: string): value is ConsoleView {
  return CONSOLE_VIEWS.some((item) => item.id === value);
}

/** 把外部给的入口名落到当前存在的页；不认识的返回 null，由调用方决定去哪。 */
export function resolveConsoleView(value: string): ConsoleView | null {
  if (isConsoleView(value)) return value;
  return DEEP_LINK[value] ?? null;
}
