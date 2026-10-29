/**
 * bench「并肩工作台」：接线检查器与桌宠舞台同高并排，配色在下方整宽。
 *
 * 排法不变，控件换掉：这里摆的是 start-designs 自己画的新插槽（目录、表单、预览、配色），
 * 状态牌用 kit 的 Status，不再有 pk-pill 那一枚胶囊。
 * 视觉顺序与键盘顺序分开处理：DOM 从接线开始，舞台用格位摆在左边；880 收成一列时格位取消。
 */
import type { JSX } from 'react';

import { Status } from '../../original-ui/kit.js';
import { START_DESIGN_METAS } from '../catalog.js';
import { StartSection } from '../sections.js';

import type { StartContext, StartDesign, StartSlots } from '../contracts.js';

import './bench.css';

export const BENCH_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.bench,
  render(context: StartContext, slots: StartSlots): JSX.Element {
    return <BenchSurface context={context} slots={slots} />;
  },
};

function BenchSurface({
  context,
  slots,
}: {
  context: StartContext;
  slots: StartSlots;
}): JSX.Element {
  const model = context.model;
  return (
    <div className="sd-bench" data-testid="bench-layout">
      <div className="sd-bench__track">
        {/* 检查器在 DOM 里在前：键盘先从"在用的那一家"与测试连接开始。 */}
        <StartSection
          className="sd-bench__inspector"
          title="接线"
          note="这一栏只改这台机器上的模型连接。"
          status={slots.status}
        >
          {slots.provider}
          {slots.connect}
        </StartSection>

        <StartSection
          className="sd-bench__stage"
          title="桌宠舞台"
          status={
            <Status tone={model.desktop.mark === 'on' ? 'on' : 'off'}>{model.desktop.text}</Status>
          }
        >
          {slots.pet}
        </StartSection>
      </div>

      <div className="sd-bench__colors">{slots.theme}</div>
    </div>
  );
}
