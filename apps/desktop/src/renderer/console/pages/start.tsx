/**
 * 开始页的入口：把设置台唯一的几个所有者接成一页的状态与动作，再交给排法。
 *
 * 普通入口与评审用的五种排法读同一份 model、同一批新控件：模型连接、录音会话、应用偏好与
 * 配色工作室各只有一个所有者，草稿住在 model 里，所以换排法不丢正在输入的模型名与 Key，
 * 也不重开麦克风、不重播轮询。
 *
 * 未打包的 --start-design-lab 实例（主进程挂了 petDesignLab 标记）才看评审入口；
 * 正常入口永远走基线，用户资料与 URL 都不变。
 */
import { useMemo, type JSX } from 'react';

import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import type { ModelConnectionState } from '../use-model-connection.js';
import { StartGuideAction, startSlotsOf } from '../start-designs/sections.js';
import { useStartModel } from '../start-designs/use-start-model.js';
import { StartDesignLab } from '../start-designs/lab.js';
import {
  BASELINE_START_DESIGN,
  designLabEnabled,
  START_DESIGNS,
} from '../start-designs/registry.js';

import type { StartContext } from '../start-designs/contracts.js';
import type { StartOwners } from '../start-designs/use-start-model.js';

import './start.css';

export interface StartPageProps extends StartOwners {
  app: ApplicationState;
  demo: DemoState;
  models: ModelConnectionState;
  /** 评审实例里回到「整窗风格家族」的那条路；正常入口没有这一条。 */
  onOpenStyles?: (() => void) | undefined;
}

export function StartPage({ onOpenStyles, ...props }: StartPageProps): JSX.Element {
  const owners: StartOwners = {
    app: props.app,
    demo: props.demo,
    models: props.models,
    notify: props.notify,
    goToView: props.goToView,
    onOpenPlugins: props.onOpenPlugins,
  };
  const model = useStartModel(owners);
  const context = useMemo<StartContext>(() => ({ ...owners, model }), [owners, model]);

  return designLabEnabled() ? (
    <StartDesignLab context={context} designs={START_DESIGNS} onOpenStyles={onOpenStyles} />
  ) : (
    <>{BASELINE_START_DESIGN.render(context, startSlotsOf(model))}</>
  );
}

/**
 * 标题行右边那颗「使用向导」：正文里不再画第二颗。
 * 实现只有一份（start-designs/sections.tsx），引导动作在桌宠那边，这里不演本地引导。
 */
export { StartGuideAction };
