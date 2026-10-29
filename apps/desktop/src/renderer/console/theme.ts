/**
 * 界面配色的唯一拥有者：明暗挡位、配色方案（三套内置 + 自定义）与 36 个调色 token。
 *
 * 状态是本机 localStorage 里的一条记录（`pet.console.theme`），没有服务端副本：界面偏好不该
 * 走插件宿主的数据通道。配色落地的方式是把自己映射到 @pet/ui-kit 的语义令牌上——`--pk-*`
 * 由内联样式覆盖，`data-theme` 照旧写，ui-kit 的 `light-dark()` 继续为没被接管的令牌兜底。
 *
 * 数据与纯函数放在这里，编辑器只负责画与点；分得开，测试才不用碰 DOM。
 */

export const THEMES = ['light', 'dark', 'system'] as const;

/** 明暗挡位。名字沿用旧导出，含义不变。 */
export type Theme = (typeof THEMES)[number];

/** 参考实现里同一个东西叫 mode；两个名字都留着，读代码的人不必换算。 */
export type ThemeMode = Theme;

/** `system` 解析之后只剩两种：CSS 变量真正落地时看的是这个。 */
export type ThemeAppearance = 'light' | 'dark';

/** token key → `#rrggbb`。缺格由 `normalizePalette` 用回退表补齐。 */
export type ThemePalette = Record<string, string>;

export interface ThemeScheme {
  readonly id: string;
  readonly name: string;
  readonly note: string;
  /** 浅色与黑夜是**两份独立配色**，不是同一份的明暗算法推导。 */
  readonly palettes: Record<ThemeAppearance, ThemePalette>;
  readonly builtin?: boolean | undefined;
  readonly custom?: boolean | undefined;
}

/** 一条主题记录。内置方案不进记录，每次现取。 */
export interface StoredTheme {
  /** 选中的方案 id；可能指向一个已经删掉的方案，取用时兜底。 */
  readonly selectedId: string;
  readonly mode: ThemeMode;
  readonly custom: readonly ThemeScheme[];
}

/**
 * 可见文字与完整名称分开：侧栏只有约 210px，三段各约 49px，
 * “跟随系统”放不下会折行；标签用两字，读屏名称仍是完整含义。
 */
const THEME_SHORT_LABELS: Readonly<Record<Theme, string>> = {
  light: '浅色',
  dark: '深色',
  system: '系统',
};

const THEME_LABELS: Readonly<Record<Theme, string>> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

/**
 * 配色那一节里三挡的措辞：与来源同一组名称（黑夜，不是深色）。
 * 侧栏那三个两字标签走 themeLabel / themeAriaLabel，是同一件事的另一种密度，两处都只有定义一次。
 */
export const THEME_MODE_NAMES: Readonly<Record<ThemeMode, string>> = {
  light: '浅色',
  dark: '黑夜',
  system: '跟随系统',
};

/** 挡位符号只是视觉提示：读屏拿到的是上面那三个词。 */
export const THEME_MODE_GLYPHS: Readonly<Record<ThemeMode, string>> = {
  light: '☀',
  dark: '◐',
  system: '◒',
};

/** 提示语里的“当前变体”：浅色与黑夜是两份各自保存的配色。 */
export const THEME_APPEARANCE_LABELS: Readonly<Record<ThemeAppearance, string>> = {
  light: '浅色',
  dark: '黑夜',
};

const STORAGE_KEY = 'pet.console.theme';

/** 控件里显示的两字标签。 */
export function themeLabel(theme: Theme): string {
  return THEME_SHORT_LABELS[theme];
}

/** 无障碍与提示用的完整名称。 */
export function themeAriaLabel(theme: Theme): string {
  return THEME_LABELS[theme];
}

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// token 词表：36 格、五个分组，这里的顺序就是编辑器里的顺序
// ---------------------------------------------------------------------------

export interface ThemeToken {
  /** 编辑器里的分组标题。 */
  readonly group: string;
  /** CSS 变量名去掉 `--` 前缀，如 `paper` → `--paper`。 */
  readonly key: string;
  /** 编辑器里的中文标签。 */
  readonly label: string;
}

const TOKEN_GROUPS = [
  { group: '背景层级', keys: ['paper', 'paper-2', 'sheet', 'sheet-2', 'sheet-3'] },
  { group: '文字与边界', keys: ['ink', 'ink-soft', 'ink-dim', 'line', 'line-2', 'line-strong'] },
  { group: '交互与状态', keys: ['accent', 'accent-2', 'on-accent', 'ok', 'warn', 'danger'] },
  {
    group: '控制台时间线',
    keys: [
      'ink-blue',
      'violet',
      'agent-surface',
      'world-bg',
      'world-ink',
      'bubble-bg',
      'bubble-ink',
      'tool-result',
    ],
  },
  {
    group: '图表系列',
    keys: [
      'chart-hit',
      'chart-miss',
      'chart-output',
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-5',
      'chart-6',
      'chart-7',
      'chart-8',
    ],
  },
] as const;

const TOKEN_LABELS: Readonly<Record<string, string>> = {
  paper: '页面背景',
  'paper-2': '侧栏背景',
  sheet: '主卡片背景',
  'sheet-2': '次级卡片背景',
  'sheet-3': '压低底色',
  ink: '主要文字',
  'ink-soft': '次级文字',
  'ink-dim': '弱化文字',
  line: '细边界',
  'line-2': '常规边界',
  'line-strong': '强调边界',
  accent: '主强调',
  'accent-2': '次强调',
  'on-accent': '强调色上文字',
  ok: '成功 / 在线',
  warn: '提醒 / 系统',
  danger: '危险 / 失败',
  'ink-blue': 'Agent 标记',
  violet: '思考标记',
  'agent-surface': 'Agent 卡片底色',
  'world-bg': '世界事件底色',
  'world-ink': '世界事件文字',
  'bubble-bg': '发送气泡底色',
  'bubble-ink': '发送气泡文字',
  'tool-result': '工具结果文字',
  'chart-hit': '缓存命中',
  'chart-miss': '未命中输入',
  'chart-output': '模型输出',
  'chart-1': '系列 1',
  'chart-2': '系列 2',
  'chart-3': '系列 3',
  'chart-4': '系列 4',
  'chart-5': '系列 5',
  'chart-6': '系列 6',
  'chart-7': '系列 7',
  'chart-8': '系列 8',
};

export const THEME_TOKENS: readonly ThemeToken[] = TOKEN_GROUPS.flatMap((bucket) =>
  bucket.keys.map((key): ThemeToken => ({
    group: bucket.group,
    key,
    label: TOKEN_LABELS[key] ?? key,
  })),
);

export const THEME_TOKEN_KEYS: readonly string[] = THEME_TOKENS.map((token) => token.key);

/**
 * 按分组归并，**保持词表里的出现顺序**。
 *
 * 编辑器直接画这个形状：分组是这一节唯一有分量的纯逻辑，写在渲染函数里就只能靠看 DOM 来验。
 */
export function groupedThemeTokens(
  tokens: readonly ThemeToken[] = THEME_TOKENS,
): Array<{ group: string; tokens: ThemeToken[] }> {
  const out: Array<{ group: string; tokens: ThemeToken[] }> = [];
  const index = new Map<string, { group: string; tokens: ThemeToken[] }>();
  for (const token of tokens) {
    let bucket = index.get(token.group);
    if (!bucket) {
      bucket = { group: token.group, tokens: [] };
      index.set(token.group, bucket);
      out.push(bucket);
    }
    bucket.tokens.push(token);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 三套内置配色：浅色与黑夜各一份，取值与来源逐格一致
// ---------------------------------------------------------------------------

/** 主强调取自明暗版 Logo；正文使用加深或调亮的同色系绿色。 */
const mintLight: ThemePalette = {
  paper: '#f4f5f4',
  'paper-2': '#ecedec',
  sheet: '#fbfbfb',
  'sheet-2': '#f2f3f2',
  'sheet-3': '#e8e9e8',
  ink: '#1b1a1e',
  'ink-soft': '#5c5c60',
  'ink-dim': '#8b8b8f',
  line: '#e3e4e3',
  'line-2': '#d0d2d0',
  'line-strong': '#aeb0ae',
  accent: '#00a870',
  'accent-2': '#54b494',
  'on-accent': '#082a1e',
  ok: '#19815e',
  warn: '#96743b',
  danger: '#b45950',
  'ink-blue': '#238268',
  violet: '#25765e',
  'agent-surface': '#f4f5f4',
  'world-bg': '#f0f1f0',
  'world-ink': '#4a4a4e',
  'bubble-bg': '#e6e9e7',
  'bubble-ink': '#1f2221',
  'tool-result': '#087452',
  'chart-hit': '#19815e',
  'chart-miss': '#96743b',
  'chart-output': '#00a870',
  'chart-1': '#00a870',
  'chart-2': '#54b494',
  'chart-3': '#348f86',
  'chart-4': '#72967f',
  'chart-5': '#b59564',
  'chart-6': '#9b8071',
  'chart-7': '#4a8f9a',
  'chart-8': '#889460',
};

const mintDark: ThemePalette = {
  paper: '#121312',
  'paper-2': '#181a19',
  sheet: '#1d1f1e',
  'sheet-2': '#242726',
  'sheet-3': '#2c302e',
  ink: '#e9eae9',
  'ink-soft': '#b0b2b1',
  'ink-dim': '#828584',
  line: '#292c2b',
  'line-2': '#383c3a',
  'line-strong': '#535856',
  accent: '#2fd59b',
  'accent-2': '#78cbae',
  'on-accent': '#082a1e',
  ok: '#76ca9f',
  warn: '#c4a372',
  danger: '#d18c83',
  'ink-blue': '#53bda0',
  violet: '#91d8bb',
  'agent-surface': '#181a19',
  'world-bg': '#1e211f',
  'world-ink': '#adb2b0',
  'bubble-bg': '#2c3230',
  'bubble-ink': '#e6eae8',
  'tool-result': '#75cfa8',
  'chart-hit': '#76ca9f',
  'chart-miss': '#c4a372',
  'chart-output': '#2fd59b',
  'chart-1': '#2fd59b',
  'chart-2': '#78cbae',
  'chart-3': '#64b8ad',
  'chart-4': '#91b99d',
  'chart-5': '#c4a372',
  'chart-6': '#b69b8c',
  'chart-7': '#76afb9',
  'chart-8': '#a8b17e',
};

const navigatorLight: ThemePalette = {
  paper: '#f5f7fa',
  'paper-2': '#e9eef4',
  sheet: '#ffffff',
  'sheet-2': '#f1f4f8',
  'sheet-3': '#e3eaf2',
  ink: '#383d43',
  'ink-soft': '#536174',
  'ink-dim': '#7d8a9c',
  line: '#dce3eb',
  'line-2': '#c6d1df',
  'line-strong': '#9dacc0',
  accent: '#6591c3',
  'accent-2': '#383d43',
  'on-accent': '#111820',
  ok: '#357389',
  warn: '#865963',
  danger: '#a34f63',
  'ink-blue': '#426c99',
  violet: '#383d43',
  'agent-surface': '#f5f7fa',
  'world-bg': '#edf3f8',
  'world-ink': '#485665',
  'bubble-bg': '#e4eef8',
  'bubble-ink': '#383d43',
  'tool-result': '#355c84',
  'chart-hit': '#529bbd',
  'chart-miss': '#383d43',
  'chart-output': '#6591c3',
  'chart-1': '#6591c3',
  'chart-2': '#383d43',
  'chart-3': '#81c9ef',
  'chart-4': '#a9bed6',
  'chart-5': '#bc8f9a',
  'chart-6': '#637489',
  'chart-7': '#4f91ad',
  'chart-8': '#c6d3e2',
};

/** 深色背景上的海军蓝边线与文字使用提亮的同色系蓝色。 */
const navigatorDark: ThemePalette = {
  paper: '#12171d',
  'paper-2': '#171d24',
  sheet: '#202730',
  'sheet-2': '#28313c',
  'sheet-3': '#323d4a',
  ink: '#f2f5fa',
  'ink-soft': '#b8c5d6',
  'ink-dim': '#8594a7',
  line: '#2d3743',
  'line-2': '#3c4959',
  'line-strong': '#596b80',
  accent: '#81c9ef',
  'accent-2': '#6591c3',
  'on-accent': '#162331',
  ok: '#85c8dc',
  warn: '#d6aeb8',
  danger: '#e99bae',
  'ink-blue': '#81c9ef',
  violet: '#a9bed6',
  'agent-surface': '#171d24',
  'world-bg': '#202b38',
  'world-ink': '#b8c5d6',
  'bubble-bg': '#2e3d50',
  'bubble-ink': '#f2f5fa',
  'tool-result': '#9dbfe2',
  'chart-hit': '#81c9ef',
  'chart-miss': '#6591c3',
  'chart-output': '#adc7e4',
  'chart-1': '#81c9ef',
  'chart-2': '#6591c3',
  'chart-3': '#9dbfe2',
  'chart-4': '#b8c5d6',
  'chart-5': '#fae6e8',
  'chart-6': '#8e9fb5',
  'chart-7': '#73aec9',
  'chart-8': '#cbd6e4',
};

/** Claude 灰阶配赤陶与灰玫瑰强调色；浅色文字使用同色系的深色。 */
const crabDaisyLight: ThemePalette = {
  paper: '#fcfcfb',
  'paper-2': '#f9f9f7',
  sheet: '#ffffff',
  'sheet-2': '#f3f3f0',
  'sheet-3': '#f0efec',
  ink: '#0b0b0b',
  'ink-soft': '#52514e',
  'ink-dim': '#7b7974',
  line: '#e1e0d9',
  'line-2': '#d2d1c7',
  'line-strong': '#b4b3a8',
  accent: '#c87c5d',
  'accent-2': '#cb7c78',
  'on-accent': '#131313',
  ok: '#006300',
  warn: '#835100',
  danger: '#8e2626',
  'ink-blue': '#cb7c78',
  violet: '#a15d59',
  'agent-surface': '#fcfcfb',
  'world-bg': '#f3f3f0',
  'world-ink': '#52514e',
  'bubble-bg': '#f0efec',
  'bubble-ink': '#131313',
  'tool-result': '#995b43',
  'chart-hit': '#009300',
  'chart-miss': '#a66a00',
  'chart-output': '#c87c5d',
  'chart-1': '#c87c5d',
  'chart-2': '#cb7c78',
  'chart-3': '#7161e0',
  'chart-4': '#009300',
  'chart-5': '#c6613f',
  'chart-6': '#a66a00',
  'chart-7': '#7b7974',
  'chart-8': '#c04873',
};

const crabDaisyDark: ThemePalette = {
  paper: '#151515',
  'paper-2': '#111111',
  sheet: '#20201f',
  'sheet-2': '#1e1e1d',
  'sheet-3': '#2c2c2a',
  ink: '#f0efec',
  'ink-soft': '#c3c2b7',
  'ink-dim': '#97958d',
  line: '#383835',
  'line-2': '#454442',
  'line-strong': '#5f5e5a',
  accent: '#c87c5d',
  'accent-2': '#cb7c78',
  'on-accent': '#131313',
  ok: '#91d68b',
  warn: '#db9300',
  danger: '#ec7e7e',
  'ink-blue': '#cb7c78',
  violet: '#cb7c78',
  'agent-surface': '#151515',
  'world-bg': '#20201f',
  'world-ink': '#c3c2b7',
  'bubble-bg': '#2c2c2a',
  'bubble-ink': '#f0efec',
  'tool-result': '#c87c5d',
  'chart-hit': '#91d68b',
  'chart-miss': '#db9300',
  'chart-output': '#c87c5d',
  'chart-1': '#c87c5d',
  'chart-2': '#cb7c78',
  'chart-3': '#a096eb',
  'chart-4': '#91d68b',
  'chart-5': '#ec835a',
  'chart-6': '#db9300',
  'chart-7': '#97958d',
  'chart-8': '#e87ba4',
};

export const BUILTIN_PALETTES: Readonly<Record<string, Record<ThemeAppearance, ThemePalette>>> = {
  mint: { light: mintLight, dark: mintDark },
  navigator: { light: navigatorLight, dark: navigatorDark },
  'crab-daisy': { light: crabDaisyLight, dark: crabDaisyDark },
};

/** 内置方案 id，第一个是框架默认方案。 */
export const BUILTIN_SCHEME_IDS: readonly string[] = Object.keys(BUILTIN_PALETTES);

export const DEFAULT_SCHEME_ID: string = BUILTIN_SCHEME_IDS[0] ?? 'mint';

const SCHEME_TEXT: Readonly<Record<string, { name: string; note: string }>> = {
  mint: { name: '脑皮质薄荷', note: 'Logo 的薄荷绿、同色系层次与中性灰背景' },
  navigator: { name: '未来领航员', note: '海军蓝、天蓝、白与淡粉' },
  'crab-daisy': { name: '螃蟹和雏菊', note: '赤陶、灰玫瑰与 Claude 网页灰阶' },
};

const CUSTOM_SCHEME_NAME = '自定义方案';
const CUSTOM_SCHEME_NOTE = '自定义配色';

/** 内置方案，贴上界面文案；每次现取，调用方拿到的是副本。 */
export function builtinSchemes(): ThemeScheme[] {
  return BUILTIN_SCHEME_IDS.map((id) => {
    const text = SCHEME_TEXT[id];
    const palettes = BUILTIN_PALETTES[id];
    return {
      id,
      name: text?.name ?? id,
      note: text?.note ?? '',
      palettes: {
        light: clonePalette(palettes?.['light'] ?? {}),
        dark: clonePalette(palettes?.['dark'] ?? {}),
      },
      builtin: true,
    };
  });
}

/** 方案名与说明：自定义方案没填名字时用通用称呼。 */
export function schemeText(scheme: ThemeScheme): { name: string; note: string } {
  const text = SCHEME_TEXT[scheme.id];
  return {
    name: scheme.name || text?.name || CUSTOM_SCHEME_NAME,
    note: scheme.note || text?.note || CUSTOM_SCHEME_NOTE,
  };
}

// ---------------------------------------------------------------------------
// 颜色与规范化
// ---------------------------------------------------------------------------

/** `#rrggbb`（大小写不限）。三位简写**不算**——记录里只留规范形式。 */
export function isHexColor(value: unknown): boolean {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? ''));
}

/**
 * 用户输入 → 规范 `#rrggbb`（小写）；认不出给 `null`。
 *
 * 收 `#abc` 简写是因为手打十六进制的人真会那么写，而 `<input type="color">` 永远吐六位——
 * 两边喂进同一个函数，编辑器里就不必分两条路。
 */
export function normalizeHex(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const short = /^#([0-9a-f]{3})$/i.exec(raw)?.[1];
  const full =
    short === undefined
      ? raw
      : '#' +
        short
          .split('')
          .map((c) => c + c)
          .join('');
  return isHexColor(full) ? full.toLowerCase() : null;
}

/** 该明暗变体的回退调色板（默认方案）。 */
export function fallbackPalette(appearance: ThemeAppearance): ThemePalette {
  return BUILTIN_PALETTES[DEFAULT_SCHEME_ID]?.[appearance] ?? {};
}

/**
 * 逐 token 校验 + 补齐。**只留词表里的键**：记录里混进来的野键不该被原样写回
 * `documentElement`，那等于让一条主题记录往全站注入任意 CSS 变量。
 */
export function normalizePalette(palette: unknown, fallback: ThemePalette): ThemePalette {
  const src = (palette ?? {}) as Record<string, unknown>;
  const out: ThemePalette = {};
  for (const key of THEME_TOKEN_KEYS) {
    const value = src[key];
    out[key] = isHexColor(value) ? String(value).toLowerCase() : (fallback[key] ?? '#000000');
  }
  return out;
}

export function clonePalette(palette: ThemePalette): ThemePalette {
  return { ...palette };
}

export function cloneScheme(scheme: ThemeScheme): ThemeScheme {
  return {
    ...scheme,
    palettes: {
      light: clonePalette(scheme.palettes['light']),
      dark: clonePalette(scheme.palettes['dark']),
    },
  };
}

/** 方案卡上那条四格色带：底纸 / 主卡纸 / 主强调 / 一个图表系列色。 */
export function schemeSwatches(scheme: ThemeScheme, appearance: ThemeAppearance): string[] {
  const palette = scheme.palettes[appearance];
  return [
    palette['paper'] ?? '',
    palette['sheet'] ?? '',
    palette['accent'] ?? '',
    palette['chart-2'] ?? '',
  ];
}

/** 自定义方案的名称上限 40 字、说明上限 80 字；缺 id 的记录按无效丢弃。 */
function normalizeCustomScheme(raw: unknown): ThemeScheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const scheme = raw as Partial<ThemeScheme>;
  if (typeof scheme.id !== 'string' || scheme.id === '') return null;
  const palettes = (scheme.palettes ?? {}) as Partial<Record<ThemeAppearance, ThemePalette>>;
  return {
    id: scheme.id,
    name: String(scheme.name ?? '').slice(0, 40),
    note: String(scheme.note ?? '').slice(0, 80),
    palettes: {
      light: normalizePalette(palettes['light'], fallbackPalette('light')),
      dark: normalizePalette(palettes['dark'], fallbackPalette('dark')),
    },
    custom: true,
  };
}

export function defaultStoredTheme(): StoredTheme {
  return { selectedId: DEFAULT_SCHEME_ID, mode: 'system', custom: [] };
}

/** 任意值 → 一条可用的主题记录。字段类型不对的按缺省算，绝不抛。 */
export function normalizeStoredTheme(value: unknown): StoredTheme {
  if (!value || typeof value !== 'object') return defaultStoredTheme();
  const raw = value as Partial<StoredTheme>;
  return {
    selectedId:
      typeof raw.selectedId === 'string' && raw.selectedId !== ''
        ? raw.selectedId
        : DEFAULT_SCHEME_ID,
    mode: isTheme(raw.mode) ? raw.mode : 'system',
    custom: Array.isArray(raw.custom)
      ? raw.custom.map(normalizeCustomScheme).filter((s): s is ThemeScheme => s !== null)
      : [],
  };
}

/** 全部方案：内置在前、自定义在后，调用方拿到的是副本。 */
export function allSchemes(state: StoredTheme): ThemeScheme[] {
  return [...builtinSchemes(), ...state.custom.map((s) => ({ ...cloneScheme(s), custom: true }))];
}

/** 词表保证内置方案至少有一个；这个兜底只在假数据里露面。 */
function placeholderScheme(): ThemeScheme {
  return {
    id: DEFAULT_SCHEME_ID,
    name: CUSTOM_SCHEME_NAME,
    note: CUSTOM_SCHEME_NOTE,
    palettes: { light: {}, dark: {} },
    builtin: true,
  };
}

/** 选中的方案。记录指向的 id 不存在（方案在别处被删了）就退回默认方案。 */
export function currentScheme(state: StoredTheme): ThemeScheme {
  const all = allSchemes(state);
  const selected =
    all.find((s) => s.id === state.selectedId) ?? all.find((s) => s.id === DEFAULT_SCHEME_ID);
  return selected ?? all[0] ?? placeholderScheme();
}

/** 选中的方案能不能直接覆盖：内置方案不可写。 */
export function selectedIsCustom(state: StoredTheme): boolean {
  return state.custom.some((s) => s.id === state.selectedId);
}

// ---------------------------------------------------------------------------
// 明暗解析与落地
// ---------------------------------------------------------------------------

/** 系统深色偏好；拿不到（受限环境、假文档）就按浅色处理。 */
function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 用户挡位 → 真正生效的明暗。 */
export function resolveAppearance(mode: ThemeMode): ThemeAppearance {
  if (mode !== 'system') return mode;
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * 来源词表 → @pet/ui-kit 的语义令牌。
 *
 * 只映射这一侧确实存在的概念；没被接管的令牌（软底、阴影、圆角）继续由 ui-kit 的
 * `light-dark()` 按 `color-scheme` 兜底，避免出现第二套配色定义。
 */
const UI_KIT_VARS: readonly [string, string][] = [
  ['--pk-bg', '--paper'],
  ['--pk-surface', '--paper-2'],
  ['--pk-sunken', '--sheet-3'],
  ['--pk-text', '--ink'],
  ['--pk-muted', '--ink-soft'],
  ['--pk-border', '--line'],
  ['--pk-border-strong', '--line-strong'],
  ['--pk-accent', '--accent'],
  ['--pk-accent-hover', '--accent'],
  ['--pk-accent-on', '--on-accent'],
  ['--pk-accent-text', '--accent'],
  ['--pk-accent-soft', '--agent-surface'],
  ['--pk-ok', '--ok'],
  ['--pk-warn', '--warn'],
  ['--pk-danger', '--danger'],
  ['--pk-ring', '--accent'],
];

/** 按词表顺序映射 CSS 变量，仅包含词表中的键。 */
export function paletteVars(palette: ThemePalette): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const token of THEME_TOKENS) {
    const value = palette[token.key];
    if (typeof value === 'string' && value !== '') out.push(['--' + token.key, value]);
  }
  return out;
}

/** 写进 `<html>` 的全部声明：词表本身，加上 ui-kit 那一层的别名。 */
export function paletteDeclarations(palette: ThemePalette): Array<[string, string]> {
  const vars = paletteVars(palette);
  const lookup = new Map(vars);
  for (const [uiKit, token] of UI_KIT_VARS) {
    const value = lookup.get(token);
    if (value !== undefined) vars.push([uiKit, value]);
  }
  return vars;
}

/** 未保存的预览调色板；有值时它压过记录里那份，直到撤销预览或换页。 */
let previewDraft: ThemePalette | null = null;

/**
 * 把一条主题记录刷到文档上：**同步、幂等**，重复调用只是把同样的值再写一遍。
 *
 * `data-theme` 照旧写：ui-kit 的 `light-dark()` 负责没被接管的令牌，两者不会互相打架。
 */
export function paintTheme(state: StoredTheme): void {
  const appearance = resolveAppearance(state.mode);
  const palette = previewDraft ?? currentScheme(state).palettes[appearance];
  let root: HTMLElement | undefined;
  try {
    root = document.documentElement;
  } catch {
    return; // 没有文档（测试进程、预加载脚本）：记录照样权威，只是不落地。
  }
  root.setAttribute('data-theme', state.mode);
  const normalized = normalizePalette(palette, fallbackPalette(appearance));
  for (const [name, value] of paletteDeclarations(normalized)) root.style.setProperty(name, value);
  // 明暗由这一份配色决定，滚动条与原生表单控件跟着它走。
  root.style.colorScheme = appearance;
}

let systemWatched = false;
let watchedState: StoredTheme = defaultStoredTheme();

/** 系统挡位下跟着系统走；监听只装一次，卸载留给进程结束。 */
function watchSystemAppearance(state: StoredTheme): void {
  watchedState = state;
  if (systemWatched) return;
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (watchedState.mode === 'system') paintTheme(watchedState);
    });
    systemWatched = true;
  } catch {
    // 没有 matchMedia 就只是不跟随系统切换，显式的浅色/黑夜不受影响。
  }
}

// ---------------------------------------------------------------------------
// 本机记录：读、写、通知
// ---------------------------------------------------------------------------

/**
 * 存储里可能是旧的裸挡位字符串（`"dark"`），也可能是新的记录。
 * 旧值迁移成“挡位照旧、方案用默认”：换了存储形状不能把用户已有的明暗选择丢掉。
 */
function migrate(raw: string): StoredTheme | null {
  if (isTheme(raw)) return { ...defaultStoredTheme(), mode: raw };
  try {
    return normalizeStoredTheme(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 读取失败的存储按默认值处理：localStorage 在受限环境会直接抛错。 */
export function readThemeState(): StoredTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return defaultStoredTheme();
    return migrate(stored) ?? defaultStoredTheme();
  } catch {
    return defaultStoredTheme();
  }
}

type ThemeListener = (state: StoredTheme) => void;

const listeners = new Set<ThemeListener>();

/**
 * 订阅记录变化（同一个函数只算一次），返回退订函数。
 *
 * 侧栏那个常驻挡位控件以及以后任何读配色的地方都该订阅这里，而不是各存一份状态。
 */
export function subscribeTheme(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(state: StoredTheme): void {
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch {
      // 一个订阅者失败不牵连其他订阅者，也不改变已经落地的事实。
    }
  }
}

/** 一次写入的结果：`ok` 说的是这条记录真的存进了本机存储。 */
export interface ThemeWriteResult {
  readonly ok: boolean;
  readonly error?: string | undefined;
}

/**
 * 写记录并落地。
 *
 * 写进去不等于存得住：读回来核对一次，编辑界面才不必对用户报一个假的“已保存”。
 * 存不下只影响下次启动的默认值，当前选择在这次会话里仍然生效。
 */
export function writeThemeState(next: StoredTheme): ThemeWriteResult {
  let error: string | undefined;
  try {
    const json = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, json);
    error = localStorage.getItem(STORAGE_KEY) === json ? undefined : '本机存储没有收下这份配色';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  previewDraft = null;
  watchSystemAppearance(next);
  paintTheme(next);
  emit(next);
  return error === undefined ? { ok: true } : { ok: false, error };
}

/** 旧接口：挡位仍然可以单独读。 */
export function readStoredTheme(): Theme {
  return readThemeState().mode;
}

/** 旧接口：只改挡位，方案与自定义配色保持不变。 */
export function storeTheme(theme: Theme): void {
  const state = readThemeState();
  if (state.mode === theme) {
    paintTheme(state);
    return;
  }
  writeThemeState({ ...state, mode: theme });
}

export function applyTheme(theme: Theme): void {
  writeThemeState({ ...readThemeState(), mode: theme });
}

/** 首屏第一件事：在任何绘制之前把上次的挡位与配色写到 `<html>`，避免闪一帧错误配色。 */
export function applyStoredTheme(): void {
  const state = readThemeState();
  watchSystemAppearance(state);
  paintTheme(state);
}

// ---------------------------------------------------------------------------
// 编辑：试色与保存
// ---------------------------------------------------------------------------

/** 试色：刷到文档但**不回写记录**。撤销预览或离开这一页就没了。 */
export function previewPalette(palette: ThemePalette): ThemePalette {
  const state = readThemeState();
  const appearance = resolveAppearance(state.mode);
  const draft = normalizePalette(palette, currentScheme(state).palettes[appearance]);
  previewDraft = draft;
  paintTheme(state);
  return draft;
}

/** 丢掉未保存的预览，回到记录里那份。 */
export function resetPreview(): void {
  previewDraft = null;
  paintTheme(readThemeState());
}

/** 撤销预览之后编辑器该画回去的那份配色。 */
export function committedPalette(): ThemePalette {
  const state = readThemeState();
  return clonePalette(currentScheme(state).palettes[resolveAppearance(state.mode)]);
}

/** 新方案的 id：时间戳加随机段，同一次点击里不会撞。 */
function newSchemeId(): string {
  return ['custom', Date.now().toString(36), Math.random().toString(36).slice(2, 6)].join('-');
}

/** 切换方案；指向一个不存在的方案时返回 null，不静默改选。 */
export function selectScheme(state: StoredTheme, id: string): StoredTheme | null {
  if (!allSchemes(state).some((s) => s.id === id)) return null;
  return { ...state, selectedId: id };
}

/**
 * 另存为新的自定义方案并切过去。
 *
 * **只覆盖当前明暗变体**，另一半从源方案原样拷过来：用户在浅色下调完色，黑夜变体不该
 * 跟着变成一份浅色配色的暗抄本。
 */
export function saveSchemeAs(
  state: StoredTheme,
  options: {
    readonly name: string;
    readonly palette: ThemePalette;
    readonly appearance: ThemeAppearance;
  },
): { readonly state: StoredTheme; readonly id: string } {
  const source = currentScheme(state);
  const name = options.name.trim().slice(0, 40);
  const id = newSchemeId();
  const palettes: Record<ThemeAppearance, ThemePalette> = {
    light: clonePalette(source.palettes['light']),
    dark: clonePalette(source.palettes['dark']),
  };
  palettes[options.appearance] = normalizePalette(
    options.palette,
    source.palettes[options.appearance],
  );
  const scheme: ThemeScheme = {
    id,
    name: name === '' ? source.name.trim() + ' 副本' : name,
    note: CUSTOM_SCHEME_NOTE,
    palettes,
    custom: true,
  };
  return { state: { ...state, selectedId: id, custom: [...state.custom, scheme] }, id };
}

/**
 * 覆盖当前自定义方案的**一个明暗变体**，另一份原样保留。
 *
 * 选中的是内置方案时返回 null：内置配色不可覆盖，只能另存为自定义。
 */
export function saveCurrentScheme(
  state: StoredTheme,
  options: {
    readonly name: string;
    readonly palette: ThemePalette;
    readonly appearance: ThemeAppearance;
    readonly schemeId: string;
  },
): StoredTheme | null {
  const index = state.custom.findIndex((s) => s.id === options.schemeId);
  if (index < 0) return null;
  const scheme = state.custom[index];
  if (scheme === undefined) return null;
  const palettes: Record<ThemeAppearance, ThemePalette> = {
    light: clonePalette(scheme.palettes['light']),
    dark: clonePalette(scheme.palettes['dark']),
  };
  palettes[options.appearance] = normalizePalette(
    options.palette,
    scheme.palettes[options.appearance],
  );
  const custom = [...state.custom];
  custom[index] = {
    ...scheme,
    name: options.name.trim().slice(0, 40) || scheme.name,
    palettes,
  };
  return { ...state, custom };
}

/** 删掉那个自定义方案；选中的正是它时回到默认方案。 */
export function removeScheme(state: StoredTheme, id: string): StoredTheme | null {
  if (!state.custom.some((s) => s.id === id)) return null;
  const custom = state.custom.filter((s) => s.id !== id);
  return {
    ...state,
    custom,
    selectedId: id === state.selectedId ? DEFAULT_SCHEME_ID : state.selectedId,
  };
}
