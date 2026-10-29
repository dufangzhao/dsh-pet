/**
 * bench「并肩工作台」：桌宠舞台与连接检查器同高并排，配色在下方整宽。
 *
 * 视觉顺序与键盘顺序分开处理：DOM 从接线开始（不让键盘先绕过一排在用的预览按钮才够得着
 * 模型表单），464 的舞台用格位摆在左边（视线先落在它身上）。880 收成一列时格位取消，
 * 顺序自然就是「接线在上、舞台在下」，不写第二套顺序，也不靠 order 属性把焦点和视线错开。
 *
 * 插槽一份都不复制：状态、目录、表单、预览、配色都来自共享 sections；「使用向导」在
 * ConsoleApp 标题行，这里不摆第二颗。360 栏里把模型/Key/保存改成纵向排，是摆放级的覆盖，
 * 控件、禁用规则与回执还是那一个表单自己的。
 */
import type { JSX } from 'react';

import { START_DESIGN_METAS } from '../catalog.js';
import { LAB_GLYPHS, LabIcon } from '../lab-icons.js';
import { petDesktopState } from '../sections.js';

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
  const desktop = petDesktopState(context.app);
  const motionReduced = context.app.values?.reducedMotion ?? false;

  return (
    <div className="sd-bench" data-testid="bench-layout">
      <div className="sd-bench__track">
        {/* 检查器在 DOM 里在前：键盘从「已连接的模型」与测试连接开始。 */}
        <section className="sd-bench__inspector" aria-labelledby="sd-bench-inspector-title">
          <h2 className="sd-bench__title" id="sd-bench-inspector-title">
            接线
          </h2>
          {slots.status}
          {slots.vendors}
          {slots.connect}
        </section>

        <section className="sd-bench__stage" aria-labelledby="sd-bench-stage-title">
          <h2 className="sd-bench__title" id="sd-bench-stage-title">
            {/* 这只眼睛只说真实的一件事：桌面上有没有它。旁边的字已经说了，图形就不再报名。 */}
            <span className="sd-bench__mark">
              <LabIcon
                glyph={LAB_GLYPHS.desktop}
                active={desktop.tone === 'off'}
                motionReduced={motionReduced}
              />
            </span>
            桌宠舞台
            <span className={'pk-pill pk-pill--' + desktop.tone}>{desktop.text}</span>
          </h2>
          {slots.pet}
        </section>
      </div>

      <div className="sd-bench__colors">{slots.theme}</div>
    </div>
  );
}
