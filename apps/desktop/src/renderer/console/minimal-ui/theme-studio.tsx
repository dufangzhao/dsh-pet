/**
 * 「界面配色」工作室的最小版：挡位、方案卡、36 格调色与保存条。
 *
 * 读写、草稿、十六进制校验与删除二次确认仍在 original-ui/theme-controller.ts 那一个控制器里，
 * 记录仍是 theme.ts 那一份：这里只换版式（白卡 + 50px 字段 + 黑底主按钮），
 * 不新开第二份状态、存储或"再点一次确认删除"。original-ui/theme-studio.tsx 留给版式实验室对照。
 */
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type JSX } from 'react';

import {
  THEMES,
  THEME_APPEARANCE_LABELS,
  THEME_MODE_NAMES,
  THEME_TOKENS,
  allSchemes,
  groupedThemeTokens,
  schemeSwatches,
} from '../theme.js';
import { SCHEME_NAME_MAX, createThemeStudioController } from '../original-ui/theme-controller.js';
import { Button, Card, Field, Status, type StatusTone } from './controls.js';

const HEX_BAD = '认不出这个十六进制，需要 #abc 或 #aabbcc。';

/** 控制器的回执语气只有三种；状态牌多出来的几挡在这里落定，不另起一套。 */
const STATUS_TONE: Readonly<Record<'neutral' | 'ok' | 'danger', StatusTone>> = {
  neutral: 'muted',
  ok: 'ok',
  danger: 'danger',
};

/**
 * 配色工作室：自己订阅记录，不要求父级传状态，所以放进任何一个版式都只有一行。
 */
export function MinimalThemeStudio(): JSX.Element {
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
  const modeLabelId = useId();

  return (
    <div data-testid="theme-studio">
      <Card
        title="界面配色"
        action={
          <span className="row__value" role="status">
            {THEME_MODE_NAMES[record.mode]} · {THEME_APPEARANCE_LABELS[appearance]}变体
          </span>
        }
      >
        <div className="field">
          <span className="field__label" id={modeLabelId}>
            明暗挡位
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby={modeLabelId}>
            {THEMES.map((mode) => (
              <label className="segment" key={mode}>
                <input
                  type="radio"
                  name="theme-mode"
                  value={mode}
                  checked={record.mode === mode}
                  data-testid={'theme-mode-' + mode}
                  onChange={() => controller.chooseMode(mode)}
                />
                <span>{THEME_MODE_NAMES[mode]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="theme-schemes" role="radiogroup" aria-label="界面配色方案">
          {schemes.map((scheme) => (
            <label className="scheme-card" key={scheme.id}>
              <input
                type="radio"
                name="theme-scheme"
                value={scheme.id}
                checked={scheme.id === record.selectedId}
                data-testid={'theme-scheme-' + scheme.id}
                onChange={() => controller.chooseScheme(scheme.id)}
              />
              <span className="scheme-card__name">{scheme.name}</span>
              <span className="scheme-card__colors" aria-hidden="true">
                {schemeSwatches(scheme, appearance).map((color, index) => (
                  <i key={index} style={{ background: color }} />
                ))}
              </span>
            </label>
          ))}
        </div>

        <details className="card">
          <summary className="card__head">
            <span className="card__title">自定义配色</span>
            <span className="row__value">{THEME_TOKENS.length} 色</span>
          </summary>
          <div className="card__body">
            <Field label="方案名">
              {({ inputId }) => (
                <div className="inputForm">
                  <input
                    className="input"
                    id={inputId}
                    type="text"
                    value={name}
                    maxLength={SCHEME_NAME_MAX}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="theme-scheme-name"
                    onChange={(event) => controller.setName(event.target.value)}
                  />
                </div>
              )}
            </Field>

            {groups.map((bucket) => (
              <div className="field" key={bucket.group}>
                <span className="field__label">{bucket.group}</span>
                <div className="field-row">
                  {bucket.tokens.map((token) => {
                    const value = draft[token.key] ?? '#000000';
                    const invalid = invalidKeys.has(token.key);
                    return (
                      <Field
                        key={token.key}
                        label={token.label}
                        className="field--grow"
                        {...(invalid ? { error: HEX_BAD } : {})}
                      >
                        {({ inputId, describedBy }) => (
                          <div className="inputForm">
                            {/* 原生取色井：系统色井本身，只跟着这一栏的密度。 */}
                            <input
                              type="color"
                              className="input theme-token__picker"
                              value={value}
                              aria-label={token.label + '选色'}
                              data-testid={'theme-token-' + token.key + '-picker'}
                              onChange={(event) =>
                                controller.editToken(token.key, event.target.value, 'picker')
                              }
                            />
                            <input
                              className="input"
                              id={inputId}
                              type="text"
                              value={hexText[token.key] ?? value.toUpperCase()}
                              maxLength={7}
                              spellCheck={false}
                              aria-describedby={describedBy}
                              aria-invalid={invalid ? true : undefined}
                              data-testid={'theme-token-' + token.key + '-hex'}
                              onChange={(event) =>
                                controller.editToken(token.key, event.target.value, 'hex')
                              }
                            />
                          </div>
                        )}
                      </Field>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="card__foot">
              <Button variant="primary" data-testid="theme-save" onClick={() => controller.save()}>
                {canWrite ? '保存当前方案' : '另存为自定义'}
              </Button>
              <Button data-testid="theme-copy" onClick={() => controller.copyAsNew()}>
                复制为新方案
              </Button>
              <Button
                data-testid="theme-undo-preview"
                disabled={!snapshot.previewActive}
                onClick={() => controller.undoPreview()}
              >
                撤销预览
              </Button>
              {canWrite ? (
                <Button
                  variant="danger"
                  data-testid="theme-delete"
                  onClick={() => controller.requestDelete()}
                >
                  {snapshot.deleteArmed ? '再次点击确认删除' : '删除方案'}
                </Button>
              ) : null}
            </div>

            <p role="status">
              <Status tone={STATUS_TONE[status.tone]}>{status.text}</Status>
            </p>
          </div>
        </details>
      </Card>
    </div>
  );
}
