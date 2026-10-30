/**
 * Workbench 饲养台：现在这一套板件本身，作为第五个候选，摆成**一整扇窗**。
 *
 * 这一家就是 original-ui 那套板扣、缺口、铭牌字段与方销的主人，所以只有它允许复用
 * start-designs/sections.tsx 里那五个接好线的控件与那一份样板台；另外四家各画自己的控件，
 * 谁也不许引这里。评审入口不再替它套侧栏：标题板、状态栏、正文、页脚都在这一个文件里自己画。
 *
 * 状态与动作全部来自传进来的那一份 model：同一条模型连接、同一个录音会话、同一份偏好、
 * 同一条配色记录，这里不建第二个持有者。
 */
import type { JSX } from 'react';

import { OriginalControlBoard } from '../original-ui/control-board.js';
import { Status, Toggle } from '../original-ui/kit.js';
import { StartSection, startSlotsOf } from '../start-designs/sections.js';

import type { FamilyProps, StyleFamily } from './contracts.js';

import './workbench.css';

const PHASE_TONE: Readonly<Record<string, 'ok' | 'warn' | 'off'>> = {
  'in-use': 'ok',
  'in-use-paused': 'warn',
};

function WorkbenchFamily({ model, board, guide }: FamilyProps): JSX.Element {
  // 一次组装：与日常入口、排法对照用的是同一批接好线的控件，同一份回执。
  const slots = startSlotsOf(model);
  const tone = PHASE_TONE[model.phase] ?? 'off';

  return (
    <div
      className="wb"
      data-testid="workbench-window"
      data-family="workbench"
      data-view={board ? 'board' : 'start'}
    >
      <header className="wb__bar">
        <span className="wb__nameplate">桌宠 · 饲养台</span>
        <Status tone={tone}>{model.snapshotLabel ?? '还没有在用连接'}</Status>
        {model.paused ? <Status tone="warn">回应已暂停</Status> : null}
        <span className="wb__fill" aria-hidden="true" />
        <span className="wb__view">{board ? '控件与状态' : 'Start'}</span>
      </header>

      <div className="wb__body">
        <aside className="wb__rail" aria-label="这一家此刻的样子">
          <p className="wb__rail-title">桌面</p>
          <Status tone={model.desktop.mark === 'on' ? 'on' : 'off'}>{model.desktop.text}</Status>
          <Toggle
            label="暂时不回应"
            pressed={model.paused}
            disabled={model.busy.pausing}
            data-testid="pet-pause"
            onChange={model.togglePaused}
          />
          <div className="wb__rail-actions">
            <button
              type="button"
              className="wb__plate"
              disabled={!model.desktopShown || model.busy.visibility}
              data-testid="pet-hide"
              onClick={() => model.setDesktopVisible(false)}
            >
              在桌面隐藏
            </button>
            <button
              type="button"
              className="wb__plate"
              disabled={model.desktopShown || model.busy.visibility}
              data-testid="pet-show"
              onClick={() => model.setDesktopVisible(true)}
            >
              在桌面显示
            </button>
          </div>
          {guide ?? null}
          <p className="wb__rail-note">
            板扣按下去落到板底那道搁置上；铭牌压着字段上沿；方销只标「就是这一家」。
          </p>
        </aside>

        <main className="wb__main">
          {board ? (
            <OriginalControlBoard />
          ) : (
            <>
              <StartSection
                className="wb__inspector"
                title="接线"
                note="这一栏只改这台机器上的模型连接。"
                status={slots.status}
              >
                {slots.provider}
                {slots.connect}
              </StartSection>
              <StartSection
                className="wb__stage"
                title="桌宠"
                note="说话、录音、日夜与拖动都接到这台机器上。"
              >
                {slots.pet}
              </StartSection>
              <StartSection
                className="wb__colors"
                title="界面配色"
                note="浅色与黑夜各存一份；离开这一段就撤掉没保存的试色。"
              >
                {slots.theme}
              </StartSection>
            </>
          )}
        </main>
      </div>

      <footer className="wb__foot">
        <span data-testid="workbench-notice">{model.notice ?? '宿主本轮没有别的话要说。'}</span>
        <span className="wb__fill" aria-hidden="true" />
        <span data-testid="workbench-phase">{model.phase}</span>
      </footer>
    </div>
  );
}

export const WORKBENCH_FAMILY: StyleFamily = {
  id: 'workbench',
  name: 'Workbench 饲养台',
  description:
    '现在这一套：压纹板扣与缺口、铭牌字段、方销选择、板面工作台密度——整窗版，其余四家的对照。',
  Component: WorkbenchFamily,
};
