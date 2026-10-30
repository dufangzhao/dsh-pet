/**
 * 评审入口守的是"看到的那一扇窗是谁的"：
 * 根分支不挂设置台外壳（读屏里不能有第二份导航）、五家都列出来、没交的禁用且不算交付、
 * 默认落在真的能看的那一家，切换家族换的是整窗而不是在同一扇窗里换个颜色。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { StartOwners } from '../start-designs/use-start-model.js';
import { StyleFamilyGallery, familyReady, pickInitialFamily } from './gallery.js';
import { STYLE_FAMILIES, STYLE_FAMILY_ORDER, familySelectorId } from './registry.js';

/** 评审实例的所有者：这一份只用来渲染，一次动作都不发。 */
const owners = {
  app: { available: false, values: null, snapshot: null, loading: false, saving: false },
  demo: { available: false, snapshot: null, recording: null, left: null },
  models: { available: false, snapshot: null, loading: false, error: null },
  notify: () => undefined,
  goToView: () => undefined,
  onOpenPlugins: () => undefined,
} as unknown as StartOwners;

const html = (over: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(<StyleFamilyGallery owners={owners} {...over} />);

describe('评审入口', () => {
  it('五种风格都列在选择器里：都交了，就没有一个禁用', () => {
    const markup = html();
    expect(markup).toContain('data-testid="style-family-gallery"');
    for (const id of STYLE_FAMILY_ORDER) {
      expect(markup).toContain('data-testid="' + familySelectorId(id) + '"');
    }
    expect(markup).toContain('5 / 5 种风格');
    // 一家都没交的登记不该出现在这里：选择器上没有 disabled 按钮。
    const disabled = markup.match(/<button[^>]+disabled[^>]*data-testid="style-pick-/g) ?? [];
    expect(disabled).toEqual([]);
  });

  it('默认落在第一个真的能看的家族，指定那一家没交也不对着空壳', () => {
    expect(pickInitialFamily(STYLE_FAMILIES, 'precision')).toBe('precision');
    expect(pickInitialFamily(STYLE_FAMILIES, 'prism')).toBe('prism');
    const none = STYLE_FAMILIES.map((family) => ({ ...family, Component: null }));
    expect(pickInitialFamily(none, 'prism')).toBe('prism');
    expect(familyReady(none, 'precision')).toBe(false);
  });

  it('根分支里不挂设置台外壳：侧栏、页头、页脚一个都不渲染', () => {
    const markup = html();
    for (const forbidden of ['settings-shell', 'pb-rail', 'pb-modes', 'pb-run', 'console-nav']) {
      expect(markup.includes(forbidden), '评审根分支不该出现 ' + forbidden).toBe(false);
    }
  });

  it('两面都有各自的开关，窗体上写着现在看的是哪一家哪一面', () => {
    const start = html();
    expect(start).toContain('data-testid="style-view-start"');
    expect(start).toContain('data-testid="style-view-board"');
    expect(start).toContain('data-testid="style-family-root"');
    expect(start).toContain('data-family="precision"');
    expect(start).toContain('data-view="start"');
    expect(start).toContain('data-testid="start-guide"');
    const board = html({ initial: 'workbench' });
    expect(board).toContain('data-family="workbench"');
  });

  it('评审默认落点与旧排法各走各路：排法对照是另一面，不是第五种风格', () => {
    const markup = html({ onOpenLayouts: () => undefined });
    expect(markup).toContain('data-testid="style-open-layouts"');
    expect(markup).toContain('不是风格');
  });
});
