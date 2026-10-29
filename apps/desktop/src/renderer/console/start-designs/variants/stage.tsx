/**
 * stage「桌宠在场」：先看见它，再把接线与配色放到下面两段抽屉里。
 *
 * 状态条常驻：在用的那一家与「测试连接」不必开抽屉就能看见、能按。
 * 排法不变，控件全是新的：Status / Disclosure / 插槽都来自 start-designs 与 kit。
 */
import { useState, type JSX } from 'react';

import { Disclosure, Status } from '../../original-ui/kit.js';
import { START_DESIGN_METAS } from '../catalog.js';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';

import './stage.css';

type TrayId = 'connect' | 'theme';

/**
 * 一次开合事件之后 tray 该是什么：开就是它，关只有"关的正是当前那段"才清空。
 *
 * 两段共用一个互斥状态：点开配色时，接线那段的 open 属性被改成 false，原生 details
 * 会跟着发一次 toggle(false)。无条件清空会把刚打开的配色又关掉，两段一起闭、工作室根本不挂载。
 */
export function stageTrayState(current: TrayId | null, id: TrayId, next: boolean): TrayId | null {
  if (next) {
    return id;
  }
  return current === id ? null : current;
}

const TRAY_LABELS: Readonly<Record<TrayId, string>> = {
  connect: '连接模型',
  theme: '界面配色',
};

/**
 * 首帧就读到「这台机器还没在用任何一个端点」时把接线那段开着——
 * 这时候第一眼看见宠物没有意义；已经在用了就什么都不替用户点开。
 */
function initialTray(context: StartContext): TrayId | null {
  return context.model.snapshotLabel === null ? 'connect' : null;
}

export const STAGE_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.stage,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <StageSurface context={context} slots={slots} />;
  },
};

function StageSurface({
  context,
  slots,
}: {
  context: StartContext;
  slots: StartSlots;
}): JSX.Element {
  const [tray, setTray] = useState<TrayId | null>(() => initialTray(context));
  const setTrayState = (id: TrayId, next: boolean): void =>
    setTray((current) => stageTrayState(current, id, next));
  const model = context.model;

  return (
    <section className="sd-stage" data-testid="stage-layout">
      <header className="sd-stage__head">
        <h2 className="sd-stage__title">我的桌宠</h2>
        <Status tone={model.desktop.mark === 'on' ? 'on' : 'off'}>{model.desktop.text}</Status>
      </header>

      <div className="sd-stage__pet">{slots.pet}</div>
      <div className="sd-stage__status">{slots.status}</div>

      <div className="sd-stage__dock">
        <Disclosure
          className="sd-stage__tray"
          label={TRAY_LABELS.connect}
          hint="挑一家、填 Key、测一次"
          open={tray === 'connect'}
          onOpenChange={(next) => setTrayState('connect', next)}
        >
          {slots.provider}
          {slots.connect}
        </Disclosure>

        <Disclosure
          className="sd-stage__tray"
          label={TRAY_LABELS.theme}
          hint="浅色与黑夜各存一份"
          open={tray === 'theme'}
          onOpenChange={(next) => setTrayState('theme', next)}
        >
          {tray === 'theme' ? slots.theme : null}
        </Disclosure>
      </div>
    </section>
  );
}
