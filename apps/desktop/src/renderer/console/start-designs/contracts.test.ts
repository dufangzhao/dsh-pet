import type { ModelService } from '@pet/contracts';
import { describe, expect, it } from 'vitest';

import { saveEnabled, testEnabled } from './contracts.js';
import { vendorGroupsOf } from './sections.js';
import {
  deliveredDesignIds,
  resolveStartDesign,
  START_DESIGNS,
  START_DESIGN_ORDER,
} from './registry.js';

const service = (over: Partial<ModelService> & { id: string; service: string }): ModelService => ({
  label: over.id,
  region: 'global',
  defaultModel: 'm-1',
  models: ['m-1'],
  keyHint: '粘贴 API Key',
  keyUrl: 'https://example.invalid/keys',
  auth: 'api-key',
  available: true,
  ...over,
});

/**
 * 这几条是基线已经验证过的判断，五种新排法都必须共用同一套：
 * 留空 Key、能不能测、能不能保存，都不许因为换了版式而放宽或收紧。
 */
describe('版式共用的连接判断', () => {
  it('Key 留空只有填在用的那个端点时才成立', () => {
    const base = { saving: false, available: true, model: 'm-1', key: '' };
    expect(saveEnabled({ ...base, targetIsActive: true })).toBe(true);
    expect(saveEnabled({ ...base, targetIsActive: false })).toBe(false);
  });

  it('换了一家就必须给它一个新 Key；在用的那家留空沿用', () => {
    const base = { saving: false, available: true, model: 'm-1', key: '' };
    expect(saveEnabled({ ...base, targetIsActive: false, key: 'sk-x' })).toBe(true);
  });

  it('保存中、这家没接进来、模型名空着都不给保存', () => {
    const ok = { available: true, model: 'm-1', key: 'sk-x', targetIsActive: false };
    expect(saveEnabled({ ...ok, saving: true })).toBe(false);
    expect(saveEnabled({ ...ok, saving: false, available: false })).toBe(false);
    expect(saveEnabled({ ...ok, saving: false, model: '  ' })).toBe(false);
  });

  it('测试连接只对在用端点开放，且不在重复点击时并发', () => {
    expect(testEnabled(false, false)).toBe(false);
    expect(testEnabled(true, false)).toBe(true);
    expect(testEnabled(true, true)).toBe(false);
  });
});

/** 19 个端点里同一家有两块平台的，芯片上只出现一次。 */
describe('厂商分组', () => {
  const catalog = [
    service({ id: 'deepseek', service: 'deepseek' }),
    service({ id: 'qwen', service: 'qwen', region: 'cn' }),
    service({ id: 'qwen-intl', service: 'qwen', region: 'intl' }),
    service({ id: 'kimi', service: 'kimi', region: 'cn' }),
    service({ id: 'kimi-intl', service: 'kimi', region: 'intl' }),
  ];

  it('五家变三家，另一块平台挂在 alt 上', () => {
    const groups = vendorGroupsOf(catalog);
    expect(groups.map((group) => group.name)).toEqual(['deepseek', 'qwen', 'kimi']);
    expect(groups[1]?.main.id).toBe('qwen');
    expect(groups[1]?.alt?.id).toBe('qwen-intl');
    expect(groups[0]?.alt).toBeUndefined();
  });

  it('只有另一块平台时也拿得到它，不丢服务', () => {
    const groups = vendorGroupsOf([service({ id: 'glm-intl', service: 'glm', region: 'intl' })]);
    expect(groups[0]?.main.id).toBe('glm-intl');
  });
});

/** 评审入口要能说清哪几版真的能看，不给空壳占名额。 */
describe('版式登记', () => {
  it('六个都登记了；没交付的解析为 null，选择器才有"待完成"可显示', () => {
    expect(deliveredDesignIds(START_DESIGNS)).toEqual([...START_DESIGN_ORDER]);
    expect(resolveStartDesign([], 'bench')).toBeNull();
    expect(resolveStartDesign(START_DESIGNS, 'baseline')).not.toBeNull();
  });

  it('选择器默认落在新方案上，基线仍可作对照', () => {
    expect(START_DESIGN_ORDER[0]).toBe('baseline');
    expect(resolveStartDesign(START_DESIGNS, 'bench')).not.toBeNull();
  });
});
