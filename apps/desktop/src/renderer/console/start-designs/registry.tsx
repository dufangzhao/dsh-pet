/**
 * 版式登记处：把变体文件接成可评审的列表。
 *
 * 变体作者不写这里——每个人只加自己那一个文件，注册由这里统一导入，
 * 避免五个人抢同一处编辑。名字与取舍在 catalog.ts，这里只负责接上实现。
 * 没交付的方案不进 START_DESIGNS：评审选择器会把它列成"待完成"并禁用，而不是画一个空壳。
 */
import type { StartContext, StartDesign, StartDesignId } from './contracts.js';
import { START_DESIGN_METAS, START_DESIGN_ORDER } from './catalog.js';
import { petDesktopState, StartSection } from './sections.js';
import { BENCH_DESIGN } from './variants/bench.js';
import { SPINE_DESIGN } from './variants/spine.js';
import { STAGE_DESIGN } from './variants/stage.js';
import { SWITCHBOARD_DESIGN } from './variants/switchboard.js';
import { WORKSPACES_DESIGN } from './variants/workspaces.js';

export { START_DESIGN_METAS, START_DESIGN_ORDER } from './catalog.js';

/** 主进程只在未打包的 --start-design-lab 实例上挂这个标记；正常入口没有它。 */
export function designLabEnabled(): boolean {
  return typeof window !== 'undefined' && window.petDesignLab?.enabled === true;
}

/** 基线版式：连接模型、我的桌宠、界面配色三节，就是已验证的那一屏。 */
export const BASELINE_START_DESIGN: StartDesign = {
  meta: START_DESIGN_METAS.baseline,
  render(context: StartContext, slots) {
    return (
      <>
        <StartSection title="连接模型">
          {slots.status}
          {slots.vendors}
          {slots.connect}
        </StartSection>
        <StartSection title="我的桌宠" state={petDesktopState(context.app)}>
          {slots.pet}
        </StartSection>
        {slots.theme}
      </>
    );
  },
};

/** 五版全部交付；顺序就是评审选择器的顺序（基准在前，作对照）。 */
export const START_DESIGNS: readonly StartDesign[] = [
  BASELINE_START_DESIGN,
  BENCH_DESIGN,
  SWITCHBOARD_DESIGN,
  SPINE_DESIGN,
  STAGE_DESIGN,
  WORKSPACES_DESIGN,
];

export function resolveStartDesign(
  designs: readonly StartDesign[],
  id: StartDesignId,
): StartDesign | null {
  return designs.find((design) => design.meta.id === id) ?? null;
}

/** 已交出的方案数：评审入口要说清还差几版，不含糊过去。 */
export function deliveredDesignIds(designs: readonly StartDesign[]): StartDesignId[] {
  return START_DESIGN_ORDER.filter((id) => resolveStartDesign(designs, id) !== null);
}
