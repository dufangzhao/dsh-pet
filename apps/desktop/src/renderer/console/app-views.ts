import type { ApplicationPage, ApplicationPreferences, JsonObject } from '@pet/contracts';
import { APPLICATION_PLUGIN_IDS } from '@pet/contracts';

import type { SettingsNavItem } from './settings-shell.js';
import type { ApplicationState } from './use-application.js';

/**
 * 页面来自宿主快照，不是这里的固定数组。
 *
 * 能认出五个应用视图（manifest 的 panels[].builtin，其次页面插件 id），
 * 认不出的页面走通用配置表单：外部插件加一页或撤一页，外壳不用改，
 * 也不会因为"没有对应视图"就留一张空白页。
 */
export type AppView = 'start' | 'persona' | 'appearance' | 'conversation' | 'voice' | 'generic';

const BUILTIN_VIEWS: Readonly<Record<string, AppView>> = {
  'pet.start': 'start',
  'pet.persona': 'persona',
  'pet.appearance': 'appearance',
  'pet.conversation': 'conversation',
  'pet.voice': 'voice',
};

const PAGE_PLUGIN_VIEWS: Readonly<Record<string, AppView>> = {
  [APPLICATION_PLUGIN_IDS.start]: 'start',
  [APPLICATION_PLUGIN_IDS.persona]: 'persona',
  [APPLICATION_PLUGIN_IDS.appearance]: 'appearance',
  [APPLICATION_PLUGIN_IDS.conversation]: 'conversation',
  [APPLICATION_PLUGIN_IDS.voice]: 'voice',
};

/** 恢复类入口：日常五页之外仍然可达，但不占主视线。 */
export const RECOVERY_ITEMS: readonly SettingsNavItem[] = [
  { id: 'plugins', label: '扩展', quiet: true },
  { id: 'permissions', label: '权限与数据', quiet: true },
  { id: 'about', label: '关于', quiet: true },
];

export const VIEW_SUMMARY: Readonly<Record<AppView, string>> = {
  start: '先看它现在能不能回话，再接你自己的 Key。',
  persona: '它怎么称呼你、按什么说话，以及它真正读到的那段提示词。',
  appearance: '桌面上的样子：形态、配色、大小和是否显示。',
  conversation: '和它说过的话、真实的触碰与应用提示，都记在同一条时间线里。',
  voice: '本机识别、录音，以及说完之后怎么处理。',
  generic: '这一页由扩展自己提供，改动只写进它自己的配置。',
};

/** 按 order 排序后的导航入口；顺序由宿主给，不在这里另定一份。 */
export function navItemsOf(pages: readonly ApplicationPage[]): SettingsNavItem[] {
  return [...pages]
    .sort((a, b) => a.order - b.order)
    .map((page) => ({ id: page.id, label: page.title }));
}

/**
 * 这一页对应哪个应用视图。
 *
 * manifest 的 panels[].builtin 是 Cortico 公开投影，先按它认；
 * 没有 panels 时退回页面插件 id；都不是应用视图的，交给通用配置表单。
 */
export function appViewOf(page: ApplicationPage): AppView {
  for (const builtin of panelBuiltins(page.manifest)) {
    const view = BUILTIN_VIEWS[builtin];
    if (view !== undefined) {
      return view;
    }
  }
  return PAGE_PLUGIN_VIEWS[page.owner.pluginId] ?? PAGE_PLUGIN_VIEWS[page.id] ?? 'generic';
}

function panelBuiltins(manifest: JsonObject): string[] {
  const panels = manifest['panels'];
  if (!Array.isArray(panels)) {
    return [];
  }
  const found: string[] = [];
  for (const panel of panels) {
    if (typeof panel === 'object' && panel !== null && !Array.isArray(panel)) {
      const builtin = (panel as JsonObject)['builtin'];
      if (typeof builtin === 'string') {
        found.push(builtin);
      }
    }
  }
  return found;
}

/**
 * 当前页在宿主给的入口里找得到就用它；找不到说明这一页刚刚被撤回或停用，
 * 退回扩展列表，而不是显示一张空页。selection 为 null 表示用户还没选过。
 */
export function resolveSelection(
  items: readonly SettingsNavItem[],
  selection: string | null,
): string | null {
  if (items.length === 0) {
    return null;
  }
  if (selection === null) {
    return items[0]?.id ?? null;
  }
  if (items.some((item) => item.id === selection)) {
    return selection;
  }
  return items.find((item) => item.quiet === true)?.id ?? items[0]?.id ?? null;
}

/**
 * 选择类控件点了就写：成功不弹全局提示，失败报真实原因。
 *
 * 成功的那一下已经有了回执：这一行跟着宿主返回的值变了，桌面也跟着变。
 * 再弹一条“已保存。”只会在连点形态/配色/大小时堆成一摞，把编辑器挡住。
 * 界面不保存“将要生效的值”——写失败时这一行自然回到宿主那一份。
 */
export async function saveChoice(
  app: ApplicationState,
  notify: (message: string, tone: 'ok' | 'danger') => void,
  patch: Partial<ApplicationPreferences>,
): Promise<void> {
  const outcome = await app.save(patch);
  if (!outcome.ok) {
    notify(`这个选择没有写进去：${outcome.error ?? '未知原因'}`, 'danger');
  }
}
