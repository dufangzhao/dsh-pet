/**
 * 桌宠在场：先看见这一只，再接线与配色放在它下面的两层里。
 *
 * 舞台画的是设置台里那一个真实 PetPreview——说话、录音、日夜、菜单、拖动都在它自己身上，
 * 这一版只决定它占多大：400px 起步，内容多了往下长，窗口矮了让到 260px（预览本来的下限）。
 * 状态条与抽屉都在舞台下方的文档流里，气泡因此不会被 dock 或托盘盖住。
 *
 * 抽屉一次只开一个，关掉就是卸载：配色那份离开时按它自己的规则撤掉未保存的试色。
 * 模型草稿与上一条回执不住在这里——它们在 StartContext 与插槽的所有者手里，
 * 所以合上再打开不会抹掉正在输入的模型名，也不会假装测试没做过。
 * 「使用向导」由外壳标题行给（console-app 那一颗），这里不画第二颗，插槽 guide 不使用。
 */
import { useState, type JSX } from 'react';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';
import { START_DESIGN_METAS } from '../catalog.js';
import { LabIcon, LAB_GLYPHS } from '../lab-icons.js';
import { petDesktopState } from '../sections.js';

import './stage.css';

/** 两层抽屉：接线与配色。它们是同一句「再多看一眼」的两个方向，不同时开。 */
type TrayId = 'connect' | 'theme';

const TRAY_LABELS: Readonly<Record<TrayId, string>> = {
  connect: '连接模型',
  theme: '界面配色',
};

/**
 * 首帧就读到「这台机器还没在用任何一个端点」时把接线抽屉开着——
 * 这时候第一眼看见宠物没有意义；已经在用了就什么都不替用户点开。
 */
function initialTray(context: StartContext): TrayId | null {
  return context.models.snapshot?.active === null ? 'connect' : null;
}

function StageSurface({
  context,
  slots,
}: {
  context: StartContext;
  slots: StartSlots;
}): JSX.Element {
  const [tray, setTray] = useState<TrayId | null>(() => initialTray(context));
  const desk = petDesktopState(context.app);
  // 减少动画有两层：应用里那一项让图标直接跳到位，系统偏好交给 CSS 那侧（见 stage.css）。
  const motionReduced = context.app.values?.reducedMotion ?? false;

  const toggle = (next: TrayId): void => {
    setTray(next === tray ? null : next);
  };

  return (
    <section className="sd-stage" data-testid="stage-layout">
      <header className="sd-stage__head">
        <h2 className="sd-stage__title">我的桌宠</h2>
        {/* 桌面在不在只报宿主说的那一句；睁眼/闭眼是五个版式共用的形状，含义仍然写在字上。 */}
        <span className="sd-stage__presence" data-tone={desk.tone}>
          <LabIcon
            glyph={LAB_GLYPHS.desktop}
            active={desk.tone !== 'on'}
            motionReduced={motionReduced}
            size={16}
          />
          {desk.text}
        </span>
      </header>

      <div className="sd-stage__pet">{slots.pet}</div>

      {/* 状态条常驻：在用的那一家与「测试连接」不必开抽屉就能看见、能按。 */}
      <div className="sd-stage__status">{slots.status}</div>

      <div className="sd-stage__dock" role="group" aria-label="开始页的另外两件事">
        {(['connect', 'theme'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={id === tray ? 'sd-stage__dock-item is-open' : 'sd-stage__dock-item'}
            aria-expanded={id === tray}
            aria-controls={id === tray ? 'sd-stage-tray-' + id : undefined}
            data-testid={'stage-tray-' + id}
            onClick={() => toggle(id)}
          >
            <span className="sd-stage__dock-label">{TRAY_LABELS[id]}</span>
            <span className="sd-stage__dock-caret" aria-hidden="true" />
          </button>
        ))}
      </div>

      {tray === 'connect' ? (
        <div className="sd-stage__tray" id="sd-stage-tray-connect">
          {slots.vendors}
          {slots.connect}
        </div>
      ) : null}

      {tray === 'theme' ? (
        <div className="sd-stage__tray" id="sd-stage-tray-theme">
          {slots.theme}
        </div>
      ) : null}
    </section>
  );
}

/** 版式本体：render 不是组件，有状态的绘制交给下面这一个函数组件。 */
export const STAGE_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.stage,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <StageSurface context={context} slots={slots} />;
  },
};
