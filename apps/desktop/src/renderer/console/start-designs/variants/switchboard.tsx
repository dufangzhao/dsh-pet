/**
 * switchboard「模型接线台」：顶部一条真实状态，左边常驻服务目录，右边只伺候挑中的这一家。
 *
 * 这版的立场是"接线是主活"：已连接的那一家与测试连接整宽在最上面，15 家目录常驻左列
 * （同一批共享芯片竖过来摆，不重排、不复制、不改控件），640 的详情区只放挑中这一家的表单，
 * 预览在表单之后——它是接好之后的确认，不是入口。配色工作室在轨道下方整宽。
 *
 * 目录是可重开的 disclosure，默认展开：折叠只是省一次滚动，不把任何一家藏进下拉里。
 * 目录上的数字读 vendorGroupsOf（与芯片同一个来源），不是写死的"15"。
 * 「使用向导」在 ConsoleApp 标题行，这里不摆第二颗。
 */
import { useState, type JSX } from 'react';

import { START_DESIGN_METAS } from '../catalog.js';
import { LAB_GLYPHS, LabIcon } from '../lab-icons.js';
import { petDesktopState, vendorGroupsOf } from '../sections.js';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';

import './switchboard.css';

export const SWITCHBOARD_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.switchboard,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <SwitchboardSurface context={context} slots={slots} />;
  },
};

function SwitchboardSurface({
  context,
  slots,
}: {
  context: StartContext;
  slots: StartSlots;
}): JSX.Element {
  const [railOpen, setRailOpen] = useState(true);
  const snapshot = context.models.snapshot;
  const desktop = petDesktopState(context.app);
  const motionReduced = context.app.values?.reducedMotion ?? false;
  // 与共享目录同一个分组来源：读不到快照就说在读，不猜一个数出来。
  const groups = snapshot === null ? null : vendorGroupsOf(snapshot.services).length;

  return (
    <div className="sd-board" data-testid="switchboard-layout">
      <div className="sd-board__track">
        <div className="sd-board__strip">{slots.status}</div>

        <div className="sd-board__body">
          <section className="sd-board__rail" aria-labelledby="sd-board-rail-toggle">
            <button
              type="button"
              id="sd-board-rail-toggle"
              className="sd-board__rail-toggle"
              aria-expanded={railOpen}
              aria-controls="sd-board-rail-body"
              data-testid="switchboard-rail-toggle"
              onClick={() => setRailOpen((open) => !open)}
            >
              <span className="sd-board__rail-title">模型服务目录</span>
              <span className="sd-board__rail-count">
                {groups === null ? '正在读目录' : groups + ' 家'}
              </span>
              <span className="sd-board__rail-caret" aria-hidden="true" />
            </button>
            <div className="sd-board__rail-body" id="sd-board-rail-body" hidden={!railOpen}>
              {slots.vendors}
            </div>
          </section>

          <section className="sd-board__detail" aria-labelledby="sd-board-detail-title">
            <h2 className="sd-board__title" id="sd-board-detail-title">
              这一家的接线
            </h2>
            {slots.connect}

            <h3 className="sd-board__subtitle" id="sd-board-pet-title">
              <span className="sd-board__mark">
                <LabIcon
                  glyph={LAB_GLYPHS.desktop}
                  active={desktop.tone === 'off'}
                  motionReduced={motionReduced}
                />
              </span>
              接好之后看它一眼
              <span className={'pk-pill pk-pill--' + desktop.tone}>{desktop.text}</span>
            </h3>
            <div className="sd-board__pet" aria-labelledby="sd-board-pet-title">
              {slots.pet}
            </div>
          </section>
        </div>

        <div className="sd-board__colors">{slots.theme}</div>
      </div>
    </div>
  );
}
