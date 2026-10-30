/**
 * 风格家族的配色适配器：只给值与动作，不画任何东西。
 *
 * 评审用的呈现种子（review seed）三条语义，说清楚一次就够：
 * 1. 一家自带**浅与黑两套**默认色。贴在家族自己那一整扇窗的根节点上，只在这次评审里生效：
 *    换家族不写本机记录、不改挡位、不覆盖用户偏好。
 * 2. 切换明暗 = 在这一家自己的两套呈现色里换半，风格自身的明暗设计跟着换，不退回 PB 配色。
 *    这一条仍然走 theme.ts 那一个真动作（挡位是用户偏好，写了就写了），只是不摘呈现种子。
 * 3. 只有明确的配色动作才把这一扇窗交给本机记录：改某格试色、挑一个已保存方案、保存、
 *    另存自定义、删除方案、撤销预览。此后 frame 不再贴种子，看到的就是记录与试色——
 *    36 格、保存、撤销、自定义变体一个都不打折。给方案名打字不算配色动作，不摘种子。
 *
 * 卸载（离开这一家）由控制器 dispose 撤掉没保存的试色；不写记录，也不留第二份状态。
 * 控制器仍是 original-ui/theme-controller.ts 那一个，记录仍是 theme.ts 那一份。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';

import {
  THEME_TOKEN_KEYS,
  THEME_TOKENS,
  committedPalette,
  paletteDeclarations,
  type ThemeAppearance,
  type ThemeMode,
  type ThemePalette,
  type ThemeToken,
} from '../theme.js';
import {
  createThemeStudioController,
  type ThemeStudioController,
  type ThemeStudioSnapshot,
} from '../original-ui/theme-controller.js';

/**
 * 词表那 36 格的名字，一份字面量镜像：家族种子写错格子在编译期就红，
 * 名字与 theme.ts 的一致性由 registry 那条 parity 测试守着（多一格少一格都过不了）。
 */
export const FAMILY_TOKEN_KEYS = [
  'paper',
  'paper-2',
  'sheet',
  'sheet-2',
  'sheet-3',
  'ink',
  'ink-soft',
  'ink-dim',
  'line',
  'line-2',
  'line-strong',
  'accent',
  'accent-2',
  'on-accent',
  'ok',
  'warn',
  'danger',
  'ink-blue',
  'violet',
  'agent-surface',
  'world-bg',
  'world-ink',
  'bubble-bg',
  'bubble-ink',
  'tool-result',
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
] as const;

export type FamilyTokenKey = (typeof FAMILY_TOKEN_KEYS)[number];

/** 一家的半套呈现色：只写自己要在意的那几格，没写的格子跟着本机记录走。 */
export type FamilySeedPalette = Readonly<Partial<Record<FamilyTokenKey, string>>>;

/**
 * 一家的呈现种子：浅与黑两套都是必填——切换明暗就在这一家自己的两套呈现色里换半，
 * 风格自身的明暗设计跟着换，不退回别家的样子。
 */
export interface FamilyThemeSeed {
  readonly light: FamilySeedPalette;
  readonly dark: FamilySeedPalette;
}

/** 词表里的 36 格与顺序：家族自己决定摆成分组列表、色轮还是抽屉。 */
export type FamilyThemeTokens = readonly ThemeToken[];

export interface FamilyThemeActions {
  /** 只是方案名：不摘呈现种子。 */
  setName(value: string): void;
  /** 挡位是用户偏好，写记录；但呈现跟着这一家的明暗设计走，不摘种子。 */
  chooseMode(mode: ThemeMode): void;
  /** 挑一个已保存的方案 = 明确要把这一扇窗交给记录。 */
  chooseScheme(id: string): void;
  /** 改一格：认不出的十六进制只标红那一格，不进草稿（控制器的规矩）。 */
  editToken(key: string, raw: string, from: 'picker' | 'hex'): void;
  undoPreview(): void;
  copyAsNew(): void;
  save(): void;
  /** 第一次只是武装，第二次才真删；与工作室共用同一个计时器。 */
  requestDelete(): void;
}

export interface FamilyTheme {
  /** 本机那份记录此刻的样子（方案、挡位、草稿、回执、删除武装）。 */
  readonly snapshot: ThemeStudioSnapshot;
  /** 还贴着呈现种子 = 这一家这一次进来没人把窗口交给记录。 */
  readonly seeded: boolean;
  /** 直接 spread 到家族根节点的 style：种子生效时是这一家的颜色，交还记录后是空对象。 */
  readonly vars: CSSProperties;
  /** 这一扇窗里原生表单控件该按哪半明暗走。 */
  readonly colorScheme: ThemeAppearance;
  readonly tokens: FamilyThemeTokens;
  readonly actions: FamilyThemeActions;
}

/**
 * design-tokens.css 在 :root 上把 --pb-* 绑到配色格，自定义属性在**声明处**就算完了，
 * 子节点改 --paper 不会回头改 --pb-paper。所以贴种子时两层一起贴，家族里的板件才真的跟着变。
 */
const PB_MIRRORED = [
  'paper',
  'paper-2',
  'sheet',
  'sheet-2',
  'sheet-3',
  'ink',
  'ink-soft',
  'ink-dim',
  'line',
  'line-2',
  'line-strong',
  'accent',
  'accent-2',
  'on-accent',
  'ok',
  'warn',
  'danger',
] as const;

const PB_DERIVED: readonly (readonly [string, string])[] = [
  ['--pb-focus', 'var(--pb-accent-2)'],
  ['--pb-ledge-color', 'color-mix(in oklab, var(--pb-line-strong) 62%, var(--pb-ink) 38%)'],
  ['--pb-well', 'var(--pb-sheet-3)'],
];

/**
 * 把一家的种子算成根节点要贴的那一叠声明（纯函数，测试直接读它）。
 *
 * 只认词表里的键：家族写错的格子不会悄悄变成第二条主题记录。
 */
/** 这一家在当前这半明暗下要贴的那几格：浅与黑各一套，没写的格子跟着记录走。 */
export function seedColorsFor(
  seed: FamilyThemeSeed,
  appearance: ThemeAppearance,
): FamilySeedPalette {
  return seed[appearance];
}

export function familySeedDeclarations(
  seed: FamilyThemeSeed,
  appearance: ThemeAppearance,
  base: ThemePalette,
): (readonly [string, string])[] {
  const known = new Set<string>(THEME_TOKEN_KEYS);
  const merged: ThemePalette = { ...base };
  for (const [key, value] of Object.entries(seedColorsFor(seed, appearance))) {
    if (known.has(key) && value !== '') merged[key] = value;
  }
  const out: (readonly [string, string])[] = [...paletteDeclarations(merged)];
  for (const key of PB_MIRRORED) {
    const value = merged[key];
    if (value !== undefined) out.push(['--pb-' + key, value]);
  }
  out.push(...PB_DERIVED);
  return out;
}

/** 自定义属性写成 style 对象：React 认识以 -- 开头的键，值原样落到节点上。 */
export function declarationsToStyle(entries: Iterable<readonly [string, string]>): CSSProperties {
  const style: Record<string, string> = {};
  for (const [name, value] of entries) style[name] = value;
  return style as CSSProperties;
}

/**
 * 家族里「界面配色」那一块要的一切。
 *
 * 换家族会重挂这一钩子（评审外壳按家族 id 打 key）：卸载走控制器 dispose，
 * 撤掉试色、不退订、不写记录，下一家重新从记录起稿。
 */
export function useFamilyTheme(seed: FamilyThemeSeed): FamilyTheme {
  const [controller] = useState<ThemeStudioController>(createThemeStudioController);
  const [seeded, setSeeded] = useState(true);

  useEffect(() => () => controller.dispose(), [controller]);

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  /** 记录驱动的配色动作：先把这一扇窗交还给记录，再做控制器那件事。 */
  const apply = useCallback(
    (run: (studio: ThemeStudioController) => void): void => {
      setSeeded(false);
      run(controller);
    },
    [controller],
  );

  const actions = useMemo<FamilyThemeActions>(
    () => ({
      setName: (value) => controller.setName(value),
      chooseMode: (mode) => controller.chooseMode(mode),
      chooseScheme: (id) => apply((studio) => studio.chooseScheme(id)),
      editToken: (key, raw, from) => apply((studio) => studio.editToken(key, raw, from)),
      undoPreview: () => apply((studio) => studio.undoPreview()),
      copyAsNew: () => apply((studio) => studio.copyAsNew()),
      save: () => apply((studio) => studio.save()),
      requestDelete: () => apply((studio) => studio.requestDelete()),
    }),
    [controller, apply],
  );

  /** 种子的底是记录里那份：家族只声明自己要改的格子，其余跟着用户本机走。 */
  const vars = useMemo(
    () =>
      declarationsToStyle(familySeedDeclarations(seed, snapshot.appearance, committedPalette())),
    [seed, snapshot.appearance, snapshot.draft],
  );

  return {
    snapshot,
    seeded,
    vars: seeded ? vars : {},
    colorScheme: snapshot.appearance,
    tokens: THEME_TOKENS,
    actions,
  };
}
