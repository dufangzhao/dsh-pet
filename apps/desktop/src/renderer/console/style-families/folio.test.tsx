/**
 * Folio 的回归盯三件事：
 * 1) 这一族真的画的是「文字索引 + 勾选记号 + 划线字段 + 骑缝单据 + 目次导航」；
 * 2) 它与 Precision 的差别在控件类型本身，不是同一套模板换个皮；
 * 3) 能不能按、为什么按不动，读的还是 model 那份判断；样张不冒充后台结果。
 */
import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FOREIGN_KIT, countOf, stubModel } from './stub-model.js';
import { FOLIO_SEED, FolioFamily, type Leaf } from './folio.js';

import type { StartModel } from '../start-designs/use-start-model.js';

function view(
  over: { leaf?: Leaf; board?: boolean; model?: StartModel; guide?: ReactNode } = {},
): string {
  return renderToStaticMarkup(
    <FolioFamily
      model={over.model ?? stubModel()}
      board={over.board ?? false}
      {...(over.leaf === undefined ? {} : { openLeaf: over.leaf })}
      {...(over.guide === undefined ? {} : { guide: over.guide })}
    />,
  );
}

describe('Folio 的控件体系', () => {
  it('目录是排印出来的文字条目：没有下拉框，没有表格行，挑中在行首打个勾', () => {
    const html = view({ leaf: 'provider' });
    expect(html).toContain('<ol class="fl-index"');
    expect(countOf(html, 'model-pick-')).toBe(3);
    expect(html).toContain('<span class="fl-index__tick" aria-hidden="true">✓</span>');
    expect(html).toContain('data-disabled="true"');
    // 这一族挑服务不用 <select>，也不用表格与井格。
    expect(html).not.toContain('model-provider-select');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<caption');
    expect(html).not.toContain('role="switch"');
    // 筛选也是一条勾选记号，不是插销开关。
    expect(html).toContain('data-testid="fl-filter-available"');
  });

  it('字段只有一根下划线，动作只是文字，回执是一张存根', () => {
    const html = view({
      leaf: 'entry',
      model: stubModel({
        saved: { saved: false, tested: false, active: false, text: '这台机器没收下这次写入。' },
      }),
    });
    expect(html).toContain('class="fl-ruled__input"');
    expect(html).toContain('class="fl-action"');
    expect(html).not.toContain('px-btn');
    expect(html).toContain('data-testid="model-receipt"');
    expect(html).toContain('class="fl-slip"');
    expect(html).toContain('这台机器没收下这次写入。');
    // 端点信息也是单据式的行，带引绳，而不是数据读数。
    expect(html).toContain('class="fl-receipt__rule"');
  });

  it('导航是目次与天头页码：五页都在，且不引入锚点或路由', () => {
    const html = view();
    expect(countOf(html, 'fl-leaf-')).toBe(5);
    for (const leaf of ['provider', 'entry', 'presence', 'palette', 'specimen'] as const) {
      expect(html).toContain('data-testid="fl-leaf-' + leaf + '"');
    }
    expect(html).not.toContain('href=');
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('data-leaf="provider"');
    expect(html).toContain('一 · 服务索引');
  });

  it('按不动时那句原因写在同一页上', () => {
    const html = view({
      leaf: 'entry',
      model: stubModel({
        can: { save: false, test: false, signIn: true },
        reasons: {
          save: '模型名不能空着。',
          test: '还没有在用的连接：先保存一家，再测它。',
          signIn: null,
        },
      }),
    });
    expect(html).toContain('data-testid="model-save-reason"');
    expect(html).toContain('data-testid="model-test-reason"');
    expect(html).toContain('模型名不能空着。');
    expect(html).toContain('还没有在用的连接');
  });

  it('暂时不回应与可见性都是勾选记号，不是开关', () => {
    const html = view({ leaf: 'presence' });
    expect(html).toContain('data-testid="pet-pause"');
    expect(html).toContain('data-testid="pet-visible"');
    expect(html).toContain('data-testid="pet-light-toggle"');
    expect(html).not.toContain('role="switch"');
    expect(countOf(html, 'type="checkbox"')).toBe(3);
    // 戳一下落在真实那颗按钮上，页面上没有替身节点。
    expect(html).toContain('<button type="button" class="fl-figure"');
    expect(countOf(html, 'data-testid="pet-poke"')).toBe(1);
    expect(html).toContain('data-testid="pet-stage"');
    expect(html).toContain('data-testid="pet-composer-input"');
    expect(html).toContain('data-testid="pet-mic-toggle"');

    const off = view({
      leaf: 'presence',
      model: stubModel({ pet: { ...stubModel().pet, mic: undefined, composer: undefined } }),
    });
    expect(off).toContain('这条会话现在不在');
    expect(off).not.toContain('data-testid="pet-mic-toggle"');
    expect(off).not.toContain('data-testid="pet-composer-input"');
  });

  it('配色那一页是四开的色表：36 格各有一根线与一枚取色器', () => {
    const html = view({ leaf: 'palette' });
    expect(html).toContain('data-testid="start-theme"');
    expect(countOf(html, 'theme-token-')).toBe(36);
    expect(countOf(html, 'theme-hex-')).toBe(36);
    expect(html).toContain('data-testid="theme-delete"');
    expect(html).toContain('data-testid="theme-undo"');
    // 挡位也是勾选记号，不是分段控件。
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('role="switch"');
  });

  it('不借旧板件，也不与 Precision 共用一个控件构造', () => {
    const window = view({ leaf: 'entry' });
    const board = view({ board: true });
    for (const marker of FOREIGN_KIT) {
      expect(window).not.toContain(marker);
      expect(board).not.toContain(marker);
    }
    expect(window).not.toContain('px-');
    expect(window).not.toContain('sf-precision');
  });

  it('样张只演样子：不与整窗同屏，也不出现真回执', () => {
    const board = view({ board: true });
    expect(board).toContain('data-testid="fl-specimen"');
    expect(board).toContain('data-sample="true"');
    expect(board).toContain('disabled');
    expect(board).not.toContain('data-testid="model-receipt"');
    expect(board).not.toContain('data-testid="start-connect-form"');
    expect(board).toContain('class="fl-toc__link"');
  });

  it('呈现种子是米纸与墨色，夜读那一份也还是纸', () => {
    const html = view();
    expect(FOLIO_SEED.light?.['paper']).toBe('#f4efe2');
    expect(FOLIO_SEED.dark?.['sheet']).toBe('#242019');
    expect(html).toContain('data-seeded="true"');
    expect(html).toContain('--paper:#f4efe2');
    expect(html).toContain('颜色＝本册呈现种子');
    expect(html).not.toContain('start-guide');
    expect(
      view({
        guide: (
          <button type="button" data-testid="start-guide">
            使用向导
          </button>
        ),
      }),
    ).toContain('data-testid="start-guide"');
  });
});

/**
 * 内部搜索那一行是真截图里踩过的坑：外层「标签列 / 字段列 / 计数」与内层 FlRuled 的标签列各排一次，
 * 输入框被挤到 0 宽、注记逐字竖排。宽度只有真窗口能量得到，这里钉住修过的那条嵌套规则本身，
 * 不让它退回「两层 132px」。
 */
describe('Folio 的纸面宽度', () => {
  const css = readFileSync(new URL('./folio.css', import.meta.url), 'utf8');

  it('搜索那一行的字段横跨前两列，计数让开第三列', () => {
    const span = css.match(/\.fl-index__search > \.fl-ruled\s*\{[^}]*\}/);
    expect(span?.[0]).toContain('grid-column: 1 / 3;');
    const count = css.match(/\.fl-index__search > \.fl-index__count\s*\{[^}]*\}/);
    expect(count?.[0]).toContain('grid-column: 3;');
    // 划线的输入与注记都留得住一行字；注记跟输入同列，不再被压成一竖行。
    expect(css).toContain('min-width: 100px');
    expect(css).toMatch(/\.fl-ruled__note \{[\s\S]*?grid-column: 2;/);
    // 窄屏外层已收成单列：跨列必须收回，不然隐式轨道又把宽度吃掉。
    expect(css).toMatch(
      /\.fl-index__search > \.fl-ruled,\s*\.fl-index__search > \.fl-index__count \{[^}]*grid-column: auto;/,
    );
  });
});
