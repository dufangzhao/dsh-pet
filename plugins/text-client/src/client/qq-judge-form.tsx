/**
 * 参与判断模型（judge）的独立表单。
 *
 * 它和主模型是**两个 purpose**：judge 有自己的来源、自己的连接、自己的密钥。
 * 所以这里是一份独立的草稿与独立的 CAS 基线——改它不会动主模型，也不会
 * 顺手推进 policy 的其他部分。
 *
 * 界面只报服务端的 readiness；「已配置」不等于「判断会成功」。
 */
import { useId, type JSX } from 'react';
import { Button, Field, StatusBadge } from '@pet/ui-kit';
import {
  QQ_JUDGE_MAX_ATTEMPTS_HOUR,
  QQ_JUDGE_MAX_OUTPUT_TOKENS,
  QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
  QQ_JUDGE_TIMEOUT_MS,
  type QQJudgeSettings,
  type QQJudgeView,
} from '@pet/contracts';

import type { QQFormState } from './qq-form.js';

export interface JudgeActions {
  readonly saving: boolean;
  readonly writing: boolean;
  readonly dirty: boolean;
  readonly onEdit: (change: (settings: QQJudgeSettings) => QQJudgeSettings) => void;
  readonly onSave: () => void;
  readonly onWriteKey: (value: string | null) => void;
}

/** 服务端 readiness 的原话；不把它读成「连接成功」。 */
function readinessLabel(view: QQJudgeView): {
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
} {
  switch (view.readiness) {
    case 'configured':
      return { label: '已配置', tone: 'ok' };
    case 'unavailable':
      return { label: '不可用', tone: 'danger' };
    default:
      return { label: '还没有配置', tone: 'neutral' };
  }
}

export interface QQJudgeFormProps {
  readonly view: QQJudgeView;
  readonly form: QQFormState;
  /**
   * 密钥输入框的值；由父组件持有，发起即清空。
   *
   * 不能叫 `key`：那是 React 的保留 prop，永远不会作为普通属性传进来，
   * 组件里读到的会是 undefined。
   */
  readonly secretValue: string;
  readonly onSecretChange: (value: string) => void;
  readonly actions: JudgeActions;
}

export function QQJudgeForm({
  view,
  form,
  secretValue,
  onSecretChange,
  actions,
}: QQJudgeFormProps): JSX.Element {
  const id = useId();
  const settings = form.judge?.settings ?? null;
  const facts = readinessLabel(view);
  const canWrite = view.credential.writable;

  if (settings === null) {
    return (
      <p className="tc-qq__note" data-testid="qq-judge-unread">
        还没有读到参与判断的设置。
      </p>
    );
  }

  return (
    <>
      <p className="tc-qq__line" data-testid="qq-judge-state">
        <StatusBadge tone={facts.tone}>{facts.label}</StatusBadge>
        <span className="tc-qq__detail">配置修订 {view.configRevision}</span>
        {view.appliedRevision === null ? null : (
          <span className="tc-qq__detail">生效修订 {view.appliedRevision}</span>
        )}
      </p>

      <Field
        label="判断模型地址"
        hint="这个 purpose 自己的网关地址，和主模型无关"
        description="保存不会调用模型，也不会替你做一次判断。"
      >
        {({ inputId, describedBy }) => (
          <input
            id={inputId || id}
            className="pk-input"
            aria-describedby={describedBy}
            value={settings.connection.baseUrl}
            spellCheck={false}
            disabled={actions.saving}
            data-testid="qq-judge-base-url"
            onChange={(event) => {
              const value = event.target.value;
              actions.onEdit((current) => ({
                ...current,
                connection: { ...current.connection, baseUrl: value },
              }));
            }}
          />
        )}
      </Field>

      <Field label="判断模型" hint="完整的模型 ID；留空就是还没选">
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            aria-describedby={describedBy}
            value={settings.connection.model}
            spellCheck={false}
            placeholder="vendor/model-name"
            disabled={actions.saving}
            data-testid="qq-judge-model"
            onChange={(event) => {
              const value = event.target.value;
              actions.onEdit((current) => ({
                ...current,
                connection: { ...current.connection, model: value },
              }));
            }}
          />
        )}
      </Field>

      <Field label="鉴权方式" hint="不读文字连接的密钥">
        {({ inputId, describedBy }) => (
          <select
            id={inputId}
            className="pk-input"
            aria-describedby={describedBy}
            value={settings.connection.authMode}
            disabled={actions.saving}
            data-testid="qq-judge-auth"
            onChange={(event) => {
              const value = event.target.value as 'local-client-id' | 'gateway-key';
              actions.onEdit((current) => ({
                ...current,
                connection: { ...current.connection, authMode: value },
              }));
            }}
          >
            <option value="local-client-id">本机标识（仅回环）</option>
            <option value="gateway-key">网关密钥</option>
          </select>
        )}
      </Field>

      <Field label="每小时尝试上限" hint={`最多 ${QQ_JUDGE_MAX_ATTEMPTS_HOUR} 次`}>
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={0}
            max={QQ_JUDGE_MAX_ATTEMPTS_HOUR}
            aria-describedby={describedBy}
            value={settings.maxAttemptsPerHour}
            disabled={actions.saving}
            data-testid="qq-judge-attempts"
            onChange={(event) => {
              const value = Math.min(
                QQ_JUDGE_MAX_ATTEMPTS_HOUR,
                Math.max(0, Number(event.target.value) || 0),
              );
              actions.onEdit((current) => ({ ...current, maxAttemptsPerHour: value }));
            }}
          />
        )}
      </Field>

      <Field label="同一群最小间隔" hint={`至少 ${QQ_JUDGE_MIN_GROUP_INTERVAL_MS} 毫秒`}>
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={QQ_JUDGE_MIN_GROUP_INTERVAL_MS}
            aria-describedby={describedBy}
            value={settings.perGroupIntervalMs}
            disabled={actions.saving}
            data-testid="qq-judge-interval"
            onChange={(event) => {
              const value = Math.max(
                QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
                Number(event.target.value) || QQ_JUDGE_MIN_GROUP_INTERVAL_MS,
              );
              actions.onEdit((current) => ({ ...current, perGroupIntervalMs: value }));
            }}
          />
        )}
      </Field>

      <Field label="超时" hint={`最多 ${QQ_JUDGE_TIMEOUT_MS} 毫秒`}>
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={1}
            max={QQ_JUDGE_TIMEOUT_MS}
            aria-describedby={describedBy}
            value={settings.timeoutMs}
            disabled={actions.saving}
            data-testid="qq-judge-timeout"
            onChange={(event) => {
              const value = Math.min(
                QQ_JUDGE_TIMEOUT_MS,
                Math.max(1, Number(event.target.value) || 1),
              );
              actions.onEdit((current) => ({ ...current, timeoutMs: value }));
            }}
          />
        )}
      </Field>

      <Field label="输出 token 上限" hint={`最多 ${QQ_JUDGE_MAX_OUTPUT_TOKENS}`}>
        {({ inputId, describedBy }) => (
          <input
            id={inputId}
            className="pk-input"
            type="number"
            min={1}
            max={QQ_JUDGE_MAX_OUTPUT_TOKENS}
            aria-describedby={describedBy}
            value={settings.maxOutputTokens}
            disabled={actions.saving}
            data-testid="qq-judge-tokens"
            onChange={(event) => {
              const value = Math.min(
                QQ_JUDGE_MAX_OUTPUT_TOKENS,
                Math.max(1, Number(event.target.value) || 1),
              );
              actions.onEdit((current) => ({ ...current, maxOutputTokens: value }));
            }}
          />
        )}
      </Field>

      <p className="tc-qq__note" data-testid="qq-judge-credential">
        {view.credential.available ? `密钥已配置（${view.credential.source}）` : '还没有配置密钥'}
        {canWrite ? '' : ' · 由服务侧写入'}
      </p>

      {canWrite ? (
        <>
          <Field label="写入密钥" hint="只在这一次请求里存在">
            {({ inputId, describedBy }) => (
              <input
                id={inputId}
                className="pk-input"
                type="password"
                aria-describedby={describedBy}
                value={secretValue}
                autoComplete="off"
                disabled={actions.writing}
                data-testid="qq-judge-key"
                onChange={(event) => onSecretChange(event.target.value)}
              />
            )}
          </Field>
          <div className="tc-qq__row">
            <Button
              size="small"
              disabled={actions.writing || secretValue.trim() === ''}
              data-testid="qq-judge-write-key"
              onClick={() => actions.onWriteKey(secretValue)}
            >
              写入密钥
            </Button>
            <Button
              size="small"
              variant="quiet"
              disabled={actions.writing}
              data-testid="qq-judge-clear-key"
              onClick={() => actions.onWriteKey(null)}
            >
              清除密钥
            </Button>
          </div>
        </>
      ) : null}

      <div className="tc-qq__row">
        <Button
          size="small"
          disabled={actions.saving || !actions.dirty}
          data-testid="qq-save-judge"
          onClick={actions.onSave}
        >
          保存参与判断设置
        </Button>
      </div>
    </>
  );
}
