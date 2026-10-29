/**
 * 评审入口：只在未打包的 --start-design-lab 实例里出现，正常入口走不到这里。
 *
 * 两个页签：「Start 排法」换的是摆放方式，所有者与状态一个都不换；
 * 「控件与状态」直接摆这套原创控件的真实状态，供对照与走查。
 * 页签里的样例只是控件本身，不冒充任何后台结果——真回执只在真动作之后出现。
 */
import { useState, type JSX } from 'react';

import { OriginalControlBoard } from '../original-ui/control-board.js';

import { startSlotsOf } from './sections.js';
import {
  deliveredDesignIds,
  resolveStartDesign,
  START_DESIGN_METAS,
  START_DESIGN_ORDER,
} from './registry.js';

import type { StartContext, StartDesign, StartDesignId } from './contracts.js';

import './lab.css';

type TabId = 'layouts' | 'controls';

export interface StartDesignLabProps {
  context: StartContext;
  designs: readonly StartDesign[];
  /** 评审默认先看哪一版：只是打开时落在新排法上，不是产品选择，普通入口永远走基线。 */
  initial?: StartDesignId;
}

export function StartDesignLab({
  context,
  designs,
  initial = 'bench',
}: StartDesignLabProps): JSX.Element {
  const [tab, setTab] = useState<TabId>('layouts');
  const [selected, setSelected] = useState<StartDesignId>(initial);
  const design = resolveStartDesign(designs, selected) ?? resolveStartDesign(designs, 'baseline');
  // 插槽在这里生成一次：换排法复用同一批接线与同一份回执，不重新读状态。
  const slots = startSlotsOf(context.model);
  const delivered = deliveredDesignIds(designs).filter((id) => id !== 'baseline');
  const missing = START_DESIGN_ORDER.length - 1 - delivered.length;

  return (
    <div className="lab" data-testid="start-design-lab">
      <div className="lab__tabs pb-choice" role="radiogroup" aria-label="评审入口的两个页签">
        {(
          [
            { id: 'layouts', label: 'Start 排法' },
            { id: 'controls', label: '控件与状态' },
          ] as const
        ).map((item) => (
          <label className="pb-choice__option" key={item.id}>
            <input
              type="radio"
              name="lab-tab"
              value={item.id}
              checked={item.id === tab}
              data-testid={'lab-tab-' + item.id}
              onChange={() => setTab(item.id)}
            />
            <span className="pb-choice__text">{item.label}</span>
          </label>
        ))}
      </div>

      {tab === 'controls' ? (
        <div className="lab__board" data-testid="lab-control-board">
          <p className="lab__note">
            下面是这套控件自身的真实状态：能按、能填、能开关。样例不是后台回执——Start 里的 「已保存
            / 探测过 / 在用」只在真动作之后才出现。
          </p>
          <OriginalControlBoard />
        </div>
      ) : (
        <>
          <div className="lab__bar">
            <span className="lab__label" id="lab-design-label">
              Start 排法
            </span>
            <div className="lab__choices" role="radiogroup" aria-labelledby="lab-design-label">
              {START_DESIGN_ORDER.map((id) => {
                const meta = START_DESIGN_METAS[id];
                const ready = resolveStartDesign(designs, id) !== null;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={id === selected}
                    className={id === selected ? 'lab__choice is-on' : 'lab__choice'}
                    disabled={!ready}
                    title={ready ? meta.intent : '还没交付这一版'}
                    data-testid={'lab-pick-' + id}
                    onClick={() => setSelected(id)}
                  >
                    {meta.name}
                  </button>
                );
              })}
            </div>
            <span className="lab__count" data-testid="lab-count">
              {missing === 0
                ? '日常三节 + 5 个新排法，都可看'
                : '日常三节 + 新排法：已交付 ' + delivered.length + ' / 5，还差 ' + missing + ' 版'}
            </span>
          </div>

          <p className="lab__note">
            {design === null
              ? '这一版还没交付，也没有可看的基线排法。'
              : design.meta.intent + ' — ' + design.meta.tradeoff}
          </p>

          {design === null ? (
            <p className="lab-empty" data-testid="lab-empty">
              这一版还没交付，也没有可看的基线排法。
            </p>
          ) : (
            <div className="lab__canvas" data-design={design.meta.id} data-testid="lab-canvas">
              {design.render(context, slots)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
