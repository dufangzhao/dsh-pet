/**
 * 「界面配色」：方案列表、明暗挡位，以及折叠起来的调色盘。
 *
 * 读写都走 theme.ts 那一份本机记录。调色盘里改的每一格只是试色：不落记录，
 * 离开这一页就撤掉；保存才写进去，内置方案只能另存为自定义。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';

import { Button, Field } from '@pet/ui-kit';

import {
  THEMES,
  THEME_APPEARANCE_LABELS,
  THEME_MODE_GLYPHS,
  THEME_MODE_NAMES,
  allSchemes,
  clonePalette,
  committedPalette,
  currentScheme,
  groupedThemeTokens,
  normalizeHex,
  previewPalette,
  readThemeState,
  removeScheme,
  resetPreview,
  resolveAppearance,
  saveCurrentScheme,
  saveSchemeAs,
  schemeSwatches,
  schemeText,
  selectScheme,
  selectedIsCustom,
  subscribeTheme,
  writeThemeState,
  type StoredTheme,
  type ThemeMode,
  type ThemePalette,
} from './theme.js';

import './settings-shell.css';
import './theme-editor.css';

/** 再点一次确认删除的解除武装时限。 */
const DELETE_ARM_MS = 4000;

/** 方案名上限：与记录里的规范化同一个数。 */
const NAME_MAX = 40;

const TEXT = {
  title: '界面配色',
  description: '三套内置配色与自己的方案；浅色与黑夜各存一份，互不覆盖。',
  modeLabel: '明暗挡位',
  schemesLabel: '配色方案',
  builtin: '内置',
  custom: '自定义',
  paletteTitle: '调色盘',
  paletteDesc: '预览仅修改当前浅色或深色配色；保存后保留。',
  schemeName: '方案名',
  colorAria: (label: string) => label + '颜色',
  hexAria: (label: string) => label + '十六进制颜色',
  switchedMode: (label: string) => '已切换到「' + label + '」',
  switchedScheme: (name: string) => '✓ 已切换到「' + name + '」',
  previewing: '● 正在预览，尚未保存',
  resetPreview: '撤销预览',
  previewReset: '已撤销未保存的调色预览',
  deleteScheme: '删除方案',
  confirmDelete: '再次点击确认删除',
  aboutToDelete: (name: string) => '即将删除「' + name + '」；再次点击确认。',
  deleteCancelled: '已取消删除',
  deleted: (name: string) => '已删除自定义方案，并切回「' + name + '」',
  copyAsNew: '复制为新方案',
  copySuffix: ' 副本',
  customSuffix: ' 自定义',
  copied: '✓ 已复制为新的自定义方案',
  saveCurrent: '保存当前方案',
  saveAsCustom: '另存为自定义',
  savedVariant: (appearance: string) => '✓ 当前' + appearance + '变体已保存',
  savedAsCustom: '✓ 内置方案已另存为自定义',
  notSaved: (reason: string) => '配色没能存进本机：' + reason,
  builtinHint: '内置方案不可覆盖；调色后可另存为自定义。',
  customHint: '自定义方案可直接保存；浅色与黑夜变体互相独立。',
  specimenTitle: '组件试色',
  specimenBubble: '发送气泡预览',
  specimenThink: '思考',
  specimenThinkBody: '思考文本预览',
  specimenBody: '正文预览',
  specimenWorld: '[system] 世界事件预览',
  specimenTool: '工具结果文字',
  stateOk: '成功',
  stateWarn: '提醒',
  stateDanger: '失败',
  chartAria: '图表系列色预览',
};

const CHART_BARS: readonly [string, string][] = [
  ['42%', 'chart-hit'],
  ['66%', 'chart-miss'],
  ['86%', 'chart-output'],
  ['58%', 'chart-2'],
  ['74%', 'chart-3'],
  ['50%', 'chart-4'],
];

export interface ThemeEditorProps {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

interface Status {
  readonly text: string;
  readonly bad: boolean;
}

/**
 * 配色那一节的完整控件：挡位、方案卡、调色盘与保存条。
 * 放进 Start 只需要一行 —— 它自己订阅记录，不要求父级传状态。
 */
export function ThemeEditor({
  title = TEXT.title,
  description = TEXT.description,
}: ThemeEditorProps): JSX.Element {
  const [state, setState] = useState<StoredTheme>(readThemeState);
  const scheme = currentScheme(state);
  const appearance = resolveAppearance(state.mode);
  const shown = schemeText(scheme);
  const canWrite = selectedIsCustom(state);
  const groups = useMemo(() => groupedThemeTokens(), []);

  /** 用户正在调、尚未保存的那份调色板，以及每一格正在打字的十六进制文本。 */
  const [draft, setDraft] = useState<ThemePalette>(() => clonePalette(scheme.palettes[appearance]));
  const [name, setName] = useState(shown.name);
  const [hexText, setHexText] = useState<Readonly<Record<string, string>>>({});
  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [armed, setArmed] = useState(false);
  const [status, setStatus] = useState<Status>(() => ({
    text: scheme.builtin === true ? TEXT.builtinHint : TEXT.customHint,
    bad: false,
  }));
  const armTimer = useRef<number | null>(null);

  // 记录是唯一的状态源：换页、换方案、侧栏改挡位，都从订阅里拿回来。
  useEffect(() => subscribeTheme(setState), []);

  useEffect(() => {
    const committed = currentScheme(state);
    const resolved = resolveAppearance(state.mode);
    setDraft(clonePalette(committed.palettes[resolved]));
    setName(schemeText(committed).name);
    setHexText({});
    setInvalidKeys(new Set<string>());
    // 换方案、换挡位都撤掉“再点一次确认删除”的武装：那一次点击认的是原来那张卡。
    if (armTimer.current !== null) {
      window.clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    setArmed(false);
  }, [state]);

  // 离开这一页：撤掉试色，别让一份没保存的草稿留在整个设置台上。
  useEffect(
    () => () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      resetPreview();
    },
    [],
  );

  /** 写记录；写不进本机存储时说写不进，不报成功。 */
  const persist = (next: StoredTheme, success: Status): void => {
    const result = writeThemeState(next);
    setStatus(result.ok ? success : { text: TEXT.notSaved(result.error ?? '未知原因'), bad: true });
  };

  const chooseMode = (mode: ThemeMode): void => {
    persist({ ...state, mode }, { text: TEXT.switchedMode(THEME_MODE_NAMES[mode]), bad: false });
  };

  const chooseScheme = (id: string, label: string): void => {
    const next = selectScheme(state, id);
    if (next === null) return;
    persist(next, { text: TEXT.switchedScheme(label), bad: false });
  };

  /**
   * 改一格颜色。认不出来的十六进制只标红那一格，**不进草稿**：草稿永远是完整合法的一份，
   * 否则保存时会把用户还没打完的那半截写进记录。
   */
  const editToken = (key: string, raw: string, from: 'picker' | 'hex'): void => {
    const normalized = normalizeHex(raw);
    const markInvalid = normalized === null;
    setInvalidKeys((prev) => {
      if (prev.has(key) === markInvalid) return prev;
      const next = new Set(prev);
      if (markInvalid) next.add(key);
      else next.delete(key);
      return next;
    });
    if (from === 'hex') setHexText((prev) => ({ ...prev, [key]: raw }));
    if (normalized === null) return;
    const next = { ...draft, [key]: normalized };
    setDraft(next);
    // 只回填**另一个**控件：回填正在打字的那个会把光标弹到末尾。
    if (from !== 'hex') setHexText((prev) => ({ ...prev, [key]: normalized.toUpperCase() }));
    previewPalette(next);
    setStatus({ text: TEXT.previewing, bad: false });
  };

  const undoPreview = (): void => {
    resetPreview();
    setDraft(committedPalette());
    setHexText({});
    setInvalidKeys(new Set<string>());
    setStatus({ text: TEXT.previewReset, bad: false });
  };

  const trimName = (): string => name.trim();

  const copyAsNew = (): void => {
    const base = trimName() === '' ? shown.name : trimName();
    const suffix = canWrite ? TEXT.copySuffix : TEXT.customSuffix;
    const saved = saveSchemeAs(state, { name: base + suffix, palette: draft, appearance });
    persist(saved.state, { text: TEXT.copied, bad: false });
  };

  const save = (): void => {
    if (canWrite) {
      const next = saveCurrentScheme(state, {
        name: trimName(),
        palette: draft,
        appearance,
        schemeId: state.selectedId,
      });
      if (next === null) return;
      persist(next, {
        text: TEXT.savedVariant(THEME_APPEARANCE_LABELS[appearance]),
        bad: false,
      });
      return;
    }
    const raw = trimName();
    const saved = saveSchemeAs(state, {
      name: raw === shown.name ? shown.name + TEXT.customSuffix : raw,
      palette: draft,
      appearance,
    });
    persist(saved.state, { text: TEXT.savedAsCustom, bad: false });
  };

  const disarmDelete = (): void => {
    if (armTimer.current !== null) {
      window.clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    setArmed(false);
  };

  const remove = (): void => {
    if (!canWrite) return;
    if (!armed) {
      setArmed(true);
      setStatus({ text: TEXT.aboutToDelete(shown.name), bad: true });
      armTimer.current = window.setTimeout(() => {
        armTimer.current = null;
        setArmed(false);
        setStatus({ text: TEXT.deleteCancelled, bad: false });
      }, DELETE_ARM_MS);
      return;
    }
    disarmDelete();
    const next = removeScheme(state, state.selectedId);
    if (next === null) return;
    persist(next, { text: TEXT.deleted(schemeText(currentScheme(next)).name), bad: false });
  };

  const activeIndex = THEMES.indexOf(state.mode);

  return (
    <section className="pk-sheet theme-editor">
      <div className="pk-sheet__head">
        <h2 className="pk-sheet__title">{title}</h2>
      </div>
      <p className="pk-sheet__description">{description}</p>

      <div className="pk-sheet__body">
        <div
          className="console-segmented theme-editor__modes"
          role="radiogroup"
          aria-label={TEXT.modeLabel}
          style={{ '--segment-index': activeIndex } as CSSProperties}
        >
          <span className="console-segmented__thumb" aria-hidden="true" />
          {THEMES.map((mode) => (
            <label key={mode} className="console-segmented__option">
              <input
                type="radio"
                name="theme-editor-mode"
                value={mode}
                aria-label={THEME_MODE_NAMES[mode]}
                checked={state.mode === mode}
                onChange={() => chooseMode(mode)}
              />
              <span className="console-segmented__text" aria-hidden="true">
                {THEME_MODE_GLYPHS[mode] + ' ' + THEME_MODE_NAMES[mode]}
              </span>
            </label>
          ))}
        </div>

        <div className="theme-schemes" role="group" aria-label={TEXT.schemesLabel}>
          {allSchemes(state).map((item) => {
            const label = schemeText(item);
            const active = item.id === state.selectedId;
            return (
              <button
                key={item.id}
                type="button"
                className={'theme-scheme' + (active ? ' theme-scheme--active' : '')}
                aria-pressed={active}
                onClick={() => chooseScheme(item.id, label.name)}
              >
                <span className="theme-scheme__head">
                  <span className="theme-scheme__name">{label.name}</span>
                  <span className="theme-scheme__kind">
                    {item.builtin === true ? TEXT.builtin : TEXT.custom}
                  </span>
                </span>
                <span className="theme-scheme__note">{label.note}</span>
                <span className="theme-swatches" aria-hidden="true">
                  {schemeSwatches(item, appearance).map((color, index) => (
                    <span key={index} style={{ background: color }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <details className="theme-fold">
          <summary className="theme-fold__summary">
            <span className="theme-fold__title">{TEXT.paletteTitle}</span>
            <span className="theme-fold__desc">{TEXT.paletteDesc}</span>
          </summary>

          <div className="theme-bench">
            <div className="theme-bench__colors">
              <Field label={TEXT.schemeName}>
                {({ inputId, describedBy, invalid }) => (
                  <input
                    id={inputId}
                    className="pk-input"
                    type="text"
                    value={name}
                    maxLength={NAME_MAX}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    onChange={(event) => setName(event.target.value)}
                  />
                )}
              </Field>

              {groups.map((bucket) => (
                <section className="theme-color-group" key={bucket.group}>
                  <h4 className="theme-color-group__title">{bucket.group}</h4>
                  <div className="theme-color-grid">
                    {bucket.tokens.map((token) => {
                      const value = draft[token.key] ?? '#000000';
                      const invalid = invalidKeys.has(token.key);
                      return (
                        <label
                          key={token.key}
                          className={'theme-color' + (invalid ? ' theme-color--invalid' : '')}
                        >
                          <input
                            type="color"
                            value={value}
                            aria-label={TEXT.colorAria(token.label)}
                            onChange={(event) => editToken(token.key, event.target.value, 'picker')}
                          />
                          <span className="theme-color__label">{token.label}</span>
                          <input
                            className="pk-input theme-color__hex"
                            type="text"
                            value={hexText[token.key] ?? value.toUpperCase()}
                            maxLength={7}
                            spellCheck={false}
                            aria-label={TEXT.hexAria(token.label)}
                            aria-invalid={invalid}
                            onChange={(event) => editToken(token.key, event.target.value, 'hex')}
                          />
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="theme-bench__sample">
              <h4 className="theme-color-group__title">{TEXT.specimenTitle}</h4>
              <div className="theme-specimen">
                <div className="theme-specimen__bubble">{TEXT.specimenBubble}</div>
                <div className="theme-specimen__agent">
                  <span className="theme-specimen__marker theme-specimen__marker--agent">
                    Agent
                  </span>
                  <span className="theme-specimen__marker theme-specimen__marker--think">
                    {TEXT.specimenThink}
                  </span>
                  <span className="theme-specimen__think">{TEXT.specimenThinkBody}</span>
                  <span className="theme-specimen__body">{TEXT.specimenBody}</span>
                  <span className="theme-specimen__tool">{TEXT.specimenTool}</span>
                </div>
                <div className="theme-specimen__world">{TEXT.specimenWorld}</div>
                <p className="theme-specimen__states">
                  <span className="theme-specimen__state theme-specimen__state--ok">
                    {TEXT.stateOk}
                  </span>
                  <span className="theme-specimen__state theme-specimen__state--warn">
                    {TEXT.stateWarn}
                  </span>
                  <span className="theme-specimen__state theme-specimen__state--danger">
                    {TEXT.stateDanger}
                  </span>
                </p>
                <p className="theme-specimen__buttons">
                  <Button variant="primary" size="small">
                    主操作
                  </Button>
                  <Button size="small">次操作</Button>
                  <Button variant="danger" size="small">
                    危险
                  </Button>
                </p>
                <div className="theme-chart-preview" role="img" aria-label={TEXT.chartAria}>
                  {CHART_BARS.map(([height, key]) => (
                    <span key={key} style={{ height, background: 'var(--' + key + ')' }} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="pk-draft-actions theme-editor__actions">
            <span
              className={'theme-editor__status' + (status.bad ? ' theme-editor__status--bad' : '')}
              role="status"
              aria-live="polite"
            >
              {status.text}
            </span>
            <Button variant="quiet" size="small" onClick={undoPreview}>
              {TEXT.resetPreview}
            </Button>
            {canWrite ? (
              <Button variant="danger" size="small" onClick={remove}>
                {armed ? TEXT.confirmDelete : TEXT.deleteScheme}
              </Button>
            ) : null}
            <Button size="small" onClick={copyAsNew}>
              {TEXT.copyAsNew}
            </Button>
            <Button variant="primary" size="small" onClick={save}>
              {canWrite ? TEXT.saveCurrent : TEXT.saveAsCustom}
            </Button>
          </div>
        </details>
      </div>
    </section>
  );
}
