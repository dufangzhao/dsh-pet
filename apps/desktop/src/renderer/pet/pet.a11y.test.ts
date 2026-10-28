/**
 * 可访问性回归：直接读 pet.css 的真实 token 与真实规则声明，
 * 用 WCAG sRGB 公式复算，不在测试里抄一份颜色常量。
 *
 * 这样做的意义：如果有人把 --pet-accent 调回 #4c7df0，或把按钮的
 * min-height 改回 32px，这里会立刻失败，而不是等人工复验才发现。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  OPAQUE_BLACK,
  OPAQUE_WHITE,
  composite,
  contrastRatio,
  describeContrast,
  parseColor,
  parseCssRules,
  readCustomProperties,
  relativeLuminance,
  resolveColor,
  resolveValue,
  type CssRule,
  type Rgba,
} from './contrast.js';

const CSS_PATH = fileURLToPath(new URL('./pet.css', import.meta.url));
const css = readFileSync(CSS_PATH, 'utf8');
const rules: CssRule[] = parseCssRules(css);
const tokens = readCustomProperties(rules);

/** WCAG 2.2 1.4.3 / 1.4.11 阈值。普通文字 4.5，非文本 3。 */
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

function color(tokenName: string): Rgba {
  const raw = tokens[tokenName];
  expect(raw, '缺少语义 token ' + tokenName).toBeDefined();
  const parsed = parseColor(resolveValue(raw ?? '', tokens));
  expect(parsed, '无法解析 token ' + tokenName + ' = ' + String(raw)).not.toBeNull();
  return parsed as Rgba;
}

/** 半透明表面必须分别按白底与黑底合成后再算：窗口本身是透明的。 */
function surfaces(): { name: string; color: Rgba }[] {
  const surface = color('--pet-surface');
  const strong = color('--pet-surface-strong');
  return [
    { name: '气泡面板(0.94)/白底', color: composite(surface, OPAQUE_WHITE) },
    { name: '气泡面板(0.94)/黑底', color: composite(surface, OPAQUE_BLACK) },
    { name: '主面板(0.98)/白底', color: composite(strong, OPAQUE_WHITE) },
    { name: '主面板(0.98)/黑底', color: composite(strong, OPAQUE_BLACK) },
    { name: '不透明白', color: OPAQUE_WHITE },
  ];
}

/** 选择器归一化：只比较结构，不比较引号风格与空白。 */
function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').replace(/'/g, '"').trim();
}

/** 找到某个选择器的全部规则（大小写、引号、空白都不敏感）。 */
function rulesFor(selector: string): CssRule[] {
  const wanted = normalizeSelector(selector);
  return rules.filter((rule) => normalizeSelector(rule.selector) === wanted);
}

/** 简写属性名到具体属性名：读 border-color 时也要认 border-top-color。 */
const SHORTHAND_ALIASES: Record<string, readonly string[]> = {
  'border-top-color': ['border-top-color', 'border-color', 'border'],
  'border-color': ['border-color', 'border'],
  outline: ['outline'],
  'outline-width': ['outline-width', 'outline'],
  background: ['background', 'background-color'],
  'background-color': ['background-color', 'background'],
};

/** 读取某个选择器上某条声明的真实值（含 var() 展开）。 */
function declaration(selector: string, property: string): string {
  const matched = rulesFor(selector);
  expect(matched.length, '样式表里找不到选择器 ' + selector).toBeGreaterThan(0);
  const names = SHORTHAND_ALIASES[property] ?? [property];
  for (const name of names) {
    for (const rule of matched) {
      const value = rule.declarations[name];
      if (value !== undefined) return value;
    }
  }
  throw new Error(selector + ' 没有声明 ' + property);
}

function declarationColor(selector: string, property: string): Rgba {
  const parsed = resolveColor(declaration(selector, property), tokens);
  expect(parsed, selector + ' 的 ' + property + ' 不是可解析颜色').not.toBeNull();
  return parsed as Rgba;
}

/** 数值型声明（min-height: 44px）转数字。 */
function declarationPx(selector: string, property: string): number {
  const value = declaration(selector, property);
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  expect(match, selector + ' 的 ' + property + ' 不是像素值：' + value).not.toBeNull();
  return Number.parseFloat(match?.[1] ?? 'NaN');
}

describe('sRGB 对比度工具本身可信', () => {
  it('黑白极值为 21:1，同色为 1:1', () => {
    expect(contrastRatio(OPAQUE_WHITE, OPAQUE_BLACK)).toBeCloseTo(21, 5);
    expect(contrastRatio(OPAQUE_WHITE, OPAQUE_WHITE)).toBeCloseTo(1, 10);
  });

  it('复现 qa/V-06-contrast.md 记录的旧值 3.8188759686', () => {
    const accent = parseColor('#4c7df0') as Rgba;
    expect(contrastRatio(OPAQUE_WHITE, accent)).toBeCloseTo(3.8188759686, 8);
  });

  it('半透明颜色先合成再计算，未合成会得到错误的高对比', () => {
    const translucent = parseColor('rgba(0, 0, 0, 0.5)') as Rgba;
    // 50% 黑叠在白底上是中灰，对黑的对比度约 5.28，远低于纯黑的 21。
    const onWhite = composite(translucent, OPAQUE_WHITE);
    const ratio = contrastRatio(OPAQUE_BLACK, onWhite);
    expect(ratio).toBeGreaterThan(5);
    expect(ratio).toBeLessThan(5.5);
    // 反过来对白底约 3.98，同样远低于 21。
    expect(contrastRatio(OPAQUE_WHITE, onWhite)).toBeCloseTo(3.98, 1);
  });

  it('解析 #rgb / #rrggbbaa / rgb() / rgba() 与非法值', () => {
    expect(parseColor('#fff')).toMatchObject({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.50196, 5);
    expect(parseColor('rgb(28, 36, 48)')).toMatchObject({ r: 28, g: 36, b: 48, a: 1 });
    expect(parseColor('rgba(28, 36, 48, 0.14)')?.a).toBeCloseTo(0.14, 6);
    expect(parseColor('rgb(28 36 48 / 50%)')?.a).toBeCloseTo(0.5, 6);
    expect(parseColor('CanvasText')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('rgb(28, 36)')).toBeNull();
    expect(parseColor('rgba(0, 0, 0, 2)')).toBeNull();
  });

  /**
   * 回归：linearize 的断点曾被写成 0.03928（旧版 WCAG 草案值），
   * 正确的 sRGB 分段点是 0.04045。两者之间只夹着 10.0164/255 到 10.3147/255
   * 这一段极窄的分数通道，取 10.2 就落在缝里，能唯一区分两个分支。
   */
  it('分数通道 10.2/255 = 0.04 走线性段（旧断点 0.03928 会走幂函数段）', () => {
    const normalized = 10.2 / 255;
    // 这个通道必须真的落在两个断点之间，否则用例区分不了分支。
    expect(normalized).toBeLessThanOrEqual(0.04045);
    expect(normalized).toBeGreaterThan(0.03928);

    const gray = parseColor('rgb(10.2 10.2 10.2)');
    expect(gray, '分数通道必须能被解析').toMatchObject({ r: 10.2, g: 10.2, b: 10.2, a: 1 });

    const linearSegment = normalized / 12.92;
    const legacyPowerSegment = Math.pow((normalized + 0.055) / 1.055, 2.4);
    // 两个分支的差约 4.76e-7，比断言的容差大两个数量级，足以判定。
    expect(linearSegment - legacyPowerSegment).toBeGreaterThan(4e-7);

    const luminance = relativeLuminance(gray as Rgba);
    expect(luminance).toBeCloseTo(linearSegment, 9);
    // 反向锁死：断点若退回 0.03928，亮度会落在 legacyPowerSegment 上，这一条就会失败。
    expect(
      luminance,
      '断点退回 0.03928 时亮度会是 ' +
        legacyPowerSegment +
        '（幂函数段），而不是线性段的 ' +
        linearSegment,
    ).not.toBeCloseTo(legacyPowerSegment, 7);
  });

  it('11/255 已高于断点，走幂函数段', () => {
    const normalized = 11 / 255;
    expect(normalized).toBeGreaterThan(0.04045);
    const gray = parseColor('rgb(11 11 11)') as Rgba;
    expect(relativeLuminance(gray)).toBeCloseTo(Math.pow((normalized + 0.055) / 1.055, 2.4), 10);
  });
});

/**
 * parseFloat 会把 12junk 截成 12、把 0x10 读成 0、把 10% 当成 10。
 * 颜色解析宁可返回 null（调用方按“解析不了”处理），也不能猜一个近似值：
 * 猜错会让对比度悄悄偏高或偏低，比直接失败更难发现。
 */
describe('颜色解析：数字必须整体合法，分隔符不得混用', () => {
  it('带后缀垃圾或非十进制写法的通道一律拒绝', () => {
    for (const input of [
      'rgb(12junk, 0, 0)',
      'rgb(12px 0 0)',
      'rgb(0x10, 0, 0)',
      'rgb(0 0 12junk)',
      'rgb(1e 0 0)',
      'rgb(. 0 0)',
      'rgb(Infinity 0 0)',
      'rgb(1e999 0 0)',
      'rgb(NaN 0 0)',
      'rgb(12 0 0)junk',
      'rgb(10%junk 0 0)',
      'rgb(10%% 0 0)',
    ]) {
      expect(parseColor(input), input + ' 不应被接受').toBeNull();
    }
  });

  it('百分比按 CSS 语义换算：通道 10% = 25.5，而不是 10', () => {
    expect(parseColor('rgb(10% 10% 10%)')).toMatchObject({ r: 25.5, g: 25.5, b: 25.5, a: 1 });
    expect(parseColor('rgb(100% 0% 0%)')).toMatchObject({ r: 255, g: 0, b: 0, a: 1 });
    // alpha 的百分比同样是 0-100 映射到 0-1，10% 必须是 0.1。
    expect(parseColor('rgba(0, 0, 0, 10%)')?.a).toBeCloseTo(0.1, 10);
    expect(parseColor('rgb(0 0 0 / 25%)')?.a).toBeCloseTo(0.25, 10);
    // 超出各自范围（通道 >100%、alpha >100%）仍然拒绝。
    expect(parseColor('rgb(110% 0 0)')).toBeNull();
    expect(parseColor('rgba(0, 0, 0, 120%)')).toBeNull();
  });

  it('逗号空项、混用分隔符、多余斜杠都拒绝', () => {
    expect(parseColor('rgb(28,,36,48)')).toBeNull();
    expect(parseColor('rgb(28, 36 48)')).toBeNull();
    expect(parseColor('rgb(28, 36, 48 / 50%)')).toBeNull();
    expect(parseColor('rgb(28 36 48 / 50% / 20%)')).toBeNull();
    expect(parseColor('rgb(28 36 48 0.5)')).toBeNull();
    expect(parseColor('rgb()')).toBeNull();
    expect(parseColor('rgb( )')).toBeNull();
  });

  it('收紧后合法写法仍被接受（不误伤真实样式用到的形态）', () => {
    // 逗号旧语法的百分比 alpha：pet.css 里没有，但 CSS 合法，不能误拒。
    expect(parseColor('rgba(28, 36, 48, 50%)')?.a).toBeCloseTo(0.5, 10);
    // 空格新语法里 '/' 两侧可以没有空格。
    expect(parseColor('rgb(28 36 48/0.5)')?.a).toBeCloseTo(0.5, 10);
    expect(parseColor('rgb(28 36 48 / .5)')?.a).toBeCloseTo(0.5, 10);
    // 前导 '+' 与科学计数法是合法十进制，必须整体接受而不是被截断。
    expect(parseColor('rgb(+28 36 48)')).toMatchObject({ r: 28, g: 36, b: 48, a: 1 });
    expect(parseColor('rgb(2.8e1 36 48)')).toMatchObject({ r: 28, g: 36, b: 48, a: 1 });
  });

  it('系统色与未支持的函数返回 null，不偷偷回退到默认色', () => {
    for (const input of [
      'CanvasText',
      'Canvas',
      'GrayText',
      'Highlight',
      'ButtonText',
      'currentColor',
      'transparent',
      'hsl(210 40% 50%)',
      'color(display-p3 1 0 0)',
    ]) {
      expect(parseColor(input), input + ' 不是本工具支持的写法').toBeNull();
    }
  });
});

describe('普通文字对比度：读真实 token', () => {
  it('主文字 --pet-ink 在所有面板合成底色上都 >= 4.5', () => {
    const ink = color('--pet-ink');
    for (const surface of surfaces()) {
      const ratio = contrastRatio(ink, surface.color);
      expect(
        ratio,
        describeContrast('--pet-ink on ' + surface.name, ratio, TEXT_MIN),
      ).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it('次要文字 --pet-ink-soft 在所有面板合成底色上都 >= 4.5', () => {
    const soft = color('--pet-ink-soft');
    for (const surface of surfaces()) {
      const ratio = contrastRatio(soft, surface.color);
      expect(
        ratio,
        describeContrast('--pet-ink-soft on ' + surface.name, ratio, TEXT_MIN),
      ).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it('禁用态文字 --pet-ink-muted 在禁用底色上仍 >= 4.5（不再用 opacity 压暗）', () => {
    const muted = color('--pet-ink-muted');
    const disabledBackground = declarationColor('.pet-menu__quit:disabled', 'background');
    const ratio = contrastRatio(muted, disabledBackground);
    expect(ratio, describeContrast('禁用文字', ratio, TEXT_MIN)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('主选项文字（真实规则 color）对真实背景 --pet-accent >= 4.5', () => {
    const primary = '.pet-dialog__choice[data-primary="true"]';
    const active = declarationColor(primary, 'color');
    const background = declarationColor(primary, 'background');
    const ratio = contrastRatio(active, background);
    expect(ratio, describeContrast('主选项文字', ratio, TEXT_MIN)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('主选项悬停底色上的文字仍 >= 4.5', () => {
    const primary = '.pet-dialog__choice[data-primary="true"]';
    const active = declarationColor(primary, 'color');
    const hoverBackground = declarationColor(
      '.pet-dialog__choice[data-primary="true"]:hover:not(:disabled)',
      'background',
    );
    const ratio = contrastRatio(active, hoverBackground);
    expect(ratio, describeContrast('主选项悬停文字', ratio, TEXT_MIN)).toBeGreaterThanOrEqual(
      TEXT_MIN,
    );
  });

  it('普通按钮悬停（--pet-accent-wash）上的文字仍 >= 4.5', () => {
    const ink = color('--pet-ink');
    const wash = color('--pet-accent-wash');
    const ratio = contrastRatio(ink, wash);
    expect(ratio, describeContrast('悬停文字', ratio, TEXT_MIN)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('错误提示文字在 --pet-error-soft 上 >= 4.5（旧值 4.396 已修）', () => {
    const error = color('--pet-error');
    const soft = color('--pet-error-soft');
    const ratio = contrastRatio(error, soft);
    expect(ratio, describeContrast('错误提示', ratio, TEXT_MIN)).toBeGreaterThanOrEqual(TEXT_MIN);
    // 半透明面板里的错误提示：soft 是实色，直接对黑底合成即可。
    const onBlack = contrastRatio(error, composite(soft, OPAQUE_BLACK));
    expect(onBlack, describeContrast('错误提示/黑底', onBlack, TEXT_MIN)).toBeGreaterThanOrEqual(
      TEXT_MIN,
    );
  });

  it('notice 与 hint 的真实 color 对真实 background 都 >= 4.5', () => {
    const pairs: [string, string, string][] = [
      ['.pet-root__notice', 'color', 'background'],
      ['.pet-menu__error', 'color', 'background'],
      ['.pet-dialog__hint', 'color', '--panel'],
    ];
    const panel = composite(color('--pet-surface-strong'), OPAQUE_BLACK);
    for (const [selector, colorProperty, backgroundProperty] of pairs) {
      const foreground = declarationColor(selector, colorProperty);
      const background =
        backgroundProperty === '--panel' ? panel : declarationColor(selector, backgroundProperty);
      const ratio = contrastRatio(foreground, background);
      expect(ratio, describeContrast(selector, ratio, TEXT_MIN)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });
});

describe('非文本对比度：控件边界与焦点环', () => {
  it('按钮边界 --pet-control-line 对白底与黑底合成面板都 >= 3', () => {
    const line = color('--pet-control-line');
    for (const surface of surfaces()) {
      const ratio = contrastRatio(line, surface.color);
      expect(
        ratio,
        describeContrast('控件边界 on ' + surface.name, ratio, NON_TEXT_MIN),
      ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    }
  });

  it('退出按钮边界对白底与错误软底都 >= 3', () => {
    const line = declarationColor('.pet-menu__quit', 'border-color');
    const onWhite = contrastRatio(line, OPAQUE_WHITE);
    expect(
      onWhite,
      describeContrast('退出边界/白底', onWhite, NON_TEXT_MIN),
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    const onErrorSoft = contrastRatio(line, color('--pet-error-soft'));
    expect(
      onErrorSoft,
      describeContrast('退出边界/错误软底', onErrorSoft, NON_TEXT_MIN),
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  it('禁用按钮边界对自身底色仍 >= 3（禁用不等于看不见）', () => {
    const line = declarationColor('.pet-menu__quit:disabled', 'border-color');
    const background = declarationColor('.pet-menu__quit:disabled', 'background');
    const ratio = contrastRatio(line, background);
    expect(ratio, describeContrast('禁用边界', ratio, NON_TEXT_MIN)).toBeGreaterThanOrEqual(
      NON_TEXT_MIN,
    );
    // 也不能靠 opacity 把整块压暗来“表示禁用”。
    const disabledRule = rulesFor('.pet-menu__quit:disabled')[0];
    expect(disabledRule?.declarations['opacity']).toBeUndefined();
  });

  it('焦点环 --pet-focus 对白底、黑底合成面板都 >= 3', () => {
    const focus = color('--pet-focus');
    for (const surface of surfaces()) {
      const ratio = contrastRatio(focus, surface.color);
      expect(
        ratio,
        describeContrast('焦点环 on ' + surface.name, ratio, NON_TEXT_MIN),
      ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    }
  });

  it('焦点环是 outline 且 offset 为正，环落在按钮外侧的面板底色上', () => {
    const outline = declaration('.pet-menu__button:focus-visible', 'outline');
    expect(outline).toContain('solid');
    // outline 简写里的第一段是宽度。
    const widthMatch = /^(\d+(?:\.\d+)?)px/.exec(outline);
    expect(widthMatch, '焦点环宽度无法解析：' + outline).not.toBeNull();
    expect(Number.parseFloat(widthMatch?.[1] ?? '0')).toBeGreaterThanOrEqual(2);
    const offset = declarationPx('.pet-menu__button:focus-visible', 'outline-offset');
    expect(offset).toBeGreaterThan(0);
    // 焦点环颜色必须来自 --pet-focus（已单独校验对比度），不能是随手写的色值。
    expect(outline).toContain('var(--pet-focus)');
  });
});

describe('颜色方向与语义 token 约束', () => {
  it('主色仍是蓝色系：蓝通道明显高于红通道', () => {
    const accent = color('--pet-accent');
    expect(accent.b).toBeGreaterThan(accent.r + 60);
    expect(accent.b).toBeGreaterThan(accent.g + 30);
  });

  it('错误色仍是暖橙色系：红通道明显高于蓝通道', () => {
    const error = color('--pet-error');
    expect(error.r).toBeGreaterThan(error.b + 80);
    expect(error.r).toBeGreaterThan(error.g + 60);
  });

  it('旧的 pet-accent #4c7df0 不再被任何 token 使用', () => {
    for (const [name, value] of Object.entries(tokens)) {
      expect(value.toLowerCase(), name + ' 仍在使用旧的 #4c7df0').not.toContain('#4c7df0');
    }
  });
});

describe('可点区域与字号：读真实声明', () => {
  it('每类真实控件的 min-height / min-width 实际达到 44px', () => {
    for (const selector of [
      '.pet-dialog__choice',
      '.pet-menu__button',
      '.pet-menu__quit',
      '.pet-composer__send',
      '.pet-root__retry',
    ]) {
      const minHeight = declarationPx(selector, 'min-height');
      const minWidth = declarationPx(selector, 'min-width');
      expect(minHeight, selector + ' 的 min-height').toBeGreaterThanOrEqual(44);
      expect(minWidth, selector + ' 的 min-width').toBeGreaterThanOrEqual(44);
    }
  });

  it('注释里不再出现与实现不符的 44 声明', () => {
    // 旧注释写着“至少 44×44”，而 min-height 是 32px。现在注释与实现必须一致。
    expect(css).not.toMatch(/min-height:\s*32px/);
  });

  it('所有可见文字字号 >= 12px', () => {
    const selectors = [
      '.pet-bubble',
      '.pet-composer__label',
      '.pet-dialog__title',
      '.pet-dialog__hint',
      '.pet-menu__name',
      '.pet-menu__button',
      '.pet-menu__quit',
      '.pet-root__notice',
    ];
    for (const selector of selectors) {
      const size = declarationPx(selector, 'font-size');
      expect(size, selector + ' 的字号').toBeGreaterThanOrEqual(12);
    }
  });

  it('减少动态效果与强制色彩模式仍有显式规则', () => {
    const reduced = rules.filter((rule) =>
      rule.conditions.some((condition) => condition.includes('prefers-reduced-motion')),
    );
    expect(reduced.length).toBeGreaterThan(0);
    const forced = rules.filter((rule) =>
      rule.conditions.some((condition) => condition.includes('forced-colors')),
    );
    expect(forced.length).toBeGreaterThan(0);
    // 强制色彩模式下不能用自定义色覆盖系统色。
    const forcedColors = forced.flatMap((rule) =>
      Object.entries(rule.declarations).filter(([property]) => property === 'color'),
    );
    for (const [, value] of forcedColors) {
      expect(value).toMatch(/CanvasText|GrayText|Highlight|Canvas/);
    }
  });

  it('腮红出现时一定看得见：没有规则把它藏掉（含减少动画档）', () => {
    const blushRules = rules.filter((rule) =>
      normalizeSelector(rule.selector).includes('.pet-avatar__blush'),
    );
    expect(blushRules.length, '缺少 .pet-avatar__blush 规则').toBeGreaterThan(0);
    for (const rule of blushRules) {
      const condition = rule.conditions.join(' ') || '无条件';
      expect(
        rule.declarations['display'],
        rule.selector + ' 在 ' + condition + ' 下用 display 藏掉了腮红',
      ).not.toBe('none');
      expect(
        rule.declarations['visibility'],
        rule.selector + ' 在 ' + condition + ' 下用 visibility 藏掉了腮红',
      ).not.toBe('hidden');
      expect(
        rule.declarations['opacity'],
        rule.selector + ' 在 ' + condition + ' 下把腮红压成全透明',
      ).not.toBe('0');
    }
  });

  it('样式表不引用远端字体、图片或网络地址', () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toContain('@font-face');
  });
});

/**
 * 气泡是已确认的视觉反馈，不是可选的装饰。
 *
 * 背景：上一轮为了把 253×280 塞进一屏，在 @media (max-width: 279px) 里把 .pet-bubble
 * 改成 position:absolute + width/height:1px + clip-path:inset(50%)，只保留 aria-live。
 * 主会话明确不接受——读屏播报不能代替屏幕上的气泡。这些用例就是那次的回归：
 * 任何人再用 1×1 / clip-path / display:none / visibility:hidden / 透明 / 移出屏幕
 * 把气泡“藏起来”，这里立刻失败。
 */
describe('气泡在任何视口都必须真实可见', () => {
  /** 取所有作用于气泡的规则（含 .pet-bubble--error 这类状态变体）。 */
  function bubbleRules(): CssRule[] {
    return rules.filter((rule) => {
      const selector = normalizeSelector(rule.selector);
      return selector === '.pet-bubble' || selector.startsWith('.pet-bubble');
    });
  }

  it('样式表里确实存在 .pet-bubble 基础规则（不是被整段删掉）', () => {
    const base = rules.filter((rule) => normalizeSelector(rule.selector) === '.pet-bubble');
    expect(base.length, '缺少 .pet-bubble 基础规则').toBeGreaterThan(0);
    // 基础规则必须无条件生效，不能只在某个媒体查询里定义。
    expect(base.some((rule) => rule.conditions.length === 0)).toBe(true);
  });

  it('任何规则都不把气泡的宽或高压到 1px 及以下', () => {
    for (const rule of bubbleRules()) {
      const condition = rule.conditions.join(' ') || '无条件';
      for (const property of ['width', 'height', 'max-width', 'max-height']) {
        const value = rule.declarations[property];
        if (value === undefined) continue;
        const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
        if (match === null) continue;
        const pixels = Number.parseFloat(match[1] ?? 'NaN');
        expect(
          pixels,
          rule.selector +
            ' 在 ' +
            condition +
            ' 下把 ' +
            property +
            ' 压到 ' +
            value +
            '，气泡会被隐藏',
        ).toBeGreaterThan(1);
      }
    }
  });

  it('任何规则都不用 clip-path / display:none / visibility:hidden / 绝对定位藏气泡', () => {
    for (const rule of bubbleRules()) {
      const condition = rule.conditions.join(' ') || '无条件';
      const clipPath = rule.declarations['clip-path'];
      if (clipPath !== undefined) {
        expect(
          clipPath,
          rule.selector + ' 在 ' + condition + ' 下用了 clip-path: ' + clipPath,
        ).toBe('none');
      }
      expect(
        rule.declarations['clip'],
        rule.selector + ' 在 ' + condition + ' 下用了 clip',
      ).toBeUndefined();
      expect(
        rule.declarations['display'],
        rule.selector + ' 在 ' + condition + ' 下用 display 隐藏了气泡',
      ).not.toBe('none');
      expect(
        rule.declarations['visibility'],
        rule.selector + ' 在 ' + condition + ' 下用 visibility 隐藏了气泡',
      ).not.toBe('hidden');
      // 绝对定位是上一轮“1×1 视觉隐藏”配方的一半，气泡必须留在正常流里占位。
      expect(
        rule.declarations['position'],
        rule.selector +
          ' 在 ' +
          condition +
          ' 下被移出正常流（position: ' +
          String(rule.declarations['position']) +
          '）',
      ).not.toBe('absolute');
    }
  });

  it('任何规则都不把气泡缩到不可见（opacity 0 / 移出屏幕）', () => {
    for (const rule of bubbleRules()) {
      const condition = rule.conditions.join(' ') || '无条件';
      const opacity = rule.declarations['opacity'];
      if (opacity !== undefined) {
        expect(
          Number.parseFloat(opacity),
          rule.selector + ' 在 ' + condition + ' 下把 opacity 压到 ' + opacity,
        ).toBeGreaterThan(0);
      }
      for (const property of ['text-indent', 'left', 'top']) {
        const value = rule.declarations[property];
        if (value === undefined) continue;
        // 只看“把元素推出可视区”的写法：绝对值很大的负位移。
        const pixels = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
        if (pixels === null) continue;
        expect(
          Number.parseFloat(pixels[1] ?? '0'),
          rule.selector +
            ' 在 ' +
            condition +
            ' 下用 ' +
            property +
            ': ' +
            value +
            ' 把气泡移出可视区',
        ).toBeGreaterThan(-1000);
      }
    }
  });

  it('气泡正文不截断、不禁用换行（必须完整换行显示）', () => {
    for (const rule of rules) {
      if (normalizeSelector(rule.selector) !== '.pet-bubble__text') continue;
      const condition = rule.conditions.join(' ') || '无条件';
      expect(
        rule.declarations['text-overflow'],
        rule.selector + ' 在 ' + condition + ' 下用了 text-overflow 截断气泡文案',
      ).not.toBe('ellipsis');
      expect(
        rule.declarations['white-space'],
        rule.selector + ' 在 ' + condition + ' 下用 white-space 禁止气泡换行',
      ).not.toBe('nowrap');
    }
  });

  it('全局范围内不存在 clip-path: inset(50%) 这类视觉隐藏写法', () => {
    for (const rule of rules) {
      const clipPath = rule.declarations['clip-path'];
      if (clipPath === undefined) continue;
      expect(
        clipPath.replace(/\s+/g, ''),
        rule.selector + ' 使用了 clip-path: ' + clipPath,
      ).not.toContain('inset(50%)');
    }
  });
});

/**
 * 退出按钮与错误提示是“必要信息”，任何档位都不许藏。
 * 与气泡同理：这些不是装饰，不能为了腾空间被 display:none 掉。
 */
describe('退出按钮与错误提示在任何视口都不得隐藏', () => {
  const PROTECTED = ['.pet-menu__quit', '.pet-root__notice'];

  it('受保护元素没有被任何规则设成 display:none / visibility:hidden', () => {
    for (const rule of rules) {
      const selector = normalizeSelector(rule.selector);
      const isProtected = PROTECTED.some(
        (wanted) => selector === wanted || selector.startsWith(wanted + ':'),
      );
      if (!isProtected) continue;
      const condition = rule.conditions.join(' ') || '无条件';
      expect(
        rule.declarations['display'],
        selector + ' 在 ' + condition + ' 下被 display:none',
      ).not.toBe('none');
      expect(
        rule.declarations['visibility'],
        selector + ' 在 ' + condition + ' 下被 visibility:hidden',
      ).not.toBe('hidden');
    }
  });

  it('受保护元素的基础规则存在且无条件生效', () => {
    for (const selector of PROTECTED) {
      const matched = rules.filter((rule) => normalizeSelector(rule.selector) === selector);
      expect(matched.length, '缺少 ' + selector + ' 基础规则').toBeGreaterThan(0);
      expect(
        matched.some((rule) => rule.conditions.length === 0),
        selector + ' 只在媒体查询里定义，正常窗口下会没有样式',
      ).toBe(true);
    }
  });
});

/**
 * 253×280 档（CSS 视口 < 280px）的取舍必须写死在样式里，而不是靠人记住：
 * 空间确实装不下全部内容，于是可操作提示（.pet-dialog）自己限高滚动，
 * 菜单与退出留在滚动区外，角色缩到 56px 与气泡并排。若以后有人把提示的
 * 自身滚动去掉，这里会失败。
 */
describe('极小视口：只有提示自己滚动，菜单与退出不藏', () => {
  function narrowRules(selector: string): CssRule[] {
    return rules.filter(
      (rule) =>
        normalizeSelector(rule.selector) === selector &&
        rule.conditions.some((condition) => condition.includes('max-width: 279px')),
    );
  }

  it('存在 max-width: 279px 的媒体查询', () => {
    expect(rules.some((rule) => rule.conditions.some((c) => c.includes('max-width: 279px')))).toBe(
      true,
    );
  });

  it('提示自己限高并纵向滚动，内容不会被顶出窗口', () => {
    const base = rulesFor('.pet-dialog')[0];
    expect(base?.declarations['overflow-y']).toBe('auto');
    expect(base?.declarations['max-height']).toMatch(/^\d+px$/);
    // 窄档只调预算，不换滚动方式：提示仍是可滚动的整块。
    const narrow = narrowRules('.pet-dialog');
    expect(narrow.length, '279px 档缺少 .pet-dialog 规则').toBeGreaterThan(0);
    expect(narrow.some((rule) => rule.declarations['max-height'] === '210px')).toBe(true);
  });

  it('菜单自己不是滚动容器，退出按钮不会随内容被卷走', () => {
    for (const selector of ['.pet-menu', '.pet-root__panel']) {
      for (const rule of rules) {
        if (normalizeSelector(rule.selector) !== selector) continue;
        expect(
          rule.declarations['overflow-y'],
          selector + ' 自己开了纵向滚动，退出按钮会被卷进滚动内容里',
        ).not.toBe('auto');
      }
    }
    // 窄档必须允许面板被压缩，并把高度让给提示自己的滚动。
    expect(
      narrowRules('.pet-root__panel').some((rule) => rule.declarations['min-height'] === '0'),
    ).toBe(true);
  });

  it('退出按钮不用 sticky/absolute/fixed 浮起来盖住提示', () => {
    // 回归：sticky 吸底会让退出按钮浮在滚动内容上方，等于降低点击目标。
    for (const rule of rules) {
      if (normalizeSelector(rule.selector) !== '.pet-menu__quit') continue;
      const condition = rule.conditions.join(' ') || '无条件';
      const position = rule.declarations['position'];
      if (position === undefined) continue;
      expect(
        ['sticky', 'absolute', 'fixed'],
        '.pet-menu__quit 在 ' +
          condition +
          ' 下用 position: ' +
          position +
          ' 脱离正常流，会盖住滚动内容',
      ).not.toContain(position);
    }
  });

  it('矮视口（宽而矮）也有兜底，不靠按宽度分档漏掉', () => {
    // 回归：281×280、360×280 这类视口既不命中 279px 档，又装不下全部内容。
    // 按高度补一档，只收紧高度预算，不改布局形态。
    const shortTier = rules.filter((rule) =>
      rule.conditions.some((condition) => condition.includes('max-height: 380px')),
    );
    expect(shortTier.length, '缺少矮视口兜底媒体查询').toBeGreaterThan(0);
    const panel = shortTier.filter(
      (rule) => normalizeSelector(rule.selector) === '.pet-root__panel',
    );
    expect(
      panel.some((rule) => rule.declarations['min-height'] === '0'),
      '矮视口下菜单面板仍不可压缩',
    ).toBe(true);
    const dialog = shortTier.filter((rule) => normalizeSelector(rule.selector) === '.pet-dialog');
    expect(
      dialog.some((rule) => rule.declarations['max-height'] === '190px'),
      '矮视口下提示没有收紧高度预算',
    ).toBe(true);
    // 正常 380×420 的高度是 420 > 380，这一档不会命中，正常窗口行为不受影响。
    expect(380).toBeLessThan(420);
  });

  it('角色与菜单是同一个 flex 列里的两块，菜单永远排在最下面', () => {
    const root = rulesFor('.pet-root')[0];
    expect(root?.declarations['display']).toBe('flex');
    expect(root?.declarations['flex-direction']).toBe('column');
    // 面板自己也是 flex 列：菜单、提示条、重读按钮纵向排布并允许收缩。
    const panel = rulesFor('.pet-root__panel');
    expect(
      panel.some(
        (rule) =>
          rule.declarations['display'] === 'flex' &&
          rule.declarations['flex-direction'] === 'column',
      ),
    ).toBe(true);
  });
});
