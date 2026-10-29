/**
 * 六个 Start 版式的名字、意图与取舍：纯数据，谁都不导入，因此可以在这里被两边读。
 *
 * 单独放一个文件是为了断掉循环：变体要读这些文案，而登记处又要导入变体——
 * 两头都从 registry 走的话，模块顶层初始化会撞上暂时死区。版式作者从 ../catalog.js 取。
 */
import type { StartDesignId, StartDesignMeta } from './contracts.js';

/** 顺序就是评审时的阅读顺序：先复刻基线，再看五个改动方向。 */
export const START_DESIGN_ORDER: readonly StartDesignId[] = [
  'baseline',
  'bench',
  'switchboard',
  'spine',
  'stage',
  'workspaces',
];

export const START_DESIGN_METAS: Readonly<Record<StartDesignId, StartDesignMeta>> = {
  baseline: {
    id: 'baseline',
    name: '日常三节',
    intent: '普通入口的那一屏：连接模型、我的桌宠、界面配色，自上而下读。',
    tradeoff: '信息层级最保守，一屏里三件事都要滚一下。',
  },
  bench: {
    id: 'bench',
    name: '并肩工作台',
    intent: '桌宠与连接检查并排，一边看一边接线。',
    tradeoff: '窄一点就要上下堆，正文列被压到 464px。',
  },
  switchboard: {
    id: 'switchboard',
    name: '模型接线台',
    intent: '服务目录常驻左列，详情区只伺候正在挑的这家。',
    tradeoff: '桌宠退到详情下方，第一眼不在它身上。',
  },
  spine: {
    id: 'spine',
    name: '从连接到见面',
    intent: '三段可重开的展开，按新手顺序读下去。',
    tradeoff: '一次只专注一件事，但要经常展开收起。',
  },
  stage: {
    id: 'stage',
    name: '桌宠在场',
    intent: '先看见它，再把接线与配色放到下面两层抽屉。',
    tradeoff: '模型表单不在首屏，接线要多滚一段。',
  },
  workspaces: {
    id: 'workspaces',
    name: '三页工作簿',
    intent: '一条真实状态栏加三个整宽工作页，各自只剩自己的事。',
    tradeoff: '同一屏看不全三件事，切换多一次点击。',
  },
};
