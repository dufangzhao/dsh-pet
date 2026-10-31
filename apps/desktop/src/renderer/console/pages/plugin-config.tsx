import type { OwnerRef } from '@pet/contracts';
import { useCallback, useEffect, useRef, type JSX } from 'react';

import { ConfigForm } from '../config-form.js';
import { COPY } from '../copy.js';
import { Button, Card, Status } from '../minimal-ui/controls.js';
import { usePluginConfig } from '../use-config.js';

export interface PluginConfigPanelProps {
  owner: OwnerRef;
  /** 返回入口的文字：从扩展列表和从应用页面进来，回去的地方不一样。 */
  backLabel?: string | undefined;
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
  backLabel = COPY.backToPlugins,
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
      <Card title={COPY.missingBridge}>
        <p className="row__desc">请从桌宠的“设置”重新打开窗口。</p>
        <div className="card__foot">
          <Button onClick={onBack}>{COPY.backToPlugins}</Button>
        </div>
      </Card>
    );
  }

  const inspected = state.inspection;
  const saved = inspected?.snapshot ?? null;

  return (
    <>
      <div className="card__foot">
        <Button size="small" variant="ghost" onClick={onBack}>
          {backLabel}
        </Button>
        {inspected === null ? null : (
          <span className="row__desc">
            {saved === null
              ? '还没有保存过配置，这次保存会新建一条记录。'
              : `已保存版本 ${saved.revision} · Schema ${saved.schemaVersion}`}
          </span>
        )}
      </div>

      <Card title="配置项">
        {state.loading ? <p className="row__desc">{COPY.loading}</p> : null}

        {state.error === null ? null : (
          <div className="card__foot" role="alert">
            <Status tone="danger">{'读取配置失败：' + state.error}</Status>
            <Button size="small" onClick={state.reload}>
              {COPY.retry}
            </Button>
          </div>
        )}

        {state.conflict ? (
          <div className="card__foot" role="alert">
            <Status tone="danger">
              这份配置已被其他窗口改过。你的编辑还留在这里，但保存会被拒绝；请先重新读取再决定。
            </Status>
            <Button size="small" onClick={state.reload}>
              {COPY.retry}
            </Button>
          </div>
        ) : null}

        {errorCount === 0 ? null : (
          <p className="row__desc" role="alert" tabIndex={-1} ref={summaryRef}>
            <Status tone="danger">{`有 ${errorCount} 处需要修改，已标在对应字段下方。`}</Status>
          </p>
        )}

        {state.failure === null ? null : (
          <p className="row__desc" role="alert">
            <Status tone="danger">{'保存失败：' + state.failure}</Status>
          </p>
        )}

        {state.notice === null ? null : (
          <p className="config-banner" role="status">
            {state.notice}
          </p>
        )}

        {/* 读取中或读取失败时不给表单：过期的 revision 保存出去只会变成冲突。 */}
        {state.loading ||
        state.error !== null ||
        state.root === null ||
        state.draft === null ? null : (
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
        )}
      </Card>
    </>
  );
}
