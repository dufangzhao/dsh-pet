/**
 * 「界面配色」的 headless 控制器：草稿、十六进制校验、删除二次确认、保存/另存/复制与试色回执。
 *
 * 不画东西、不认 React，只认 theme.ts 那一份本机记录。旧 ThemeEditor 与新的 OriginalThemeStudio
 * 共用这一个控制器，行为不会分叉，也不会有第二份「再点一次确认删除」的计时器。
 *
 * 草稿的生命周期：调色草稿、方案名与逐格十六进制文本属于**这一个控制器实例**，只在挂载期间活着。
 * 换方案、换明暗、或记录在别处被改写，都从记录重新起稿；写记录只发生在挡位/方案切换、保存、
 * 另存为、复制与删除，其余改动只是试色。卸载（离开这一页或换版式）撤掉试色，不留第二份状态。
 */

import {
  THEME_APPEARANCE_LABELS,
  THEME_MODE_NAMES,
  committedPalette,
  currentScheme,
  normalizeHex,
  previewPalette,
  readThemeState,
  removeScheme,
  resetPreview,
  resolveAppearance,
  saveCurrentScheme,
  saveSchemeAs,
  schemeText,
  selectScheme,
  selectedIsCustom,
  subscribeTheme,
  writeThemeState,
  type StoredTheme,
  type ThemeAppearance,
  type ThemeMode,
  type ThemePalette,
} from '../theme.js';

/** 再点一次确认删除的解除武装时限。 */
export const DELETE_ARM_MS = 4000;

/** 方案名上限：与记录里的规范化同一个数。 */
export const SCHEME_NAME_MAX = 40;

export type StudioTone = 'neutral' | 'ok' | 'danger';

export interface StudioStatus {
  readonly text: string;
  readonly tone: StudioTone;
}

/** 界面一次渲染需要的全部值；每次变更后换一个对象引用。 */
export interface ThemeStudioSnapshot {
  readonly record: StoredTheme;
  readonly schemeId: string;
  readonly schemeName: string;
  readonly schemeNote: string;
  readonly appearance: ThemeAppearance;
  /** 用户正在调、尚未保存的那份调色板：永远是一整份合法值。 */
  readonly draft: ThemePalette;
  readonly name: string;
  /** 逐格正在打字的十六进制原文；没有则界面显示草稿值的大写。 */
  readonly hexText: Readonly<Record<string, string>>;
  /** 认不出的那一格：只标红，不进草稿。 */
  readonly invalidKeys: ReadonlySet<string>;
  readonly deleteArmed: boolean;
  /** 选中的是自定义方案：能覆盖保存，也能删除。 */
  readonly canWrite: boolean;
  /** 有试色还没落到记录里：撤销预览只对这一格负责。 */
  readonly previewActive: boolean;
  readonly status: StudioStatus;
}

export interface ThemeStudioController {
  getSnapshot(): ThemeStudioSnapshot;
  subscribe(listener: () => void): () => void;
  setName(value: string): void;
  chooseMode(mode: ThemeMode): void;
  chooseScheme(id: string): void;
  editToken(key: string, raw: string, from: 'picker' | 'hex'): void;
  undoPreview(): void;
  copyAsNew(): void;
  save(): void;
  /** 第一次按下只是武装，第二次才真删；超时自动收回。 */
  requestDelete(): void;
  /** 卸载：退订、撤掉计时器与试色，不写记录。 */
  dispose(): void;
}

/** 回执里那些句子只有这一份：界面不复读，两个编辑器说的也就是同一句。 */
const TEXT = {
  builtinHint: '内置方案不可覆盖；调色后可另存为自定义。',
  customHint: '自定义方案可直接保存；浅色与黑夜变体互相独立。',
  switchedMode: (label: string) => '已切换到「' + label + '」',
  switchedScheme: (name: string) => '✓ 已切换到「' + name + '」',
  previewing: '● 正在预览，尚未保存',
  previewReset: '已撤销未保存的调色预览',
  aboutToDelete: (name: string) => '即将删除「' + name + '」；再次点击确认。',
  deleteCancelled: '已取消删除',
  deleted: (name: string) => '已删除自定义方案，并切回「' + name + '」',
  copySuffix: ' 副本',
  customSuffix: ' 自定义',
  copied: '✓ 已复制为新的自定义方案',
  savedVariant: (appearance: string) => '✓ 当前' + appearance + '变体已保存',
  savedAsCustom: '✓ 内置方案已另存为自定义',
  notSaved: (reason: string) => '配色没能存进本机：' + reason,
};

const ok = (text: string): StudioStatus => ({ text, tone: 'ok' });
const neutral = (text: string): StudioStatus => ({ text, tone: 'neutral' });

/** 起稿时那句开场提示：内置与自定义给的操作不一样，说明也不一样。 */
function hintStatus(state: StoredTheme): StudioStatus {
  return neutral(selectedIsCustom(state) ? TEXT.customHint : TEXT.builtinHint);
}

export function createThemeStudioController(): ThemeStudioController {
  let record = readThemeState();
  let scheme = currentScheme(record);
  let appearance = resolveAppearance(record.mode);
  let draft = { ...scheme.palettes[appearance] };
  let name = schemeText(scheme).name;
  let hexText: Readonly<Record<string, string>> = {};
  let invalidKeys: ReadonlySet<string> = new Set<string>();
  let deleteArmed = false;
  let previewActive = false;
  let status = hintStatus(record);
  let snapshot = build();
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  let unsubscribeRecord: (() => void) | null = null;

  function build(): ThemeStudioSnapshot {
    const shown = schemeText(scheme);
    return {
      record,
      schemeId: scheme.id,
      schemeName: shown.name,
      schemeNote: shown.note,
      appearance,
      draft,
      name,
      hexText,
      invalidKeys,
      deleteArmed,
      canWrite: selectedIsCustom(record),
      previewActive,
      status,
    };
  }

  function notify(): void {
    snapshot = build();
    for (const listener of [...listeners]) listener();
  }

  function disarmTimer(): void {
    if (armTimer === null) return;
    clearTimeout(armTimer);
    armTimer = null;
  }

  /** 从记录重新起稿：试色文本、无效格、删除武装与预览标记都归零。 */
  function reprime(state: StoredTheme): void {
    record = state;
    scheme = currentScheme(state);
    appearance = resolveAppearance(state.mode);
    draft = { ...scheme.palettes[appearance] };
    name = schemeText(scheme).name;
    hexText = {};
    invalidKeys = new Set<string>();
    deleteArmed = false;
    previewActive = false;
    disarmTimer();
  }

  /**
   * 写记录；写不进本机存储时说的是写不进，不报成功。
   *
   * 写成功就地从那条记录重新起稿：草稿与回执在同一次通知里落地，不依赖有没有人订阅这条记录。
   */
  function persist(next: StoredTheme, result: StudioStatus): void {
    const written = writeThemeState(next);
    if (!written.ok) {
      status = { text: TEXT.notSaved(written.error ?? '未知原因'), tone: 'danger' };
      notify();
      return;
    }
    reprime(next);
    status = result;
    notify();
  }

  /** 别处写的记录从这里回来（侧栏挡位、另一个编辑器）；自己刚写过的那一次不再走一遍。 */
  function onRecord(state: StoredTheme): void {
    if (state === record) return;
    reprime(state);
    notify();
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      // 第一个听众把记录的订阅挂上，最后一个走了就退掉：没有人看的编辑器不留订阅。
      if (listeners.size === 1) unsubscribeRecord = subscribeTheme(onRecord);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeRecord?.();
          unsubscribeRecord = null;
        }
      };
    },

    setName(value) {
      name = value.slice(0, SCHEME_NAME_MAX);
      notify();
    },

    chooseMode(mode) {
      if (record.mode === mode) return;
      persist({ ...record, mode }, ok(TEXT.switchedMode(THEME_MODE_NAMES[mode])));
    },

    chooseScheme(id) {
      const next = selectScheme(record, id);
      if (next === null) return;
      persist(next, ok(TEXT.switchedScheme(schemeText(currentScheme(next)).name)));
    },

    /**
     * 改一格颜色。认不出的十六进制只标红那一格，**不进草稿**：草稿永远是完整合法的一份，
     * 否则保存时会把用户还没打完的那半截写进记录。
     */
    editToken(key, raw, from) {
      const normalized = normalizeHex(raw);
      const invalid = new Set(invalidKeys);
      if (normalized === null) invalid.add(key);
      else invalid.delete(key);
      if (from === 'hex') hexText = { ...hexText, [key]: raw };
      if (normalized === null) {
        invalidKeys = invalid;
        notify();
        return;
      }
      draft = { ...draft, [key]: normalized };
      previewPalette(draft);
      // 只回填**另一个**控件：回填正在打字的那个会把光标弹到末尾。
      if (from === 'picker') hexText = { ...hexText, [key]: normalized.toUpperCase() };
      invalidKeys = invalid;
      previewActive = true;
      status = neutral(TEXT.previewing);
      notify();
    },

    undoPreview() {
      resetPreview();
      draft = committedPalette();
      hexText = {};
      invalidKeys = new Set<string>();
      previewActive = false;
      status = neutral(TEXT.previewReset);
      notify();
    },

    copyAsNew() {
      const base = name.trim() === '' ? schemeText(scheme).name : name.trim();
      persist(
        saveSchemeAs(record, {
          name: base + (selectedIsCustom(record) ? TEXT.copySuffix : TEXT.customSuffix),
          palette: draft,
          appearance,
        }).state,
        ok(TEXT.copied),
      );
    },

    save() {
      const trimmed = name.trim();
      const shown = schemeText(scheme).name;
      if (selectedIsCustom(record)) {
        const next = saveCurrentScheme(record, {
          name: trimmed,
          palette: draft,
          appearance,
          schemeId: record.selectedId,
        });
        if (next === null) return;
        persist(next, ok(TEXT.savedVariant(THEME_APPEARANCE_LABELS[appearance])));
        return;
      }
      persist(
        saveSchemeAs(record, {
          name: trimmed === shown ? shown + TEXT.customSuffix : trimmed,
          palette: draft,
          appearance,
        }).state,
        ok(TEXT.savedAsCustom),
      );
    },

    requestDelete() {
      if (!selectedIsCustom(record)) return;
      if (!deleteArmed) {
        deleteArmed = true;
        status = { text: TEXT.aboutToDelete(schemeText(scheme).name), tone: 'danger' };
        notify();
        armTimer = setTimeout(() => {
          armTimer = null;
          deleteArmed = false;
          status = neutral(TEXT.deleteCancelled);
          notify();
        }, DELETE_ARM_MS);
        return;
      }
      disarmTimer();
      const next = removeScheme(record, record.selectedId);
      if (next === null) return;
      deleteArmed = false;
      persist(next, ok(TEXT.deleted(schemeText(currentScheme(next)).name)));
    },

    dispose() {
      disarmTimer();
      unsubscribeRecord?.();
      unsubscribeRecord = null;
      // 这一页没了：试色不该留在整个设置台上。
      resetPreview();
    },
  };
}
