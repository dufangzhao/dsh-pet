/**
 * 五个风格家族的登记处：id、名字、一句话说明，以及那一个组件。
 *
 * 一家一个文件（precision/hearth/folio/prism/workbench 的 .tsx+.css），作者只写自己那两份。
 * 作者愿意连名字与说明一起定稿就 `export const X_FAMILY: StyleFamily`（hearth 已经这么交），
 * 只交组件的（precision/folio）就由这里配一句中性说明。
 * 没交的那几家 Component 是 null：选择器照样列出、但禁用，理由写在 title 上——评审入口不放空壳。
 */
import type { StyleFamily, StyleFamilyId } from './contracts.js';
import { FOLIO_FAMILY } from './folio.js';
import { HEARTH_FAMILY } from './hearth.js';
import { PrecisionFamily } from './precision.js';
import { PRISM_FAMILY } from './prism.js';
import { WORKBENCH_FAMILY } from './workbench.js';

/** 选择器的顺序，也是评审的阅读顺序：Workbench（现在那套饲养台板件）压轴作对照。 */
export const STYLE_FAMILY_ORDER: readonly StyleFamilyId[] = [
  'precision',
  'hearth',
  'folio',
  'prism',
  'workbench',
];

/** 评审默认落在第一家新风格上；这是评审入口的落点，不是产品选择，正常入口照旧走饲养台。 */
export const REVIEW_DEFAULT_FAMILY: StyleFamilyId = 'precision';

/** 还没交付的那几家在这一栏里怎么说：一次说清，不包装。 */
export const PENDING_NOTE = '这一家还没交付：作者的文件进来就接上，这里不放空壳。';

/** 选择器与评审外壳共用的 locator：一家一个按钮，QA 按 id 找。 */
export function familySelectorId(id: StyleFamilyId): string {
  return 'style-pick-' + id;
}

/**
 * 说明写的是「看起来为什么不一样」：控件构造、密度、材质、导航形状——不是配色换了几格。
 * 类型是非空元组：取第一行不用再判 undefined。
 */
export const STYLE_FAMILIES: readonly [StyleFamily, ...StyleFamily[]] = [
  {
    id: 'precision',
    // 作者没交文案，这一条由集成的人定：中文正名 + 英文副名，id 不改。
    name: '仪表台 Precision',
    description:
      '系统无衬线加等宽读数、一根线框的描边动作、原生下拉挑服务、左列表右详情分屏、挡位式分区导航。',
    Component: PrecisionFamily,
  },
  HEARTH_FAMILY,
  FOLIO_FAMILY,
  PRISM_FAMILY,
  WORKBENCH_FAMILY,
];

/** 按 id 取一家；没有这个 id 返回 null，选择器才知道该不该禁用。 */
export function resolveFamily(
  families: readonly StyleFamily[],
  id: StyleFamilyId,
): StyleFamily | null {
  return families.find((family) => family.id === id) ?? null;
}

/** 交付与否只看有没有组件：名字与说明写得再漂亮也不算交了。 */
export function familyDelivered(family: StyleFamily | null): boolean {
  return family !== null && family.Component !== null;
}

export function deliveredFamilyIds(families: readonly StyleFamily[]): StyleFamilyId[] {
  return STYLE_FAMILY_ORDER.filter((id) => familyDelivered(resolveFamily(families, id)));
}
