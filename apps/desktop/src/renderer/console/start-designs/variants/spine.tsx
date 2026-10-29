/**
 * spine「从连接到见面」：三段可重开的抽屉，按新手顺序读下去。
 *
 * 三段都用 kit 的 Disclosure（原生 details），灯与一句话都在标题行；
 * 配色那段关了就把内容卸掉——工作室卸载时撤掉没保存的试色，这一段与"离开这一页"同一套规则。
 * 内容只是收起，不重新读状态：模型与预览的草稿仍在同一份 model 上。
 */
import { useState, type JSX } from 'react';

import { Disclosure, Status } from '../../original-ui/kit.js';
import { START_DESIGN_METAS } from '../catalog.js';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';

import './spine.css';

type StepId = 'connect' | 'pet' | 'theme';

export const SPINE_DEFAULT_STEPS: Record<StepId, boolean> = {
  connect: true,
  pet: true,
  theme: false,
};

/**
 * 一次开合事件之后该是什么状态：照原生 details 报上来的值写，不自己取反。
 *
 * 原生 <details open> 挂载时也会发一次 toggle，盲翻转会把"默认展开"那段翻成关闭，
 * 来回两次就更不知道用户在哪个状态上。定值只认事件说的那一句。
 */
export function spineStepState(
  now: Readonly<Record<StepId, boolean>>,
  id: StepId,
  open: boolean,
): Record<StepId, boolean> {
  return { ...now, [id]: open };
}

export const SPINE_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.spine,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <Spine context={context} slots={slots} />;
  },
};

function Spine({ context, slots }: { context: StartContext; slots: StartSlots }): JSX.Element {
  const [open, setOpen] = useState<Record<StepId, boolean>>({ ...SPINE_DEFAULT_STEPS });
  const setStep = (id: StepId, next: boolean): void =>
    setOpen((now) => spineStepState(now, id, next));
  const model = context.model;
  const connected = model.snapshotLabel !== null;

  return (
    <ol className="sd-spine" data-testid="spine-steps">
      <li className="sd-spine__step" data-step="connect">
        <Disclosure
          label="一、接上模型"
          hint={connected ? '已经接上，可以说话' : '没接也能先用离线演示'}
          open={open.connect}
          onOpenChange={(next) => setStep('connect', next)}
        >
          {slots.status}
          {slots.provider}
          {slots.connect}
        </Disclosure>
      </li>

      <li className="sd-spine__step" data-step="pet">
        <Disclosure
          label="二、到见面"
          hint={model.desktopShown ? '就在桌面上' : '展开看看这一只'}
          open={open.pet}
          onOpenChange={(next) => setStep('pet', next)}
        >
          <Status tone={model.desktop.mark === 'on' ? 'on' : 'off'}>{model.desktop.text}</Status>
          {slots.pet}
        </Disclosure>
      </li>

      <li className="sd-spine__step" data-step="theme">
        <Disclosure
          label="三、调颜色"
          hint="浅色与黑夜各存一份"
          open={open.theme}
          onOpenChange={(next) => setStep('theme', next)}
        >
          {/* 收起 = 卸载：试色跟着撤掉，不留一份没保存的配色挂在整个设置台上。 */}
          {open.theme ? slots.theme : null}
        </Disclosure>
      </li>
    </ol>
  );
}
