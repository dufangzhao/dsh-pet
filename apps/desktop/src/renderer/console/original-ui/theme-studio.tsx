/**
 * 「界面配色」工作室：挡位、方案板、36 格调色与保存条。
 *
 * 板件一律来自 site-ui 的那套网站来源控件（按钮、输入栏、瓦片、抽屉段、状态牌、回执）；
 * 这一层只改「用哪件控件」，不动读写：记录仍是 theme.ts 那一份，草稿与写入行为仍在
 * original-ui/theme-controller.ts，共用同一个控制器，不会有第二份「再点一次确认删除」。
 *
 * 挂载 = 从记录起稿；卸载 = 撤掉试色（控制器 dispose）。换版式不写第二份存储。
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from 'react';

import {
  THEMES,
  THEME_APPEARANCE_LABELS,
  THEME_MODE_NAMES,
  allSchemes,
  groupedThemeTokens,
  schemeSwatches,
  type ThemeMode,
} from '../theme.js';
import { SourceButton as Button } from '../site-ui/source-button.js';
import { SourceDisclosure as Disclosure } from '../site-ui/source-panel.js';
import { SourceField as Field, SourceInput as Input } from '../site-ui/source-input.js';
import { SourceNotice as Notice, SourceStatus as Status } from '../site-ui/source-status.js';
import { SourceTile as Tile } from '../site-ui/source-tile.js';
import { SCHEME_NAME_MAX, createThemeStudioController } from './theme-controller.js';

import './theme-studio.css';

/** 挡位瓦片右边那一句：只说这一挡做什么，读屏拿到的是挡位名本身。 */
const THEME_MODE_HINTS: Readonly<Record<ThemeMode, string>> = {
  light: '一直浅色',
  dark: '一直黑夜',
  system: '跟着系统走',
};

const TEXT = {
  title: '界面配色',
  description: '三套自有配色与自己的方案；浅色与黑夜各存一份，互不覆盖。',
  modeLabel: '明暗挡位',
  schemesLabel: '配色方案',
  builtin: '内置',
  custom: '自定义',
  paletteTitle: '调色盘',
  paletteHint: '每一格只是试色，保存才写进本机记录。',
  schemeName: '方案名',
  nameHint: '另存或覆盖时用它；最长 40 字。',
  hexBad: '认不出这个十六进制，需要 #abc 或 #aabbcc。',
  pickerAria: (label: string) => label + '选色',
  undoPreview: '撤销预览',
  deleteScheme: '删除方案',
  confirmDelete: '再次点击确认删除',
  copyAsNew: '复制为新方案',
  saveCurrent: '保存当前方案',
  saveAsCustom: '另存为自定义',
  sampleTitle: '板面试色',
  sampleBubble: '发送气泡预览',
  sampleTool: '工具结果文字',
  sampleWorld: '[system] 世界事件预览',
  chartAria: '图表系列色预览',
};

/** 右边那块板用真控件说话：状态、回执、主操作、气泡与六根系列柱。 */
const CHART_BARS: readonly [string, string][] = [
  ['42%', 'chart-hit'],
  ['66%', 'chart-miss'],
  ['86%', 'chart-output'],
  ['58%', 'chart-2'],
  ['74%', 'chart-3'],
  ['50%', 'chart-4'],
];

export interface OriginalThemeStudioProps {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * 配色工作室：自己订阅记录，不要求父级传状态，所以放进任何一个版式都只有一行。
 */
export function OriginalThemeStudio({
  title = TEXT.title,
  description = TEXT.description,
}: OriginalThemeStudioProps): JSX.Element {
  const [controller] = useState(createThemeStudioController);
  useEffect(() => () => controller.dispose(), [controller]);
  // 第三个参数是服务端快照：这条记录本来就是同步读出来的，两种渲染拿同一份。
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const groups = useMemo(() => groupedThemeTokens(), []);
  const { record, draft, hexText, invalidKeys, name, appearance, canWrite, status } = snapshot;
  const schemes = allSchemes(record);

  return (
    <section className="theme-studio" data-testid="theme-studio" aria-label={title}>
      <header className="theme-studio__head">
        <h2 className="theme-studio__title">{title}</h2>
        <Status tone={appearance === 'dark' ? 'off' : 'on'}>
          {THEME_MODE_NAMES[record.mode]} · {THEME_APPEARANCE_LABELS[appearance]}变体
        </Status>
      </header>
      <p className="theme-studio__description">{description}</p>

      <div className="theme-studio__modes" role="radiogroup" aria-label={TEXT.modeLabel}>
        {THEMES.map((mode: ThemeMode) => (
          <Tile
            key={mode}
            role="radio"
            aria-checked={record.mode === mode}
            className="theme-studio__mode"
            note={THEME_MODE_HINTS[mode]}
            data-testid={'theme-mode-' + mode}
            onClick={() => controller.chooseMode(mode)}
          >
            {THEME_MODE_NAMES[mode]}
          </Tile>
        ))}
      </div>

      <div className="theme-studio__schemes" role="group" aria-label={TEXT.schemesLabel}>
        {schemes.map((scheme) => {
          const active = scheme.id === record.selectedId;
          return (
            <Tile
              key={scheme.id}
              selected={active}
              note={scheme.builtin === true ? TEXT.builtin : TEXT.custom}
              leading={
                <span className="theme-studio__band" aria-hidden="true">
                  {schemeSwatches(scheme, appearance).map((color, index) => (
                    <span key={index} style={{ background: color }} />
                  ))}
                </span>
              }
              data-testid={'theme-scheme-' + scheme.id}
              onClick={() => controller.chooseScheme(scheme.id)}
            >
              {scheme.name}
            </Tile>
          );
        })}
      </div>

      <Disclosure
        label={TEXT.paletteTitle}
        hint={TEXT.paletteHint}
        className="theme-studio__palette"
        defaultOpen
      >
        <div className="theme-studio__bench">
          <div className="theme-studio__fields">
            <Field label={TEXT.schemeName} hint={TEXT.nameHint}>
              {({ inputId, describedBy, invalid }) => (
                <Input
                  id={inputId}

                  type="text"
                  value={name}
                  maxLength={SCHEME_NAME_MAX}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  data-testid="theme-scheme-name"
                  onChange={(event) => controller.setName(event.target.value)}
                />
              )}
            </Field>

            {groups.map((bucket) => (
              <section className="theme-studio__group" key={bucket.group}>
                <h3 className="theme-studio__group-title">{bucket.group}</h3>
                <div className="theme-studio__grid">
                  {bucket.tokens.map((token) => {
                    const value = draft[token.key] ?? '#000000';
                    const invalid = invalidKeys.has(token.key);
                    return (
                      <Field
                        key={token.key}
                        label={token.label}
                        {...(invalid ? { error: TEXT.hexBad } : {})}
                        className="theme-studio__token"
                      >
                        {({ inputId, describedBy }) => (
                          <span className="theme-studio__token-row">
                            {/* 原生取色井：来源包里没有这一件，保留系统的色井样子，只跟着这一栏的密度。 */}
                            <input
                              type="color"
                              className="theme-studio__picker"
                              value={value}
                              aria-label={TEXT.pickerAria(token.label)}
                              data-testid={'theme-token-' + token.key + '-picker'}
                              onChange={(event) =>
                                controller.editToken(token.key, event.target.value, 'picker')
                              }
                            />
                            <Input
                              id={inputId}
                              className="theme-studio__hex"
                              type="text"
                              value={hexText[token.key] ?? value.toUpperCase()}
                              maxLength={7}
                              spellCheck={false}
                              aria-describedby={describedBy}
                              aria-invalid={invalid}
                              data-testid={'theme-token-' + token.key + '-hex'}
                              onChange={(event) =>
                                controller.editToken(token.key, event.target.value, 'hex')
                              }
                            />
                          </span>
                        )}
                      </Field>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="theme-studio__sample">
            <h3 className="theme-studio__group-title">{TEXT.sampleTitle}</h3>
            <div className="theme-studio__sample-body">
              <Notice tone="ok" live={false}>
                这一句跟着配色走：保存之前它只是试色。
              </Notice>
              <p className="theme-studio__bubble">{TEXT.sampleBubble}</p>
              <p className="theme-studio__tool">{TEXT.sampleTool}</p>
              <p className="theme-studio__world">{TEXT.sampleWorld}</p>
              <p className="theme-studio__row">
                <Button variant="primary" size="small">
                  主操作
                </Button>
                <Button size="small">次操作</Button>
                <Button variant="danger" size="small">
                  危险
                </Button>
              </p>
              <div className="theme-studio__chart" role="img" aria-label={TEXT.chartAria}>
                {CHART_BARS.map(([height, key]) => (
                  <span key={key} style={{ height, background: 'var(--' + key + ')' }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="theme-studio__actions">
          <Notice
            tone={status.tone === 'danger' ? 'danger' : 'neutral'}
            className="theme-studio__status"
          >
            {status.text}
          </Notice>
          <Button
            variant="quiet"
            size="small"
            disabled={!snapshot.previewActive}
            data-testid="theme-undo-preview"
            onClick={() => controller.undoPreview()}
          >
            {TEXT.undoPreview}
          </Button>
          {canWrite ? (
            <Button
              variant="danger"
              size="small"
              data-testid="theme-delete"
              onClick={() => controller.requestDelete()}
            >
              {snapshot.deleteArmed ? TEXT.confirmDelete : TEXT.deleteScheme}
            </Button>
          ) : null}
          <Button size="small" data-testid="theme-copy" onClick={() => controller.copyAsNew()}>
            {TEXT.copyAsNew}
          </Button>
          <Button
            variant="primary"
            size="small"
            data-testid="theme-save"
            onClick={() => controller.save()}
          >
            {canWrite ? TEXT.saveCurrent : TEXT.saveAsCustom}
          </Button>
        </div>
      </Disclosure>
    </section>
  );
}
