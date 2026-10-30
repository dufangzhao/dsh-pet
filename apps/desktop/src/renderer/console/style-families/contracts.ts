/**
 * 风格家族的契约：一个家族 = 自己那一整扇窗 + 自己那一套控件，接的是同一份 StartModel。
 *
 * board 决定这一家画哪一面：false 是 Start 视图，true 是这家的控件样板台（真实可点、可填、
 * 可禁用、可等待，不是图片）。判断与状态一律来自 use-start-model，家族不自己算一遍。
 *
 * 家族之间不共用控件：不许 import original-ui/kit 或旧 StartSlots 当作自己的板件
 * （workbench 这一家例外——它就是那一套板件本身，只在自己的候选里用）。
 */
import type { ComponentType, ReactNode } from 'react';

import type { StartModel } from '../start-designs/use-start-model.js';

export type StyleFamilyId = 'precision' | 'hearth' | 'folio' | 'prism' | 'workbench';

/**
 * 一个家族组件：整窗外壳与两种视图都在这里，评审外壳只给三样东西。
 *
 * guide 是评审外壳那一份「使用向导」动作（它才持有应用所有者与提示通道）：
 * 家族自己决定摆在哪、怎么写；没给就不画，不演一颗按得动的假按钮。
 */
export interface FamilyProps {
  readonly model: StartModel;
  readonly board: boolean;
  readonly guide?: ReactNode;
}

export interface StyleFamily {
  readonly id: StyleFamilyId;
  readonly name: string;
  /** 这一家看起来为什么不一样：给评审选择器与说明行用。 */
  readonly description: string;
  /** null = 还没交付：选择器列出并禁用，理由写在 title 上，不画空壳顶名额。 */
  readonly Component: ComponentType<FamilyProps> | null;
}
