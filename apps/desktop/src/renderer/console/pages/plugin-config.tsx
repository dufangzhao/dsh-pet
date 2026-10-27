import type { OwnerRef } from '@pet/contracts';
import { useCallback, useEffect, useRef, type JSX } from 'react';

import { Button, EmptyState, Section } from '@pet/ui-kit';

import { ConfigForm } from '../config-form.js';
import { ConsolePane } from '../console-pane.js';
import { COPY } from '../copy.js';
import { usePluginConfig } from '../use-config.js';

export interface PluginConfigPanelProps {
  owner: OwnerRef;
  pluginName: string;
  onBack: () => void;
  /** 让外壳知道有未保存改动，切页与返回列表前才能先确认。 */
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * 单个插件的配置面板：真实 Schema 表单、保存与冲突处理。
 *
 * 表单完全由宿主下发的 ConfigDefinition 驱动，不认任何具体字段名；
 * 保存成功只按返回的 changeMode 提示"需要重载/重启"，不声称已经启用。
 */
export function PluginConfigPanel({
  owner,
  pluginName,
  onBack,
  onDirtyChange,
}: PluginConfigPanelProps): JSX.Element {
  const state = usePluginConfig(owner);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorCount = Object.keys(state.errors).length;
  const { dirty } = state;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // 卸载时交还标记，避免离开后仍然拦截切页。
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // 校验失败后把焦点交给错误摘要，键盘用户不用自己找第一条错误。
  useEffect(() => {
    if (errorCount > 0) {
      summaryRef.current?.focus();
    }
  }, [errorCount]);

  const submit = useCallback(() => {
    void state.save();
  }, [state]);

  if (!state.available) {
    return (
      <ConsolePane title={pluginName}>
        <EmptyState
          title={COPY.missingBridge}
          description="请从桌宠的“设置”重新打开窗口。"
          action={<Button onClick={onBack}>{COPY.backToPlugins}</Button>}
        />
      </ConsolePane>
    );
  }

  const inspected = state.inspection;
  const saved = inspected?.snapshot ?? null;

  return (
    <ConsolePane
      title={pluginName}
      summary="配置由插件声明。保存只会写入配置，不会自动启用插件或让模型变为可用。"
    >
      <div className="config-toolbar">
        <Button size="small" variant="quiet" onClick={onBack}>
          {COPY.backToPlugins}
        </Button>
        <span className="config-toolbar__state">
          {inspected === null
            ? null
            : saved === null
              ? '还没有保存过配置，这次保存会新建一条记录。'
              : `已保存版本 ${saved.revision} · Schema ${saved.schemaVersion}`}
        </span>
      </div>

      {state.loading ? <p className="console-muted">{COPY.loading}</p> : null}

      {state.error === null ? null : (
        <EmptyState
          title="读取配置失败"
          description={state.error}
          action={<Button onClick={state.reload}>{COPY.retry}</Button>}
        />
      )}

      {state.conflict ? (
        <div className="config-banner config-banner--warn" role="alert">
          <p className="config-banner__text">
            这份配置已被其他窗口改过。你的编辑还留在这里，但保存会被拒绝；请先重新读取再决定。
          </p>
          <Button size="small" onClick={state.reload}>
            {COPY.retry}
          </Button>
        </div>
      ) : null}

      {errorCount === 0 ? null : (
        <div
          className="config-banner config-banner--danger"
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
        >
          <p className="config-banner__text">有 {errorCount} 处需要修改，已标在对应字段下方。</p>
        </div>
      )}

      {state.failure === null ? null : (
        <div className="config-banner config-banner--danger" role="alert">
          <p className="config-banner__text">保存失败：{state.failure}</p>
        </div>
      )}

      {state.notice === null ? null : (
        <p className="config-banner config-banner--ok" role="status">
          {state.notice}
        </p>
      )}

      {/* 读取中或读取失败时不给表单：过期的 revision 保存出去只会变成冲突。 */}
      {state.loading ||
      state.error !== null ||
      state.root === null ||
      state.draft === null ? null : (
        <Section title="配置项">
          <form
            className="config-form"
            data-testid="config-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <ConfigForm
              root={state.root}
              draft={state.draft}
              errors={state.errors}
              disabled={state.saving || state.conflict}
              onChange={state.update}
              onPresence={state.presence}
              onAddItem={state.addItem}
              onRemoveItem={state.removeItem}
            />

            <div className="config-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={state.saving || state.conflict}
                data-testid="config-save"
              >
                {state.saving ? '保存中…' : '保存'}
              </Button>
              <Button
                disabled={!dirty || state.saving}
                data-testid="config-reset"
                onClick={state.reload}
              >
                放弃改动
              </Button>
              <span className="config-count">{dirty ? '有未保存的改动' : '没有未保存的改动'}</span>
            </div>
          </form>
        </Section>
      )}
    </ConsolePane>
  );
}
