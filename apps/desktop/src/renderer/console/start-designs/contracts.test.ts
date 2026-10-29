import { describe, expect, it } from 'vitest';

import {
  deliveredDesignIds,
  resolveStartDesign,
  START_DESIGNS,
  START_DESIGN_METAS,
  START_DESIGN_ORDER,
} from './registry.js';

/**
 * 评审入口要能说清哪几版真的能看，不给空壳占名额；
 * 名字与取舍是指向本产品的说法，不出现参考来源的专有名。
 */
describe('版式登记', () => {
  it('六种都登记了；没交付的解析为 null，选择器才有"待完成"可显示', () => {
    expect(deliveredDesignIds(START_DESIGNS)).toEqual([...START_DESIGN_ORDER]);
    expect(resolveStartDesign([], 'bench')).toBeNull();
    expect(resolveStartDesign(START_DESIGNS, 'baseline')).not.toBeNull();
  });

  it('选择器默认落在新排法上，日常三节仍可作对照', () => {
    expect(START_DESIGN_ORDER[0]).toBe('baseline');
    expect(resolveStartDesign(START_DESIGNS, 'bench')).not.toBeNull();
  });

  it('每个排法都有 intent 与 tradeoff：评审看的是取舍，不是空话', () => {
    for (const id of START_DESIGN_ORDER) {
      const meta = START_DESIGN_METAS[id];
      expect(meta.intent.length).toBeGreaterThan(4);
      expect(meta.tradeoff.length).toBeGreaterThan(4);
    }
  });
});
