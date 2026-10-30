/**
 * 登记处守的三件事：五家都在、交付与否如实说、名字与组件对得上。
 *
 * 还有一条是这次返工的原因：新风格不许把 pet bench 那套板件当成自己的控件——
 * 引不引 original-ui/kit 与 start-designs/sections 是能在源码里看出来的事实，就在这里钉住。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { THEME_TOKEN_KEYS } from '../theme.js';
import {
  REVIEW_DEFAULT_FAMILY,
  STYLE_FAMILIES,
  STYLE_FAMILY_ORDER,
  deliveredFamilyIds,
  familyDelivered,
  familySelectorId,
  resolveFamily,
} from './registry.js';
import { FAMILY_TOKEN_KEYS } from './use-family-theme.js';

const NEW_FAMILIES = ['precision', 'hearth', 'folio', 'prism'] as const;

/** 借旧板件画新风格的两条来路：直接引 kit，或引那五个接好线的旧控件。 */
const FORBIDDEN = [
  "from '../original-ui/kit.js'",
  "from '../start-designs/sections.js'",
  'OriginalPetPreview',
  'OriginalThemeStudio',
  'OriginalControlBoard',
  'PBModelForm',
];

function sourceOf(id: string): string | null {
  try {
    return readFileSync(new URL('./' + id + '.tsx', import.meta.url), 'utf8');
  } catch {
    return null;
  }
}

describe('风格家族登记', () => {
  it('五家都在，顺序与 id 对得上，默认落在第一家新风格', () => {
    expect(STYLE_FAMILIES.map((family) => family.id)).toEqual([...STYLE_FAMILY_ORDER]);
    expect(REVIEW_DEFAULT_FAMILY).toBe('precision');
    expect(familySelectorId('hearth')).toBe('style-pick-hearth');
  });

  it('每家有名字与说明：说明讲的是控件与形状，不是配色换了几格', () => {
    for (const family of STYLE_FAMILIES) {
      expect(family.name.length).toBeGreaterThan(1);
      expect(family.description.length).toBeGreaterThan(10);
    }
    expect(resolveFamily(STYLE_FAMILIES, 'nope' as never)).toBeNull();
  });

  it('交付与否如实报：有组件才算，null 那几家不进已交付', () => {
    const delivered = deliveredFamilyIds(STYLE_FAMILIES);
    const missing = STYLE_FAMILY_ORDER.filter((id) => {
      const family = resolveFamily(STYLE_FAMILIES, id);
      return !familyDelivered(family);
    });
    expect([...delivered, ...missing].sort()).toEqual([...STYLE_FAMILY_ORDER].sort());
    // 没交的那一家，源码确实还没进来；交了的那一家，组件是个函数。
    for (const id of missing) expect(sourceOf(id)).toBeNull();
    for (const id of delivered)
      expect(typeof resolveFamily(STYLE_FAMILIES, id)!.Component).toBe('function');
  });

  it('新风格自己画控件：不引 pet bench 板件，也不借旧 Start 控件与样板台', () => {
    const present = NEW_FAMILIES.filter((id) => sourceOf(id as string) !== null);
    expect(present.length).toBeGreaterThan(0);
    for (const id of present) {
      const source = sourceOf(id as string) ?? '';
      for (const needle of FORBIDDEN) {
        expect(source.includes(needle), id + ' 借了旧板件：' + needle).toBe(false);
      }
    }
  });
});

describe('家族种子的词表', () => {
  it('镜像的词表与 theme.ts 那 36 格一模一样：多一格少一格都过不了', () => {
    expect([...FAMILY_TOKEN_KEYS].sort()).toEqual([...THEME_TOKEN_KEYS].sort());
  });
});
