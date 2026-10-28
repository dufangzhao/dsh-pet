/**
 * 人设完整提示词编辑器（纯展示外壳）。
 *
 * 这里没有会话、没有请求、也没有自己的状态：正文草稿、只读的生效前缀段、
 * 保存结果与显式保存回调全部由父级给。它只保证界面不说谎：
 * 「已保存」「等待当前处理结束后生效」「已生效」「应用失败」是四件不同的事，
 * 按父级给的那一件写；正文超长只拒绝提交，绝不截断用户写的东西。
 *
 * 样式与设置台外壳同一张表：外壳已经 import，这里再 import 一次，
 * 编辑器单独被使用时也带着自己的排版。
 */
import './settings-shell.css';

import type { JSX } from 'react';

import { Button, Field, Section, StatusBadge, type Tone } from '@pet/ui-kit';

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

const APPLY: Readonly<Record<PromptApplyState, { text: string; tone: Tone }>> = {
  saved: { text: '已保存', tone: 'neutral' },
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
    <Section
      title="它的完整提示词"
      description="可编辑的是人设正文；下面列出发送时拼在正文之外的只读段。"
      actions={
        state === undefined ? undefined : (
          <span className="pk-prompt__status" role="status">
            <StatusBadge tone={APPLY[state].tone}>{APPLY[state].text}</StatusBadge>
          </span>
        )
      }
    >
      <div className="pk-prompt">
        <Field
          label="人设正文"
          description="输入不会自动写入，点「保存正文」才提交这一段。"
          error={fieldError}
        >
          {({ inputId, describedBy, invalid }) => (
            <textarea
              id={inputId}
              className="pk-prompt__input"
              value={draft}
              rows={10}
              spellCheck={false}
              readOnly={disabled}
              aria-describedby={describedBy}
              aria-invalid={invalid ? true : undefined}
              // 不写 maxLength：属性会悄悄截断输入，与「拒绝但不截断」相反。
              onChange={(event) => onChangeDraft(event.target.value)}
            />
          )}
        </Field>

        <div className="pk-prompt__foot">
          {maxLength === undefined ? null : (
            <span
              className={overLimit ? 'pk-prompt__count pk-prompt__count--over' : 'pk-prompt__count'}
            >
              {draft.length} / {maxLength} 字符
            </span>
          )}
          {saved !== undefined && dirty ? (
            <span className="pk-prompt__draft">有未保存的改动</span>
          ) : null}
          <Button variant="primary" disabled={!canSave} onClick={onSave}>
            {saving ? '正在保存…' : '保存正文'}
          </Button>
          {onReload === undefined ? null : (
            <Button variant="quiet" disabled={disabled} onClick={onReload}>
              重新读取
            </Button>
          )}
        </div>

        {segments.length === 0 ? null : (
          <div className="pk-prompt__prefix">
            <p className="pk-prompt__prefix-title">实际发出的完整前缀</p>
            <p className="pk-prompt__prefix-note">
              正文之外的段按发送顺序列出，在这里只读；要改它们请在对应设置里改。
            </p>
            <ol className="pk-prompt__segments">
              {segments.map((segment) => (
                <li className="pk-prompt__segment" key={segment.id}>
                  <span className="pk-prompt__segment-head">
                    <span className="pk-prompt__segment-label">{segment.label}</span>
                    {segment.note === undefined ? null : (
                      <span className="pk-prompt__segment-note">{segment.note}</span>
                    )}
                  </span>
                  <pre className="pk-prompt__segment-text">{segment.text}</pre>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Section>
  );
}
