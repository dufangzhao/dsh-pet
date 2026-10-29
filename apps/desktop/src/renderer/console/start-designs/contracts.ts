/**
 * 五种 Start 版式共用的契约：状态从上面给，版式只决定怎么摆。
 *
 * 一个 StartContext 由设置台唯一的几个所有者（应用、录音会话、模型连接、提示）组装，
 * 版式作者拿到的是同一份真实状态与同一批动作；插槽（StartSlots）是已经接好线的片段，
 * 版式负责摆放它们，不再各写一份模型表单、登录轮询或录音入口。
 *
 * 草稿（选了哪家、模型名、Key、菜单开合）住在 StartContext.draft 里而不是版式内部：
 * 换版式不能把正在输入的东西弄丢，Key 只活在这一个内存状态里，不写存储、不进日志。
 */
import type { JSX } from 'react';

import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import type { ModelConnectionState } from '../use-model-connection.js';
import type { AppView } from '../app-views.js';

/** baseline 是已验证的复刻版式，也是普通入口看到的那一页；其余五种是本轮要出的方案。 */
export type StartDesignId = 'baseline' | 'bench' | 'switchboard' | 'spine' | 'stage' | 'workspaces';

/** 版式的作者名与一句话取舍，出现在评审选择器上。 */
export interface StartDesignMeta {
  id: StartDesignId;
  name: string;
  /** 这个版式主要服务哪种使用情景。 */
  intent: string;
  /** 它换掉了什么、代价是什么。 */
  tradeoff: string;
}

/** 跨版式保留的输入草稿。key 只在内存里，保存成功即清空。 */
export interface StartDraft {
  readonly pickedId: string | null;
  readonly model: string;
  readonly key: string;
  readonly chatOpen: boolean;
  setPickedId(id: string): void;
  setModel(value: string): void;
  setKey(value: string): void;
  setChatOpen(open: boolean): void;
  /** 换了一家：模型名与 Key 归到那一家的该有值，其他草稿不动。 */
  resetForEndpoint(id: string, model: string): void;
}

export type Notify = (message: string, tone: 'ok' | 'danger') => void;

/** 组装好的上下文：状态、草稿与跳转。版式与插槽都只认这一个入口。 */
export interface StartContext {
  readonly app: ApplicationState;
  readonly demo: DemoState;
  readonly models: ModelConnectionState;
  readonly draft: StartDraft;
  readonly notify: Notify;
  readonly goToView: (view: AppView) => void;
  /** 「管理模型扩展」：模型目录由扩展提供，只跳这个真实入口。 */
  readonly onOpenPlugins: () => void;
}

/**
 * 接好线的片段。版式按自己的信息层级摆放它们；
 * 一个片段在这一次渲染里只应出现一份（同一个表单实例），不要复制再拼一遍。
 */
export interface StartSlots {
  /** 「已连接 / 未连接 / 已保存未测 / 暂停」这类真实状态的一句话与徽标。 */
  readonly status: JSX.Element;
  /** 厂商芯片（15 家分组）与平台切换。 */
  readonly vendors: JSX.Element;
  /** 模型、Key、保存并开始、测试连接、申请 Key、登录与取消：唯一一个真表单。 */
  readonly connect: JSX.Element;
  /** 我的桌宠：预览（含说话/录音/日夜/菜单/拖动）与隐藏/显示/装扮。 */
  readonly pet: JSX.Element;
  /** 界面配色：36 token 工作室，含它自己的保存/撤销/预览行为。 */
  readonly theme: JSX.Element;
}

/**
 * 「使用向导」不在插槽里：它常年挂在页面标题右边，由外壳放那一份。
 * 插槽里再给一颗，同一屏就会出现两个 start-guide 与两次宿主调用。
 */

/** 一个版式：给定上下文与插槽，画出这一版的信息层级。 */
export interface StartDesign {
  readonly meta: StartDesignMeta;
  render(context: StartContext, slots: StartSlots): JSX.Element;
}

/** 「保存并开始」什么时候可点：草稿齐了、这家接得进来、不在写入中。 */
export function saveEnabled(options: {
  saving: boolean;
  available: boolean;
  model: string;
  key: string;
  targetIsActive: boolean;
}): boolean {
  if (options.saving || !options.available) {
    return false;
  }
  if (options.model.trim() === '') {
    return false;
  }
  // Key 留空只有在填的正是「在用的那个端点」时成立：换了一家就得给新 Key。
  return options.key.trim() !== '' || options.targetIsActive;
}

/** 测试连接只对「在用的那一个端点」有意义：草稿没保存过就不是它的测试结果。 */
export function testEnabled(hasActive: boolean, testing: boolean): boolean {
  return hasActive && !testing;
}
