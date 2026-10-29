/**
 * 开始页的入口：把设置台唯一的几个所有者组装成一个 StartContext，再交给版式。
 *
 * 基线（已验证的复刻版式）与评审用的五种新方案共用同一批插槽，状态与动作都不复制：
 * 模型连接、录音会话、应用偏好与主题工作室各只有一个所有者，草稿住在 context.draft 上，
 * 所以换版式不丢正在输入的模型名与 Key，也不会重开麦克风或重播轮询。
 *
 * 未打包的 --start-design-lab 实例（主进程挂了 petDesignLab 标记）看评审入口；
 * 正常入口永远走基线，用户资料与 URL 都不变。
 */
import { useMemo, type JSX } from 'react';

import type { AppView } from '../app-views.js';
import type { ModelConnectionState } from '../use-model-connection.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import { GuideAction, useStartDraft, useStartSlots } from '../start-designs/sections.js';
import { StartDesignLab } from '../start-designs/lab.js';
import { designLabEnabled, START_DESIGNS } from '../start-designs/registry.js';
import { BASELINE_START_DESIGN } from '../start-designs/registry.js';

import type { StartContext } from '../start-designs/contracts.js';

import './start.css';

type Notify = (message: string, tone: 'ok' | 'danger') => void;

export interface StartPageProps {
  app: ApplicationState;
  demo: DemoState;
  models: ModelConnectionState;
  notify: Notify;
  goToView: (view: AppView) => void;
  /** 「管理模型扩展」：模型目录由扩展提供，这一句只跳到真实的扩展入口。 */
  onOpenPlugins: () => void;
}

export function StartPage({
  app,
  demo,
  models,
  notify,
  goToView,
  onOpenPlugins,
}: StartPageProps): JSX.Element {
  const draft = useStartDraft();
  const context = useMemo<StartContext>(
    () => ({ app, demo, models, draft, notify, goToView, onOpenPlugins }),
    [app, demo, models, draft, notify, goToView, onOpenPlugins],
  );

  return designLabEnabled() ? (
    <StartDesignLab context={context} designs={START_DESIGNS} />
  ) : (
    <BaselineStart context={context} />
  );
}

/** 基线版式：连接模型、我的桌宠、界面配色三节，普通入口看到的就是它。 */
function BaselineStart({ context }: { context: StartContext }): JSX.Element {
  const slots = useStartSlots(context);
  return BASELINE_START_DESIGN.render(context, slots);
}

/**
 * 页面标题右边的「使用向导」：由外壳放在标题行，基线版式不再在正文里画第二颗。
 * 引导只有一份实现，在桌宠那边；这里不演本地引导，也不自己藏窗口。
 */
export function StartGuideAction(props: { app: ApplicationState; notify: Notify }): JSX.Element {
  return <GuideAction {...props} />;
}
