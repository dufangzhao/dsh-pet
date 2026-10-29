/**
 * 评审入口：只在未打包的 --start-design-lab 实例里出现，正常入口走不到这里。
 *
 * 选择器只换版式，不换所有者：模型连接、录音会话、应用偏好与主题工作室仍然只有一个实例，
 * 换版式不重播轮询、不重开麦克风，正在输入的模型名与 Key 也保留。
 * 没写好的方案列出来但点不动，并说明还差几版——不给一个空壳冒充已完成。
 */
import { useState, type JSX } from 'react';

import { useStartSlots } from './sections.js';
import {
  deliveredDesignIds,
  resolveStartDesign,
  START_DESIGN_METAS,
  START_DESIGN_ORDER,
} from './registry.js';

import type { StartContext, StartDesign, StartDesignId } from './contracts.js';

import './lab.css';

export interface StartDesignLabProps {
  context: StartContext;
  designs: readonly StartDesign[];
  /**
   * 评审默认看哪一版：只是让打开 lab 时先落在新方案上，不是产品选择，
   * 普通入口永远走基线。基准对照仍在选择器里可点。
   */
  initial?: StartDesignId;
}

export function StartDesignLab({
  context,
  designs,
  initial = 'bench',
}: StartDesignLabProps): JSX.Element {
  const [selected, setSelected] = useState<StartDesignId>(initial);
  const design = resolveStartDesign(designs, selected) ?? resolveStartDesign(designs, 'baseline');
  // 插槽在这里生成一次：换版式复用同一批接线与同一份回执，不重新读状态。
  const slots = useStartSlots(context);
  // 基准对照不是"第 6 个新方案"：文案分开数，别报成六个新方案都好了。
  const delivered = deliveredDesignIds(designs).filter((id) => id !== 'baseline');
  const missing = START_DESIGN_ORDER.length - 1 - delivered.length;

  if (design === null) {
    return (
      <p className="lab-empty" data-testid="lab-empty">
        这一版还没交付，也没有可看的基线版式。
      </p>
    );
  }

  return (
    <div className="lab" data-testid="start-design-lab">
      <div className="lab__bar">
        <span className="lab__label" id="lab-design-label">
          Start 版式
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
            ? '基准对照 + 5 个新方案，都可看'
            : '基准对照 + 新方案：已交付 ' + delivered.length + ' / 5，还差 ' + missing + ' 版'}
        </span>
      </div>

      <p className="lab__note">
        {design.meta.intent} — {design.meta.tradeoff}
      </p>

      <div className="lab__canvas" data-design={design.meta.id} data-testid="lab-canvas">
        {design.render(context, slots)}
      </div>
    </div>
  );
}
