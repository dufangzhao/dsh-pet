/**
 * 人设完整提示词编辑器（纯展示外壳）。
 *
 * 这里没有会话、没有请求、也没有自己的状态：正文草稿、只读的生效前缀段、
 * 保存结果与显式保存回调全部由父级给。它只保证界面不说谎：
 * 「已保存」「等待当前处理结束后生效」「已生效」「应用失败」是四件不同的事，
 * 按父级给的那一件写；正文超长只拒绝提交，绝不截断用户写的东西。
 */
import type { JSX } from 'react';

import { Button, Card, Field, Status, type StatusTone } from './minimal-ui/controls.js';

/** 生效状态由父级按实际回执给出；组件不自己计时，也不从「保存成功」推断「已生效」。 */
export type PromptApplyState = 'saved' | 'pending' | 'applied' | 'error';

export interface PromptSegment {
  /** 段的稳定标识（后端按 owner 与来源键生成），列表以它为身份。 */
  id: string;
  /** 段的名称，例如「运行环境」「可用工具」。 */
  label: string;
  /** 实际拼进去的文本，原样展示。 */
  text: string;
  /** 这段为什么会是这样；没有依据时不传。 */
  note?: string | undefined;
}

export interface PersonaPromptEditorProps {
  /** 当前正文草稿：完全由父级持有，组件不复制、不缓存。 */
  draft: string;
  onChangeDraft: (next: string) => void;
  /** 显式保存：草稿不会因为输入而自动写入。 */
  onSave: () => void;
  /** 已保存的正文；用来标出「有未保存的改动」。没给就假定可以保存。 */
  saved?: string | undefined;
  /** 生效前缀里可编辑正文之外的只读段，顺序就是实际发送顺序。 */
  segments?: readonly PromptSegment[] | undefined;
  /** 正文字符上限，来自宿主契约；给定时超出就拒绝提交。 */
  maxLength?: number | undefined;
  /** 上一次保存或应用的结果；父级还没有结果时不传，界面不猜。 */
  state?: PromptApplyState | undefined;
  /** state 为 error 时宿主报上来的原因。 */
  error?: string | undefined;
  /** 保存请求进行中。 */
  saving?: boolean | undefined;
  /** 编辑区不可用（例如整页还在读取）。 */
  disabled?: boolean | undefined;
  /** 冲突或失败后重新读取；父级没有这个能力时不传，按钮也不出现。 */
  onReload?: (() => void) | undefined;
}

const APPLY: Readonly<Record<PromptApplyState, { text: string; tone: StatusTone }>> = {
  saved: { text: '已保存', tone: 'muted' },
  pending: { text: '已保存，等待当前处理结束后生效', tone: 'warn' },
  applied: { text: '已生效', tone: 'ok' },
  error: { text: '应用失败', tone: 'danger' },
};

export function PersonaPromptEditor({
  draft,
  onChangeDraft,
  onSave,
  saved,
  segments = [],
  maxLength,
  state,
  error,
  saving = false,
  disabled = false,
  onReload,
}: PersonaPromptEditorProps): JSX.Element {
  const overLimit = maxLength !== undefined && draft.length > maxLength;
  const dirty = saved === undefined || draft !== saved;

  // 超限与宿主失败是两件事，但都只出现在正文这一处，不另开一条提示。
  const limitText = overLimit
    ? `正文已有 ${draft.length} 个字符，超过 ${maxLength} 的上限；删短一些再保存，这里不会替你截断。`
    : undefined;
  const fieldError = limitText ?? error;
  const canSave = !disabled && !saving && !overLimit && dirty;

  return (
    <Card
      title="它的完整提示词"
      action={
        state === undefined ? undefined : (
          <Status tone={APPLY[state].tone}>{APPLY[state].text}</Status>
        )
      }
    >
      <Field label="人设正文" {...(fieldError === undefined ? {} : { error: fieldError })}>
        {({ inputId, describedBy, invalid }) => (
          <div className="inputForm" data-multiline="true">
            <textarea
              className="input"
              id={inputId}
              value={draft}
              rows={10}
              spellCheck={false}
              readOnly={disabled}
              aria-describedby={describedBy}
              aria-invalid={invalid ? true : undefined}
              // 不写 maxLength：属性会悄悄截断输入，与「拒绝但不截断」相反。
              onChange={(event) => onChangeDraft(event.target.value)}
            />
          </div>
        )}
      </Field>

      <div className="card__foot">
        {maxLength === undefined ? null : (
          <span className="row__value">
            {draft.length} / {maxLength} 字符
          </span>
        )}
        {saved !== undefined && dirty ? <span className="row__value">有未保存的改动</span> : null}
        <Button variant="primary" disabled={!canSave} onClick={onSave}>
          {saving ? '正在保存…' : '保存正文'}
        </Button>
        {onReload === undefined ? null : (
          <Button disabled={disabled} onClick={onReload}>
            重新读取
          </Button>
        )}
      </div>

      {segments.length === 0 ? null : (
        <div className="field">
          <span className="field__label">实际发出的完整前缀</span>
          <div className="rows rows--tight">
            {segments.map((segment) => (
              <div className="row" key={segment.id}>
                <span className="row__text">
                  <span className="row__label">{segment.label}</span>
                  {segment.note === undefined ? null : (
                    <span className="row__desc">{segment.note}</span>
                  )}
                  <span className="row__desc">{segment.text}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
