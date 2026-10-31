/**
 * 开始页的入口：把设置台唯一的几个所有者接成一页的状态与动作，再交给排法。
 *
 * 普通入口与评审用的五种排法读同一份 model、同一批控件：模型连接、录音会话、应用偏好与
 * 配色工作室各只有一个所有者，草稿住在 model 里，所以换排法、开合源码对照板都不丢正在输入的
 * 模型名与 Key，也不重开麦克风、不重播轮询。
 *
 * 未打包的 --start-design-lab 实例（主进程挂了 petDesignLab 标记）才看评审入口；
 * 正常入口永远走基线，用户资料与 URL 都不变。源码对照板也挂在这条评审路上：
 * 它是「网站原件 vs 本机集成件」的对账处，不是给日常用户的一屏。
 */
import { useMemo, useState, type JSX } from 'react';

import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';
import type { ModelConnectionState } from '../use-model-connection.js';
import { StartGuideAction, startSlotsOf } from '../start-designs/sections.js';
import { MinimalStart } from '../minimal-ui/start.js';
import { MinimalThemeStudio } from '../minimal-ui/theme-studio.js';
import { useStartModel } from '../start-designs/use-start-model.js';
import { StartDesignLab } from '../start-designs/lab.js';
import { SourceBoard, SOURCE_BOARD_SELECTORS } from '../site-ui/source-board.js';
import { SourceSurface } from '../site-ui/source-surface.js';
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
  /* 状态与动作在这一层，板块的开关在它下面：切到对照板再回来，草稿与回执都还在。 */
  const model = useStartModel(owners);
  const context = useMemo<StartContext>(() => ({ ...owners, model }), [owners, model]);
  const [sourceBoard, setSourceBoard] = useState(false);

  if (sourceBoard) {
    return <SourceBoard onBack={() => setSourceBoard(false)} />;
  }

  const lab = designLabEnabled();
  if (!lab) return <MinimalStart model={model} themeStudio={<MinimalThemeStudio />} />;
  return (
    /* 归属容器包整屏：六个 token 从这一层往下走，Start 里每一块源件都按同一份归属显示。 */
    <SourceSurface>
      {lab ? (
        <p className="sc-sourcelink">
          <button
            type="button"
            className="sc-sourcelink__button"
            data-testid={SOURCE_BOARD_SELECTORS.open}
            onClick={() => setSourceBoard(true)}
          >
            源码对照板
          </button>
          <span className="sc-sourcelink__note">
            网站原件与本机集成件并排：按钮、输入栏、开关各一对，另有 17 枚 vendored 字形。
          </span>
        </p>
      ) : null}
      {lab ? (
        <StartDesignLab context={context} designs={START_DESIGNS} onOpenStyles={onOpenStyles} />
      ) : (
        <>{BASELINE_START_DESIGN.render(context, startSlotsOf(model))}</>
      )}
    </SourceSurface>
  );
}

/**
 * 标题行右边那颗「使用向导」：正文里不再画第二颗。
 * 实现只有一份（start-designs/sections.tsx），引导动作在桌宠那边，这里不演本地引导。
 */
export { StartGuideAction };
