import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SCHEME_ID, THEME_TOKENS, defaultStoredTheme, saveSchemeAs } from './theme.js';
import { ThemeEditor } from './theme-editor.js';

/**
 * 这里只断言这一节的语义形状：挡位是不是原生 radio 组、方案卡有没有把选中态说出来、
 * 调色盘是不是把 36 格全画出来并分成五组、内置与自定义给的操作是否不同。
 * 像素与配色由 theme.ts 的令牌映射负责，样式表本身不在这里重复检查。
 */
function seed(state: unknown): void {
  const value = JSON.stringify(state);
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (key === 'pet.console.theme' ? value : null),
      setItem: () => undefined,
    },
    configurable: true,
  });
}

/** 渲染一个已经选中自定义方案的编辑器，返回那份记录。 */
function customState(): unknown {
  return saveSchemeAs(defaultStoredTheme(), {
    name: '我的',
    palette: Object.fromEntries(THEME_TOKENS.map((token) => [token.key, '#123456'])),
    appearance: 'light',
  }).state;
}

describe('界面配色一节', () => {
  beforeEach(() => seed(defaultStoredTheme()));

  it('三挡明暗是原生 radio 组，选中态只落在记录给的那一挡', () => {
    seed({ ...defaultStoredTheme(), mode: 'dark' });
    const html = renderToStaticMarkup(<ThemeEditor />);
    expect(html).toContain('role="radiogroup"');
    const radios = html.match(/type="radio"/g) ?? [];
    expect(radios).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('aria-label="跟随系统"');
    expect(html).toContain('aria-label="黑夜"');
    // 可见文字与读屏名称同一套词，不再一个是“深色”一个是“黑夜”。
    expect(html).toContain('◐ 黑夜');
  });

  it('内置方案在前，选中那一张用 aria-pressed 说清楚', () => {
    const html = renderToStaticMarkup(<ThemeEditor />);
    expect(html.match(/class="theme-scheme[" ]/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('简约');
    expect(html).toContain('陶烬');
    expect(html).toContain('内置');
  });

  it('调色盘折叠起来也带着全部 36 格与五个分组', () => {
    const html = renderToStaticMarkup(<ThemeEditor />);
    expect(html).toContain('<details');
    expect(html).toContain('调色盘');
    expect(html.match(/type="color"/g)).toHaveLength(THEME_TOKENS.length);
    for (const group of ['背景层级', '文字与边界', '交互与状态', '控制台时间线', '图表系列']) {
      expect(html).toContain(group);
    }
    expect(html).toContain('页面背景颜色');
    expect(html).toContain('系列 8十六进制颜色');
  });

  it('方案名输入框上限 40 字', () => {
    const html = renderToStaticMarkup(<ThemeEditor />);
    expect(html).toContain('方案名');
    expect(html).toMatch(/maxlength="40"/i);
  });

  it('内置方案没有删除按钮，保存那一颗写的是另存为自定义', () => {
    const html = renderToStaticMarkup(<ThemeEditor />);
    expect(html).not.toContain('删除方案');
    expect(html).toContain('另存为自定义');
    expect(html).toContain('复制为新方案');
    expect(html).toContain('内置方案不可覆盖');
  });

  it('选中自定义方案时才有删除，保存写成保存当前方案', () => {
    const state = customState() as { selectedId: string };
    expect(state.selectedId).not.toBe(DEFAULT_SCHEME_ID);
    seed(state);
    const html = renderToStaticMarkup(<ThemeEditor />);
    expect(html).toContain('删除方案');
    expect(html).toContain('保存当前方案');
    expect(html).toContain('自定义方案可直接保存');
    expect(html.match(/class="theme-scheme[" ]/g)).toHaveLength(4);
  });

  it('组件试色用真令牌画一版：六根系列柱与三层文字都在', () => {
    const html = renderToStaticMarkup(<ThemeEditor />);
    expect(html).toContain('组件试色');
    expect(html.match(/background:var\(--chart-/g)).toHaveLength(6);
    expect(html).toContain('theme-specimen__bubble');
    expect(html).toContain('aria-label="图表系列色预览"');
  });
});
