/**
 * 呈现种子守的是「评审看的是这一家的样子，但本机记录一个字节都不动」：
 * 种子只贴在自己那一扇窗上，浅与黑两套各自成立，词表外的格子不算。
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { fallbackPalette } from '../theme.js';
import {
  FAMILY_TOKEN_KEYS,
  declarationsToStyle,
  familySeedDeclarations,
  seedColorsFor,
  useFamilyTheme,
  type FamilyThemeSeed,
} from './use-family-theme.js';
import { previewBubble } from './use-family-preview.js';

const SEED: FamilyThemeSeed = {
  light: { paper: '#ffffff', accent: '#123456', not_a_token: '#000000' } as never,
  dark: { paper: '#101010', accent: '#abcdef', 'ink-soft': '#999999' },
};

/** 一家最小渲染：只要根节点上那一叠声明与那一半明暗。 */
function Probe({ seed }: { seed: FamilyThemeSeed }): ReactElement {
  const theme = useFamilyTheme(seed);
  return (
    <div
      data-testid="probe"
      data-seeded={theme.seeded ? 'true' : 'false'}
      data-scheme={theme.colorScheme}
      data-paper={String((theme.vars as Record<string, string>)['--paper'] ?? '')}
      data-pb-paper={String((theme.vars as Record<string, string>)['--pb-paper'] ?? '')}
    />
  );
}

const writeCalls: string[] = [];
const storageStub = {
  getItem: (key: string): string | null => {
    void key;
    return null;
  },
  setItem: (key: string, value: string): void => {
    writeCalls.push(key + '=' + value);
  },
  removeItem: (key: string): void => {
    void key;
  },
};

afterEach(() => {
  writeCalls.length = 0;
  delete (globalThis as Record<string, unknown>)['localStorage'];
});

describe('呈现种子', () => {
  it('浅与黑两套各自生效：切明暗不换风格，只换这一家自己的那一半', () => {
    expect(seedColorsFor(SEED, 'light').paper).toBe('#ffffff');
    expect(seedColorsFor(SEED, 'dark').paper).toBe('#101010');
    expect(seedColorsFor(SEED, 'dark').accent).toBe('#abcdef');
  });

  it('只认词表里的格子，其余不贴：种子不会变成第二条主题记录', () => {
    const names = familySeedDeclarations(SEED, 'light', fallbackPalette('light')).map(
      (entry) => entry[0],
    );
    expect(names).toContain('--paper');
    expect(names).toContain('--accent');
    expect(names).not.toContain('--not_a_token');
  });

  it('pb 语义层与派生三格一起贴：家族里的板件才真跟着种子走', () => {
    const entries = familySeedDeclarations(SEED, 'light', fallbackPalette('light'));
    const map = new Map(entries);
    expect(map.get('--pb-paper')).toBe('#ffffff');
    expect(map.get('--pb-focus')).toBe('var(--pb-accent-2)');
    expect(map.get('--pk-accent')).toBe('#123456');
    // 没被种子改写的格子保持记录里那一份。
    expect(map.get('--paper-2')).toBe(fallbackPalette('light')['paper-2']);
  });

  it('渲染这一家不写本机：storage 一次都没被调用，根节点拿到的是种子值', () => {
    (globalThis as Record<string, unknown>)['localStorage'] = storageStub;
    const html = renderToStaticMarkup(<Probe seed={SEED} />);
    expect(html).toContain('data-seeded="true"');
    expect(html).toContain('data-paper="#ffffff"');
    expect(html).toContain('data-pb-paper="#ffffff"');
    expect(writeCalls).toEqual([]);
    expect(FAMILY_TOKEN_KEYS.length).toBe(36);
  });

  it('词表外的格子不进 style：declarationsToStyle 只搬运成对的键值', () => {
    const style = declarationsToStyle([['--x', '1px']]);
    expect((style as Record<string, string>)['--x']).toBe('1px');
  });
});

describe('预览的气泡判定', () => {
  it('没报、报 null、报空串都是「此刻没话要说」', () => {
    expect(previewBubble(undefined)).toBeNull();
    expect(previewBubble(null)).toBeNull();
    expect(previewBubble('')).toBeNull();
    expect(previewBubble('我在桌面上站着。')).toBe('我在桌面上站着。');
  });
});
