/**
 * spine「从连接到见面」：一条竖脊，三段可重开的展开。
 *
 * 顺序按新手真的会走的路线排：先接上模型，再确认桌面上那一只在不在，最后调颜色。
 * 但不门控也不自动推进——没接模型也能展开后两段，离线演示本来就能用；
 * 收起一段不会替用户决定下一段该开还是该关，三段各自独立。
 *
 * 内容全是共享插槽，一个都不重写：模型表单、录音入口、配色工作室都只有一份实现。
 * 展开状态是这里的呈现局部状态，换版式会回到默认，不涉及任何数据。
 */
import { useState, type JSX } from 'react';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';
import { START_DESIGN_METAS } from '../catalog.js';
import { LabIcon, LAB_GLYPHS } from '../lab-icons.js';
import { readThemeState, resolveAppearance } from '../../theme.js';

import './spine.css';

type StepId = 'connect' | 'pet' | 'theme';

/**
 * 默认展开：接模型与看桌宠开着（内容只是收起，不重新读状态），配色那段关着。
 *
 * 配色段是唯一"关了就卸掉"的一段：36 token 工作室的未保存试色在它自己卸载时撤销
 * （theme-editor.tsx 的离场清理），这一段才能和"离开这一页"同一套规则。
 */
export const SPINE_DEFAULT_STEPS: Record<StepId, boolean> = {
  connect: true,
  pet: true,
  theme: false,
};

export const SPINE_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.spine,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <Spine context={context} slots={slots} />;
  },
};

function Spine({ context, slots }: { context: StartContext; slots: StartSlots }): JSX.Element {
  const [open, setOpen] = useState<Record<StepId, boolean>>({
    connect: true,
    pet: true,
    theme: false,
  });
  const motionReduced = context.app.values?.reducedMotion ?? false;
  const desktop = context.app.snapshot?.desktop ?? null;
  const shown = desktop !== null && desktop.available && desktop.shown;
  const paused = context.models.snapshot?.paused ?? false;
  const connected = (context.models.snapshot?.active ?? null) !== null;
  /** 配色这一段的灯读的是那条真实主题记录，不是猜的。 */
  const themeNight = resolveAppearance(readThemeState().mode) === 'dark';

  const toggle = (id: StepId): void => setOpen((now) => ({ ...now, [id]: !now[id] }));

  return (
    <ol className="sd-spine" data-testid="spine-steps">
      <Step
        id="connect"
        index={1}
        title="接上模型"
        hint={connected ? '已经接上，可以说话' : '没接也能先用离线演示'}
        open={open.connect}
        onToggle={toggle}
        marker={
          <LabIcon
            glyph={LAB_GLYPHS.response}
            active={paused}
            motionReduced={motionReduced}
            label={paused ? '回应已暂停' : '正在回应'}
          />
        }
      >
        {slots.status}
        {slots.vendors}
        {slots.connect}
      </Step>

      <Step
        id="pet"
        index={2}
        title="到见面"
        hint={shown ? '就在桌面上' : '展开看看这一只'}
        open={open.pet}
        onToggle={toggle}
        marker={
          <LabIcon
            glyph={LAB_GLYPHS.desktop}
            active={!shown}
            motionReduced={motionReduced}
            label={shown ? '桌宠在桌面上' : '桌宠没在桌面上'}
          />
        }
      >
        {slots.pet}
      </Step>

      <Step
        id="theme"
        index={3}
        title="调颜色"
        hint="浅色与黑夜各存一份"
        open={open.theme}
        onToggle={toggle}
        marker={
          <LabIcon
            glyph={LAB_GLYPHS.light}
            active={themeNight}
            motionReduced={motionReduced}
            label={themeNight ? '现在是黑夜配色' : '现在是浅色配色'}
          />
        }
      >
        {/* 收起 = 卸载：试色跟着撤掉，不留一份没保存的配色挂在整个设置台上。 */}
        {open.theme ? slots.theme : null}
      </Step>
    </ol>
  );
}

interface StepProps {
  id: StepId;
  index: number;
  title: string;
  hint: string;
  open: boolean;
  onToggle: (id: StepId) => void;
  marker: JSX.Element;
  children: JSX.Element | JSX.Element[] | null;
}

/** 一段：真实按钮 + aria-expanded + 区域，不用锚点也不改 URL。 */
function Step({
  id,
  index,
  title,
  hint,
  open,
  onToggle,
  marker,
  children,
}: StepProps): JSX.Element {
  const panelId = 'sd-spine-' + id;
  return (
    <li className={open ? 'sd-step is-open' : 'sd-step'} data-step={id}>
      <div className="sd-step__head">
        <span className="sd-step__index" aria-hidden="true">
          {index}
        </span>
        <span className="sd-step__marker">{marker}</span>
        <button
          type="button"
          className="sd-step__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          data-testid={'spine-toggle-' + id}
          onClick={() => onToggle(id)}
        >
          <span className="sd-step__title">{title}</span>
          <span className="sd-step__hint">{hint}</span>
        </button>
      </div>
      <div className="sd-step__body" id={panelId} hidden={!open}>
        {children}
      </div>
    </li>
  );
}
