/**
 * 网站资源那一份图标：morphicons 2.0.2（已装，MIT）+ Tabler outline 的 17 枚真实字形。
 *
 * 字形数据不是我们画的：assets/tabler-icon-data.json 逐字节来自
 * https://github.com/tabler/tabler-icons @ ed177a085b652fe04ec4f37ced867c94621e7840 的
 * icons/outline/*.svg（17 个原始 SVG 也一起 vendored 在 assets/icons/，逐枚 SHA-256 与
 * 上游 raw URL 记在 source-manifest.json，测试按字节对）。MIT © Paweł Kuna，全文在
 * assets/TABLER-LICENSE.txt；形变引擎的 MIT 在 assets/MORPHICONS-LICENSE.txt。
 *
 * 动效只用 morphicons 自己发布的那几个 preset 名（smooth / snappy / bouncy），不自己写曲线；
 * 线宽用网站上那一格的 2。
 */
import tablerIcons from './assets/tabler-icon-data.json' with { type: 'json' };
import { MorphIcon } from 'morphicons/react';
import type { IconNode } from 'morphicons/react';
import type { JSX } from 'react';

/** vendored 的那一份是纯 JSON；这里只按名字取，缺一枚就是打包出了问题，直接响。 */
const GLYPH_NAMES = [
  'activity',
  'eye',
  'eye-off',
  'info-circle',
  'layout-dashboard',
  'message-circle',
  'microphone',
  'microphone-off',
  'moon',
  'puzzle',
  'robot',
  'shield',
  'shirt',
  'sun',
  'player-pause',
  'player-play',
  'player-stop',
] as const;

export type SiteGlyph = (typeof GLYPH_NAMES)[number];

const raw = tablerIcons as Record<string, unknown>;

function readGlyph(name: SiteGlyph): IconNode {
  const value = raw[name];
  if (!Array.isArray(value)) {
    throw new Error('vendored 的 Tabler 数据里没有这一枚字形：' + name);
  }
  return value as IconNode;
}

/** 17 键的完整表：键型就是这份名单，取值不需要再判 undefined，也不造兜底图形。 */
export const GLYPHS: Readonly<Record<SiteGlyph, IconNode>> = Object.fromEntries(
  GLYPH_NAMES.map((name) => [name, readGlyph(name)]),
) as Record<SiteGlyph, IconNode>;

export const SITE_GLYPH_NAMES: readonly SiteGlyph[] = GLYPH_NAMES;

/** 网站上这一格的两个值：线宽 2、preset 用库里发布的那一个名字。 */
export const SITE_GLYPH_STROKE = 2;
export const SITE_GLYPH_SPRING = 'smooth' as const;

/** 两态一对的那几组：换 icon 那一个值就动起来，中间帧归 morphicons 的那份 spring。 */
export const SITE_GLYPH_PAIRS = {
  visible: ['eye', 'eye-off'],
  recording: ['microphone', 'microphone-off'],
  light: ['sun', 'moon'],
  running: ['player-play', 'player-pause'],
} as const satisfies Readonly<Record<string, readonly [SiteGlyph, SiteGlyph]>>;

export function siteGlyph(name: SiteGlyph): IconNode {
  return GLYPHS[name];
}

interface MorphBase {
  size?: number | undefined;
  className?: string | undefined;
  /** 有名字就给 role="img" + <title>；纯装饰就什么都不传（读屏拿到的是旁边的文字）。 */
  label?: string | undefined;
}

/** 一枚静止的字形（导航、行首标记）。 */
export function SiteGlyphIcon({
  name,
  size,
  className,
  label,
}: MorphBase & { name: SiteGlyph }): JSX.Element {
  return (
    <MorphIcon
      icon={GLYPHS[name]}
      strokeWidth={SITE_GLYPH_STROKE}
      spring={SITE_GLYPH_SPRING}
      reducedMotion="user"
      {...(size === undefined ? {} : { size })}
      {...(className === undefined ? {} : { className })}
      {...(label === undefined ? {} : { label })}
    />
  );
}

export interface SiteMorphProps extends MorphBase {
  /** 两态里此刻的那一态。 */
  active: boolean;
  off: SiteGlyph;
  on: SiteGlyph;
}

/**
 * 一个按钮里的那两态：同一个 MorphIcon，icon 从 off 名换到 on 名，形变由库里发生。
 * 这里不写进度、不自己算中间帧。
 */
export function SiteMorphIcon({
  active,
  off,
  on,
  size,
  className,
  label,
}: SiteMorphProps): JSX.Element {
  return (
    <MorphIcon
      icon={active ? GLYPHS[on] : GLYPHS[off]}
      strokeWidth={SITE_GLYPH_STROKE}
      spring={SITE_GLYPH_SPRING}
      reducedMotion="user"
      {...(size === undefined ? {} : { size })}
      {...(className === undefined ? {} : { className })}
      {...(label === undefined ? {} : { label })}
    />
  );
}
