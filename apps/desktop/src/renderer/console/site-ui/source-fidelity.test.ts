/**
 * 来源保真：vendored 的字节、适配后的 CSS 里那些原件记号、17 枚字形的数据对等，
 * 以及配色归属那三档的判定。这些断言盯的是真会塌的地方——
 * 上游文件被人顺手「整理」过、适配时把 4px 硬投影或 -32px 位移写丢了、
 * 字形数据与 vendored SVG 不再是同一份、正常入口悄悄用回旧 PB 配色。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { GLYPHS, SITE_GLYPH_NAMES } from './site-icons.js';
import { RAW_SOURCES, RAW_SOURCE_ORDER, type RawSourceSlug } from './raw-source.js';
import {
  BUILTIN_PALETTES,
  DEFAULT_SCHEME_ID,
  currentScheme,
  fallbackPalette,
  type StoredTheme,
} from '../theme.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const text = (relative: string): string => readFileSync(path.join(here, relative), 'utf8');
const digest = (file: string): string =>
  createHash('sha256')
    .update(readFileSync(path.join(here, file)))
    .digest('hex');

const manifest = JSON.parse(text('./source-manifest.json')) as {
  controls: {
    items: Array<{
      slug: string;
      vendoredFile: string;
      sha256: string;
      bytes: number;
      adapter: { reactFile: string };
    }>;
  };
  icons: {
    items: Array<{ name: string; vendoredSvgFile: string; sha256: string; nodeCount: number }>;
  };
};

const css = text('./source-controls.css');

/** 取某条选择器的那一段声明（到下一个 } 为止），用来盯一句声明有没有被顺手改掉。 */
function cSlice(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error('CSS 里找不到这一段：' + selector);
  const end = source.indexOf('}', start);
  return source.slice(start, end < 0 ? undefined : end);
}

describe('vendored 原件的字节与登记', () => {
  it('五件原件的 SHA-256 与 source-manifest 记的一致（顺手改过就红）', () => {
    for (const item of manifest.controls.items) {
      expect(digest(item.vendoredFile), item.slug).toBe(item.sha256);
      // manifest 记的是字节数：这里也按字节比，别拿字符数当长度
      expect(readFileSync(path.join(here, item.vendoredFile)).length).toBe(item.bytes);
    }
  });

  it('?raw 读进来的就是那些字节，不是重新打过一遍', () => {
    for (const slug of RAW_SOURCE_ORDER) {
      const entry = RAW_SOURCES[slug];
      expect(entry.source).toBe(text('./' + entry.vendoredFile));
      expect(entry.source).toContain('From Uiverse.io by andrew-demchenk0');
    }
  });

  it('许可证与逐件说明都在包里，接到的文件都登记了', () => {
    expect(text('./upstream/LICENSE.md')).toContain('Permission is hereby granted, free of charge');
    for (const item of manifest.controls.items) {
      expect(text('./upstream/notices/' + item.slug + '.md')).toContain(item.sha256);
      if (item.adapter.reactFile !== '') expect(text('./' + item.adapter.reactFile)).not.toBe('');
    }
  });
});

describe('适配后的 CSS 仍带着原件的那几个记号', () => {
  /* 每一条都能在 vendored 原件里找到同一句：数字与写法都不许漂。 */
  const kept: readonly (readonly [RawSourceSlug, string])[] = [
    ['afraid-squid-51', 'box-shadow: 4px 4px var(--main-color)'],
    ['afraid-squid-51', 'transform: translate(3px, 3px)'],
    ['afraid-squid-51', 'border-radius: 5px'],
    ['afraid-squid-51', 'height: 40px'],
    ['afraid-squid-51', 'font-size: 17px'],
    ['polite-stingray-67', 'padding: 5px 10px'],
    ['polite-stingray-67', 'font-size: 15px'],
    ['polite-stingray-67', 'opacity: 0.8'],
    ['empty-penguin-100', 'border-radius: 100px'],
    ['empty-penguin-100', 'width: 70px'],
    ['empty-penguin-100', 'height: 36px'],
    ['empty-penguin-100', 'translateX(-32px)'],
    ['empty-penguin-100', 'translateX(32px)'],
    ['empty-penguin-100', 'line-height: 25px'],
    ['empty-penguin-100', 'transition: 0.3s'],
    ['stupid-seahorse-9', 'border-radius: 34px'],
    ['stupid-seahorse-9', 'background-color: var(--main-color)'],
    /* 输入栏的外高：上游是 content-box（40 内容 + 上下 5 内边距 + 2 描边 = 54），本站按 border-box 统一成 40 */
    ['polite-stingray-67', 'height: 40px'],
  ];

  for (const [slug, declaration] of kept) {
    it(slug + ' 的「' + declaration + '」在原件与适配里是同一句', () => {
      expect(RAW_SOURCES[slug].source).toContain(declaration);
      expect(css).toContain(declaration);
    });
  }

  it('六个 token 名沿用上游，值先给上游字面量', () => {
    for (const name of [
      '--main-color',
      '--font-color',
      '--font-color-sub',
      '--bg-color',
      '--input-focus',
      '--input-out-of-focus',
    ]) {
      expect(
        RAW_SOURCES['afraid-squid-51'].source +
          RAW_SOURCES['polite-stingray-67'].source +
          RAW_SOURCES['empty-penguin-100'].source,
      ).toContain(name);
      expect(css).toContain(name);
    }
    // 适配里那一份上游字面量仍在：作为 var() 的兜底写在同一行
    expect(css).toContain('#fff');
    expect(css).toContain('#323232');
    expect(css).toContain('#2d8cf0');
  });
});

describe('窄栏里那一条选项组与选中瓦片的可读性', () => {
  const extensions = text('./source-extensions.css');

  it('那一横条被所在栏管住：容器按块级受宽，原件的 250 与 36/34/2/4 一个不动', () => {
    const field = cSlice(css, '.su-choice-field {');
    // 容器自己：块级 + 受宽 + 让出投影那 4px（形式不重要，重要是它不再按内容撑出去）
    expect(field).toContain('display: block');
    expect(field).toContain('min-width: 0');
    expect(field).toContain('max-width: 100%');
    expect(field).toContain('padding: 0 4px 4px 0');
    expect(cSlice(css, '.su-choice-field__legend {')).toContain('margin: 0 0 6px');
    // 原件那一横条：够宽时仍是那 250×36、34px 端圆、2px 描边、4px 4px 硬投影
    const bar = cSlice(css, '.su-choice {');
    expect(bar).toContain('width: 250px');
    expect(bar).toContain('max-width: 100%');
    expect(bar).toContain('height: 36px');
    expect(bar).toContain('border-radius: 34px');
    expect(bar).toContain('border: 2px solid var(--main-color)');
    expect(bar).toContain('box-shadow: 4px 4px var(--main-color)');
  });

  it('选中那一格的副文跟着原件的选中前景走，不留在 #666', () => {
    const note = cSlice(extensions, ".su-tile[data-selected='true'] .su-tile__note {");
    expect(note).toContain('color: var(--bg-color);');
    expect(note).not.toContain('color: var(--bg-color-alt)');
  });
});

describe('17 枚字形就是 vendored 的那一份数据', () => {
  it('逐枚 IconNode 的 d 与原始 SVG 一致，数量与 nodeCount 一致', () => {
    expect(SITE_GLYPH_NAMES).toHaveLength(17);
    for (const item of manifest.icons.items) {
      const svg = text('./' + item.vendoredSvgFile);
      expect(digest(item.vendoredSvgFile), item.name).toBe(item.sha256);
      const ds = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1] as string);
      const fromData = (
        GLYPHS[item.name as keyof typeof GLYPHS] as readonly (readonly [string, { d?: string }])[]
      )
        .filter((node) => node[0] === 'path')
        .map((node) => node[1].d as string);
      expect(fromData, item.name).toEqual(ds);
      expect(GLYPHS[item.name as keyof typeof GLYPHS]).toHaveLength(item.nodeCount);
    }
  });
});

describe('界面上的那一份就是记录里的那一份', () => {
  const sourceLight = BUILTIN_PALETTES[DEFAULT_SCHEME_ID]?.['light'];
  if (sourceLight === undefined) throw new Error('默认那条内置方案读不到');

  it('默认方案落的槽就是上游那六个字面量', () => {
    expect(sourceLight['sheet']).toBe('#fff');
    expect(sourceLight['ink']).toBe('#323232');
    expect(sourceLight['line-strong']).toBe('#323232');
    expect(sourceLight['ink-dim']).toBe('#666');
    expect(sourceLight['accent']).toBe('#2d8cf0');
    expect(sourceLight['line']).toBe('#ccc');
  });

  it('六个 token 读的就是这些槽，兜底写的是同一份上游字面量', () => {
    const read: readonly (readonly [string, string])[] = [
      ['--bg-color', 'var(--sheet, #fff)'],
      ['--font-color', 'var(--ink, #323232)'],
      ['--main-color', 'var(--line-strong, #323232)'],
      ['--font-color-sub', 'var(--ink-dim, #666)'],
      ['--input-focus', 'var(--accent, #2d8cf0)'],
      ['--input-out-of-focus', 'var(--line, #ccc)'],
    ];
    for (const [token, declaration] of read) {
      expect(css, token).toContain(token + ': ' + declaration);
    }
  });

  it('换一条内置方案、选一条自定义，读到的就是那一条自己的值（没有分支盖回去）', () => {
    const other: StoredTheme = { selectedId: 'jade-dawn', mode: 'light', custom: [] };
    expect(currentScheme(other).palettes.light).not.toEqual(sourceLight);
    const mine: StoredTheme = {
      selectedId: 'custom-1',
      mode: 'light',
      custom: [
        {
          id: 'custom-1',
          name: '我的',
          note: '',
          palettes: { light: { sheet: '#123456' }, dark: {} },
          custom: true,
        },
      ],
    };
    expect(currentScheme(mine).palettes.light['sheet']).toBe('#123456');
    // 记录里没写全的格子由回退表补齐——那也是这一条方案自己的回退，不是第二套配色
    expect(fallbackPalette('light')['accent']).toBe(sourceLight['accent']);
  });
});
