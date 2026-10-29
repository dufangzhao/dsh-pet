/**
 * 「界面配色」：方案列表、明暗挡位，以及折叠起来的调色盘。
 *
 * 读写都走 theme.ts 那一份本机记录。调色盘里改的每一格只是试色：不落记录，
 * 离开这一页就撤掉；保存才写进去，内置方案只能另存为自定义。
 */
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
} from 'react';

import { Button, Field } from '@pet/ui-kit';

import {
  THEMES,
  THEME_MODE_GLYPHS,
  THEME_MODE_NAMES,
  allSchemes,
  groupedThemeTokens,
  schemeSwatches,
  schemeText,
  type ThemeMode,
} from './theme.js';
import { SCHEME_NAME_MAX, createThemeStudioController } from './original-ui/theme-controller.js';

import './settings-shell.css';
import './theme-editor.css';

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
  resetPreview: '撤销预览',
  deleteScheme: '删除方案',
  confirmDelete: '再次点击确认删除',
  deleteSchemeAria: '删除这个自定义方案',
  copyAsNew: '复制为新方案',
  saveCurrent: '保存当前方案',
  saveAsCustom: '另存为自定义',
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

/**
 * 配色那一节的完整控件：挡位、方案卡、调色盘与保存条。
 * 放进 Start 只需要一行 —— 草稿与写记录的行为都在 original-ui/theme-controller.ts 里，
 * 与新的 OriginalThemeStudio 共用同一个控制器。
 */
export function ThemeEditor({
  title = TEXT.title,
  description = TEXT.description,
}: ThemeEditorProps): JSX.Element {
  const [controller] = useState(createThemeStudioController);
  useEffect(() => () => controller.dispose(), [controller]);
  // 第三个参数是服务端快照：这条记录本来就是同步读出来的，两种渲染拿同一份。
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const groups = useMemo(() => groupedThemeTokens(), []);
  const { record, appearance, draft, hexText, invalidKeys, canWrite, deleteArmed, name } = snapshot;
  const state = record;
  const chooseMode = (mode: ThemeMode): void => controller.chooseMode(mode);
  const chooseScheme = (id: string): void => controller.chooseScheme(id);
  const editToken = (key: string, raw: string, from: 'picker' | 'hex'): void =>
    controller.editToken(key, raw, from);
  const setName = (value: string): void => controller.setName(value);
  const undoPreview = (): void => controller.undoPreview();
  const copyAsNew = (): void => controller.copyAsNew();
  const save = (): void => controller.save();
  const remove = (): void => controller.requestDelete();

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
                onClick={() => chooseScheme(item.id)}
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
                    maxLength={SCHEME_NAME_MAX}
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
              className={
                'theme-editor__status' +
                (snapshot.status.tone === 'danger' ? ' theme-editor__status--bad' : '')
              }
              role="status"
              aria-live="polite"
            >
              {snapshot.status.text}
            </span>
            <Button variant="quiet" size="small" onClick={undoPreview}>
              {TEXT.resetPreview}
            </Button>
            {canWrite ? (
              <Button variant="danger" size="small" onClick={remove}>
                {deleteArmed ? TEXT.confirmDelete : TEXT.deleteScheme}
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
