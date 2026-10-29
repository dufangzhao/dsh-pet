/**
 * 配色工作室的板面语义：方案瓦片叫得出自己的名字、挡位是 radio 而不是 toggle、36 格全在场。
 *
 * 只断言这一节的形状与可访问名称；像素与配色值由 theme.ts 那套令牌负责，不在这里重复检查。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { THEME_TOKENS, defaultStoredTheme, writeThemeState } from '../theme.js';
import { OriginalThemeStudio } from './theme-studio.js';

function seeded(): string {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    configurable: true,
  });
  writeThemeState(defaultStoredTheme());
  return renderToStaticMarkup(<OriginalThemeStudio />);
}

describe('配色工作室', () => {
  beforeEach(() => seeded());

  it('三块内置方案各叫自己的名字，不给一句通用标签盖过去', () => {
    const html = seeded();
    for (const name of ['青港', '陶烬', '翠晓'])
      expect(html).toContain('<span class="pb-tile__name">' + name + '</span>');
    expect(html).not.toContain('方案色带');
    // 只有选中那一张说 pressed：挡位已经不叠这层，其余方案也不装选中。
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain(
      'data-testid="theme-scheme-slate-harbor" type="button" aria-pressed="true"',
    );
  });

  it('明暗三挡是 radio 组：只说 aria-checked，不再叠一层 aria-pressed', () => {
    const html = seeded();
    expect(html).toContain('role="radiogroup" aria-label="明暗挡位"');
    for (const mode of ['light', 'dark', 'system']) {
      const tile =
        html.match(new RegExp('<button role="radio"[^>]*theme-mode-' + mode + '[^>]*>'))?.[0] ?? '';
      expect(tile).toContain('aria-checked=');
      expect(tile).not.toContain('aria-pressed');
    }
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it('调色段是原生 details：钩子在段落类名上，展开着并画满 36 格的两件控件', () => {
    const html = seeded();
    expect(html).toContain('class="pb-fold theme-studio__palette" open=""');
    expect(html.match(/type="color"/g)).toHaveLength(THEME_TOKENS.length);
    expect(html.match(/-hex"/g)).toHaveLength(THEME_TOKENS.length);
    expect(html).toContain('aria-label="主强调选色"');
    expect(html).toContain('data-testid="theme-token-chart-8-hex"');
  });

  it('内置方案那一面不给删除按钮，撤销预览在没试色时点不动', () => {
    const html = seeded();
    expect(html).not.toContain('data-testid="theme-delete"');
    expect(html).toContain('data-testid="theme-undo-preview" type="button" disabled=""');
    expect(html).toContain('另存为自定义');
  });
});
