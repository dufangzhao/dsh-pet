/**
 * 群设置的编辑器：全局默认与按群覆盖复用同一个组件。
 *
 * 字段全部来自契约，界面不自己发明：
 * `contextMessages` / `contextMaxAgeMs` / `mentionEnabled` / `wakeWords` /
 * `proactive{enabled,mode,probability,cooldownMs,maxRepliesPerHour}`。
 *
 * 两处容易做错的地方：
 * - **概率与冷却在两种模式下都允许设置**。模型判断模式同样需要先做一次采样，
 *   禁用概率会让用户以为只有规则模式才受频率限制。
 * - 唤醒词是逗号分隔的文本，只在提交时解析——和名单同一个道理。
 */
import { useEffect, useId, useState, type JSX } from 'react';
import { Button, Field } from '@pet/ui-kit';
import {
  QQ_GROUP_CONTEXT_MAX_AGE_MS,
  QQ_GROUP_CONTEXT_MAX_MESSAGES,
  QQ_PROACTIVE_MAX_REPLIES_HOUR,
  QQ_WAKE_WORDS_MAX,
  type QQGroupSettings,
} from '@pet/contracts';

export interface QQGroupSettingsEditorProps {
  readonly value: QQGroupSettings;
  readonly disabled: boolean;
  /** 标题不同：全局默认 vs 某个群的覆盖。 */
  readonly scopeLabel: string;
  /** testId 前缀，保证全局与按群两处不撞。 */
  readonly testId: string;
  readonly onChange: (next: QQGroupSettings) => void;
}

/** 唤醒词：提交时解析，输入过程中保留原文。 */
function WakeWords({
  value,
  disabled,
  testId,
  onChange,
}: {
  value: readonly string[];
  disabled: boolean;
  testId: string;
  onChange: (next: readonly string[]) => void;
}): JSX.Element {
  const id = useId();
  const joined = value.join(', ');
  const [raw, setRaw] = useState(joined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setRaw(joined);
    setProblem(null);
  }, [joined]);

  const commit = (): void => {
    const words: string[] = [];
    for (const part of raw.split(',')) {
      const word = part.trim();
      if (word === '') continue;
      if (!words.includes(word)) words.push(word);
    }
    if (words.length > QQ_WAKE_WORDS_MAX) {
      setProblem(`唤醒词最多 ${QQ_WAKE_WORDS_MAX} 个，现在有 ${words.length} 个。`);
      return;
    }
    setProblem(null);
    onChange(words);
  };

  return (
    <>
      <Field
        label="唤醒词"
        hint={`最多 ${QQ_WAKE_WORDS_MAX} 个，逗号分隔`}
        {...(problem === null ? {} : { error: problem })}
      >
        {({ inputId, describedBy, invalid }) => (
          <input
            id={inputId || id}
            className="pk-input"
            aria-describedby={describedBy}
            value={raw}
            disabled={disabled}
            placeholder="用逗号分隔；输入完再点应用"
            {...(invalid ? { 'aria-invalid': true as const } : {})}
            data-testid={`${testId}-wake-words`}
            onChange={(event) => setRaw(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
            }}
          />
        )}
      </Field>
      <div className="tc-qq__row">
        <Button
          size="small"
          disabled={disabled}
          data-testid={`${testId}-wake-apply`}
          onClick={commit}
        >
          应用唤醒词
        </Button>
      </div>
    </>
  );
}

export function QQGroupSettingsEditor({
  value,
  disabled,
  scopeLabel,
  testId,
  onChange,
}: QQGroupSettingsEditorProps): JSX.Element {
  const proactive = value.proactive;
  return (
    <>
      <p className="tc-qq__note" data-testid={`${testId}-scope`}>
        {scopeLabel}
      </p>

      <Field label="近期上下文条数" hint={`最多 ${QQ_GROUP_CONTEXT_MAX_MESSAGES} 条`}>
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={0}
            max={QQ_GROUP_CONTEXT_MAX_MESSAGES}
            aria-describedby={describedBy}
            value={value.contextMessages}
            disabled={disabled}
            data-testid={`${testId}-context-messages`}
            onChange={(event) =>
              onChange({
                ...value,
                contextMessages: Math.min(
                  QQ_GROUP_CONTEXT_MAX_MESSAGES,
                  Math.max(0, Number(event.target.value) || 0),
                ),
              })
            }
          />
        )}
      </Field>

      <Field
        label="上下文保留时长"
        hint={`最多 ${Math.round(QQ_GROUP_CONTEXT_MAX_AGE_MS / 60000)} 分钟`}
      >
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={0}
            max={Math.round(QQ_GROUP_CONTEXT_MAX_AGE_MS / 60000)}
            aria-describedby={describedBy}
            value={Math.round(value.contextMaxAgeMs / 60000)}
            disabled={disabled}
            data-testid={`${testId}-context-age`}
            onChange={(event) =>
              onChange({
                ...value,
                contextMaxAgeMs:
                  Math.min(
                    QQ_GROUP_CONTEXT_MAX_AGE_MS,
                    Math.max(0, Number(event.target.value) || 0) * 60000,
                  ) || 0,
              })
            }
          />
        )}
      </Field>

      <label className="tc-qq__check">
        <input
          type="checkbox"
          checked={value.mentionEnabled}
          disabled={disabled}
          data-testid={`${testId}-mention`}
          onChange={(event) => onChange({ ...value, mentionEnabled: event.target.checked })}
        />{' '}
        被 @ 时回复
      </label>

      <WakeWords
        value={value.wakeWords}
        disabled={disabled}
        testId={testId}
        onChange={(wakeWords) => onChange({ ...value, wakeWords })}
      />

      <label className="tc-qq__check">
        <input
          type="checkbox"
          checked={proactive.enabled}
          disabled={disabled}
          data-testid={`${testId}-proactive-enabled`}
          onChange={(event) =>
            onChange({ ...value, proactive: { ...proactive, enabled: event.target.checked } })
          }
        />{' '}
        允许主动回复
      </label>

      <Field label="判断方式" hint="两种都可用；模型判断也需要频率约束">
        {({ inputId, describedBy }) => (
          <select
            id={inputId}
            className="pk-input"
            aria-describedby={describedBy}
            value={proactive.mode}
            disabled={disabled || !proactive.enabled}
            data-testid={`${testId}-proactive-mode`}
            onChange={(event) =>
              onChange({
                ...value,
                proactive: {
                  ...proactive,
                  mode: event.target.value as QQGroupSettings['proactive']['mode'],
                },
              })
            }
          >
            <option value="rule-probability">规则与概率</option>
            <option value="model-assisted">模型判断</option>
          </select>
        )}
      </Field>

      {/*
        概率在**两种模式**下都可设置：模型判断之前同样要先做一次采样。
        之前只在规则模式下可编辑，会让用户以为模型模式不受频率约束。
      */}
      <Field label="采样概率" hint="0 到 1；两种判断方式都先按它采样">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={0}
            max={1}
            step={0.01}
            aria-describedby={describedBy}
            value={proactive.probability}
            disabled={disabled || !proactive.enabled}
            data-testid={`${testId}-probability`}
            onChange={(event) =>
              onChange({
                ...value,
                proactive: {
                  ...proactive,
                  probability: Math.min(1, Math.max(0, Number(event.target.value) || 0)),
                },
              })
            }
          />
        )}
      </Field>

      <Field label="冷却时间" hint="两次主动回复之间至少间隔多少秒">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={0}
            aria-describedby={describedBy}
            value={Math.round(proactive.cooldownMs / 1000)}
            disabled={disabled || !proactive.enabled}
            data-testid={`${testId}-cooldown`}
            onChange={(event) =>
              onChange({
                ...value,
                proactive: {
                  ...proactive,
                  cooldownMs: Math.max(0, Number(event.target.value) || 0) * 1000,
                },
              })
            }
          />
        )}
      </Field>

      <Field label="每小时上限" hint={`最多 ${QQ_PROACTIVE_MAX_REPLIES_HOUR} 条`}>
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={0}
            max={QQ_PROACTIVE_MAX_REPLIES_HOUR}
            aria-describedby={describedBy}
            value={proactive.maxRepliesPerHour}
            disabled={disabled || !proactive.enabled}
            data-testid={`${testId}-max`}
            onChange={(event) =>
              onChange({
                ...value,
                proactive: {
                  ...proactive,
                  maxRepliesPerHour: Math.min(
                    QQ_PROACTIVE_MAX_REPLIES_HOUR,
                    Math.max(0, Number(event.target.value) || 0),
                  ),
                },
              })
            }
          />
        )}
      </Field>
    </>
  );
}
