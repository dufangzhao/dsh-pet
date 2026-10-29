/**
 * 六种 Start 排法共用的契约：状态与动作从上面给，版式只决定怎么摆。
 *
 * 上一版的缺陷在"接缝"上：插槽带着旧控件已经渲染好的 JSX，五种排法于是继承了同一套
 * 被否掉的复制品。现在插槽里的每一块都是 start-designs/sections.tsx 自己画的新控件，
 * 判断与状态来自 use-start-model，版式拿到的只是摆放权。
 */
import type { JSX } from 'react';

import type { StartModel, StartOwners } from './use-start-model.js';

/** baseline 是普通入口看到的那三节；其余五种是评审用的排法。 */
export type StartDesignId = 'baseline' | 'bench' | 'switchboard' | 'spine' | 'stage' | 'workspaces';

/** 版式的作者名与一句话取舍，出现在评审选择器上。 */
export interface StartDesignMeta {
  id: StartDesignId;
  name: string;
  /** 这个排法主要服务哪种使用情景。 */
  intent: string;
  /** 它换掉了什么、代价是什么。 */
  tradeoff: string;
}

/** 组装一个版式需要的东西：所有者（唯一的那几个）与这一页的状态与动作。 */
export interface StartContext extends StartOwners {
  readonly model: StartModel;
}

/**
 * 接好线的新控件。每块在一次渲染里只应出现一份——两份会得到第二个输入框与第二份草稿焦点。
 *
 * status  在用的那一家 / 还没在用，加上宿主本轮那句话。
 * provider 服务目录：搜索、井格与一行一家两种读法、在用与挑了未保存分得开。
 * connect  这一家的接线：模型名、Key、保存并开始、测试连接、登录、回执。
 * pet      预览与桌面动作（隐藏/显示/装扮、暂时不回应）。
 * theme    配色工作室（自带保存/撤销/试色清理）。
 */
export interface StartSlots {
  readonly status: JSX.Element;
  readonly provider: JSX.Element;
  readonly connect: JSX.Element;
  readonly pet: JSX.Element;
  readonly theme: JSX.Element;
}

/** 一个排法：给定上下文与插槽，画出这一版的信息层级。 */
export interface StartDesign {
  readonly meta: StartDesignMeta;
  render(context: StartContext, slots: StartSlots): JSX.Element;
}
