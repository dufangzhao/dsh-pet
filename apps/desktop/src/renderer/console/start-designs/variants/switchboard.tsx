/**
 * switchboard「模型接线台」：服务目录常驻左列，详情区只伺候正在挑的这家。
 *
 * 目录用新控件（搜索 + 井格/清单两读法），详情下面是预览；配色整宽放在最后。
 * 读不到目录时不猜数字：那一句由插槽自己说，这里不补一个假计数。
 */
import { useState, type JSX } from 'react';

import { Disclosure, Status } from '../../original-ui/kit.js';
import { START_DESIGN_METAS } from '../catalog.js';

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
  const model = context.model;
  return (
    <div className="sd-board" data-testid="switchboard-layout">
      <div className="sd-board__strip">{slots.status}</div>

      <div className="sd-board__body">
        <Disclosure
          className="sd-board__rail"
          label="模型服务目录"
          hint={
            model.available
              ? model.rows.length === 0
                ? '正在读目录'
                : model.rows.length + ' 家'
              : '这台机器还没有目录通道'
          }
          open={railOpen}
          onOpenChange={setRailOpen}
        >
          {slots.provider}
        </Disclosure>

        <section className="sd-board__detail" aria-labelledby="sd-board-detail-title">
          <h2 className="sd-board__title" id="sd-board-detail-title">
            这一家的接线
            {model.picked === undefined ? null : (
              <span className="sd-board__who">{model.picked.label}</span>
            )}
          </h2>
          {slots.connect}

          <h3 className="sd-board__subtitle" id="sd-board-pet-title">
            接好之后看它一眼
            <Status tone={model.desktop.mark === 'on' ? 'on' : 'off'}>{model.desktop.text}</Status>
          </h3>
          <div className="sd-board__pet" aria-labelledby="sd-board-pet-title">
            {slots.pet}
          </div>
        </section>
      </div>

      <div className="sd-board__colors">{slots.theme}</div>
    </div>
  );
}
