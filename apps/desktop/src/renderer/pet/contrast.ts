/**
 * sRGB 对比度工具：纯函数，不依赖 DOM、不读浏览器、不引第三方库。
 *
 * 存在意义：让“改了颜色但没改测试”一定失败。测试从这里读取 pet.css 的
 * 真实 token 与真实规则声明，再按 WCAG 2.x 的相对亮度公式复算，
 * 而不是在测试里抄一份颜色常量。
 *
 * 公式与边界（WCAG 2.2）：
 * - 线性化：c/255 <= 0.04045 时 c/12.92，否则 ((c+0.055)/1.055)^2.4；
 *   0.04045 是 sRGB 规范的分段点（约 10.3/255），低于它的通道走线性段；
 * - 相对亮度：0.2126R + 0.7152G + 0.0722B；
 * - 对比度：(Lmax + 0.05) / (Lmin + 0.05)。
 * - 半透明颜色必须先合成到不透明背景上再算，否则对比度没有意义。
 */

export interface Rgba {
  /** 0-255 */
  readonly r: number;
  /** 0-255 */
  readonly g: number;
  /** 0-255 */
  readonly b: number;
  /** 0-1 */
  readonly a: number;
}

export const OPAQUE_WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
export const OPAQUE_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

const HEX_PATTERN = /^#([0-9a-f]+)$/i;
const RGB_PATTERN = /^rgba?\(([^()]*)\)$/i;

function parseHexDigits(digits: string): Rgba | null {
  const expanded =
    digits.length === 3 || digits.length === 4
      ? digits
          .split('')
          .map((character) => character + character)
          .join('')
      : digits;
  if (expanded.length !== 6 && expanded.length !== 8) return null;
  const channels: number[] = [];
  for (const offset of [0, 2, 4]) {
    const value = Number.parseInt(expanded.slice(offset, offset + 2), 16);
    if (Number.isNaN(value)) return null;
    channels.push(value);
  }
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  return {
    r: channels[0] ?? 0,
    g: channels[1] ?? 0,
    b: channels[2] ?? 0,
    a: alpha,
  };
}

/**
 * CSS 十进制数：必须整体匹配。
 * parseFloat 会把 12junk 截成 12、把 0x10 读成 0，这里一律拒绝。
 */
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseDecimal(token: string): number | null {
  if (!DECIMAL_PATTERN.test(token)) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/** 通道：0-255 的十进制数，或 0-100 的百分比（按 CSS 语义换算到 0-255）。 */
function toChannel(token: string): number | null {
  const trimmed = token.trim();
  const percent = trimmed.endsWith('%');
  const value = parseDecimal(percent ? trimmed.slice(0, -1) : trimmed);
  if (value === null) return null;
  const channel = percent ? (value * 255) / 100 : value;
  return channel >= 0 && channel <= 255 ? channel : null;
}

/** alpha：0-1 的十进制数，或 0-100 的百分比。 */
function toAlpha(token: string): number | null {
  const trimmed = token.trim();
  const percent = trimmed.endsWith('%');
  const value = parseDecimal(percent ? trimmed.slice(0, -1) : trimmed);
  if (value === null) return null;
  const alpha = percent ? value / 100 : value;
  return alpha >= 0 && alpha <= 1 ? alpha : null;
}

function parseRgbFunction(body: string): Rgba | null {
  const slashParts = body.split('/');
  // 只允许一个 alpha 分隔斜杠。
  if (slashParts.length > 2) return null;
  const [channelPart = '', alphaPart] = slashParts;
  const channelText = channelPart.trim();
  if (channelText === '') return null;
  const usesCommas = channelText.includes(',');
  // 逗号是旧语法，本身没有 '/' 的 alpha 写法：混用两种分隔符一律拒绝。
  if (usesCommas && alphaPart !== undefined) return null;
  const rawTokens = usesCommas ? channelText.split(',') : channelText.split(/\s+/);
  const tokens = rawTokens.map((token) => token.trim());
  let alpha = 1;
  if (alphaPart !== undefined) {
    const parsed = toAlpha(alphaPart);
    if (parsed === null) return null;
    alpha = parsed;
  }
  if (tokens.length === 4) {
    // 空格语法里 alpha 必须跟在 '/' 后面，四个裸分量不是合法 CSS。
    if (!usesCommas) return null;
    const parsed = toAlpha(tokens[3] ?? '');
    if (parsed === null) return null;
    alpha = parsed;
    tokens.length = 3;
  }
  if (tokens.length !== 3) return null;
  const channels = tokens.map(toChannel);
  const [r, g, b] = channels;
  if (r === null || r === undefined) return null;
  if (g === null || g === undefined) return null;
  if (b === null || b === undefined) return null;
  return { r, g, b, a: alpha };
}

/**
 * 解析 #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba()。
 * 通道与 alpha 支持十进制数或百分比；数字必须整体匹配十进制语法。
 * 其它写法（系统色关键字、color()、hsl() 等）返回 null，不回退到默认色。
 */
export function parseColor(input: string): Rgba | null {
  const value = input.trim();
  const hexMatch = HEX_PATTERN.exec(value);
  if (hexMatch !== null) return parseHexDigits(hexMatch[1] ?? '');
  const rgbMatch = RGB_PATTERN.exec(value);
  if (rgbMatch !== null) return parseRgbFunction(rgbMatch[1] ?? '');
  return null;
}

/** 把 fg 按 alpha 合成到 bg 上；bg 自身也可以半透明。 */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const alpha = fg.a + bg.a * (1 - fg.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (front: number, back: number): number =>
    (front * fg.a + back * bg.a * (1 - fg.a)) / alpha;
  return {
    r: mix(fg.r, bg.r),
    g: mix(fg.g, bg.g),
    b: mix(fg.b, bg.b),
    a: alpha,
  };
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** 相对亮度；调用方必须保证入参已经不透明（先 composite）。 */
export function relativeLuminance(color: Rgba): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/** WCAG 对比度，返回值 1-21。 */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function formatRatio(ratio: number): string {
  return ratio.toFixed(4);
}

/** 测试断言用：失败时直接指出实测值与阈值，便于定位是哪条规则退化。 */
export function describeContrast(label: string, ratio: number, min: number): string {
  return label + ' 实测 ' + formatRatio(ratio) + ':1，要求 >= ' + min + ':1';
}

export interface CssRule {
  readonly selector: string;
  /** 外层 at-rule 的 prelude，例如 '@media (forced-colors: active)'。 */
  readonly conditions: readonly string[];
  readonly declarations: Readonly<Record<string, string>>;
}

const VAR_PATTERN = /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/i;
const MAX_VAR_DEPTH = 12;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 从 start（左花括号之后）开始找配对的右花括号；depth 从 1 起算。 */
function findBlockEnd(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function splitSelectors(prelude: string): string[] {
  return prelude
    .split(',')
    .map((selector) => selector.trim().replace(/\s+/g, ' '))
    .filter((selector) => selector !== '');
}

function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    const separator = chunk.indexOf(':');
    if (separator <= 0) continue;
    const property = chunk.slice(0, separator).trim().toLowerCase();
    const value = chunk
      .slice(separator + 1)
      .trim()
      .replace(/\s+/g, ' ');
    if (property === '' || value === '') continue;
    declarations[property] = value;
  }
  return declarations;
}

/**
 * 极简 CSS 规则解析器：只处理本项目样式表用到的形态
 * （普通规则 + @media/@supports 嵌套 + @keyframes 内层百分比）。
 * 不处理 data URI、嵌套 CSS 或注释之外的花括号转义；样式表里没有这些。
 */
export function parseCssRules(css: string): CssRule[] {
  const text = stripComments(css);
  const rules: CssRule[] = [];
  const conditions: string[] = [];
  let index = 0;
  let preludeStart = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '{') {
      const prelude = text.slice(preludeStart, index).trim().replace(/\s+/g, ' ');
      index += 1;
      preludeStart = index;
      if (prelude.startsWith('@')) {
        conditions.push(prelude);
        continue;
      }
      const end = findBlockEnd(text, index);
      const declarations = parseDeclarations(text.slice(index, end));
      for (const selector of splitSelectors(prelude)) {
        rules.push({ selector, conditions: [...conditions], declarations });
      }
      index = end + 1;
      preludeStart = index;
      continue;
    }
    if (character === '}') {
      conditions.pop();
      index += 1;
      preludeStart = index;
      continue;
    }
    // @import / @charset 这类无块语句以分号结束，不能并进下一条规则的前导。
    if (character === ';') {
      index += 1;
      preludeStart = index;
      continue;
    }
    index += 1;
  }
  return rules;
}

/** 收集某个选择器块里声明的自定义属性（默认 :root）。 */
export function readCustomProperties(
  rules: readonly CssRule[],
  selector = ':root',
): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.selector !== selector || rule.conditions.length > 0) continue;
    for (const [property, value] of Object.entries(rule.declarations)) {
      if (property.startsWith('--')) tokens[property] = value;
    }
  }
  return tokens;
}

/** 展开 var(--x[, fallback])；找不到且没有 fallback 时返回空串。 */
export function resolveValue(
  value: string,
  tokens: Readonly<Record<string, string>>,
  depth = 0,
): string {
  if (depth > MAX_VAR_DEPTH) throw new Error('var() 嵌套过深：' + value);
  const match = VAR_PATTERN.exec(value);
  if (match === null) return value.trim();
  const name = match[1] ?? '';
  const fallback = match[2];
  const replacement = tokens[name] ?? fallback ?? '';
  return resolveValue(value.replace(match[0], replacement), tokens, depth + 1);
}

/** 解析声明值里的颜色，支持 var() 间接引用；不是颜色时返回 null。 */
export function resolveColor(value: string, tokens: Readonly<Record<string, string>>): Rgba | null {
  const direct = parseColor(resolveValue(value, tokens));
  if (direct !== null) return direct;
  // 简写属性（outline、border、background）里颜色只是其中一段。
  for (const part of resolveValue(value, tokens).split(/\s+/)) {
    const color = parseColor(part);
    if (color !== null) return color;
  }
  return null;
}
