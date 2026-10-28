import { useEffect, useRef, useState, type JSX } from 'react';

import type { ConsoleSnapshot } from '@pet/contracts';

import { Button, Field, Section, StatusBadge } from '@pet/ui-kit';

import type { AppView } from '../app-views.js';
import { ConsoleStatus } from '../console-status.js';
import { COPY } from '../copy.js';
import { hostSummary, hostRuntime, taskSummary, demoReplyMode } from '../labels.js';
import { PetPreview } from '../pet-preview.js';
import { SettingsRow, SettingsRows } from '../settings-shell.js';
import type { ApplicationState } from '../use-application.js';
import type { DemoState } from '../use-demo.js';

export interface StartPageProps {
  app: ApplicationState;
  demo: DemoState;
  /** 宿主运行状态那一路：读失败只收起这一块，不牵连上面两块。 */
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
  onRequestStopAll: () => void;
  stopping: boolean;
  notify: (message: string, tone: 'ok' | 'danger') => void;
  goToView: (view: AppView) => void;
}

/**
 * 开始页：现在能不能回话、要不要接自己的 Key、桌面上是哪一只。
 *
 * 这里没有开发清单，也没有第二个聊天入口：能说的只有宿主真的报上来的状态。
 * 没有 Key 也能正常使用——回复来源默认是离线脚本演示，接 DeepSeek 是可选项。
 */
export function StartPage({
  app,
  demo,
  snapshot,
  loading,
  error,
  available,
  onRetry,
  onRequestStopAll,
  stopping,
  notify,
  goToView,
}: StartPageProps): JSX.Element {
  const [value, setValue] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const saveKey = async (): Promise<void> => {
    const key = value.trim();
    if (key === '') {
      notify('没有保存：Key 是空的。', 'danger');
      return;
    }
    setSavingKey(true);
    const outcome = await demo.saveProviderKey(key);
    setSavingKey(false);
    if (outcome.ok) {
      setValue('');
      notify('Key 已存到本机；连接结果会在实际对话里显示。', 'ok');
    } else {
      notify(`Key 没有存进去：${outcome.error ?? '未知原因'}`, 'danger');
    }
  };

  const removeKey = async (): Promise<void> => {
    setSavingKey(true);
    const outcome = await demo.removeProviderKey();
    setSavingKey(false);
    notify(
      outcome.ok ? '已移除本机的 Key。' : `移除失败：${outcome.error ?? '未知原因'}`,
      outcome.ok ? 'ok' : 'danger',
    );
  };

  const replayGuide = async (): Promise<void> => {
    const outcome = await app.startGuide();
    notify(
      outcome.ok ? '引导已经在桌宠那边开始。' : `引导没能开始：${outcome.error ?? '未知原因'}`,
      outcome.ok ? 'ok' : 'danger',
    );
  };

  const demoSnapshot = demo.snapshot;
  const mode = demoSnapshot?.settings.replyMode ?? 'demo';
  const model =
    demoSnapshot === null
      ? null
      : (demoSnapshot.models.find((item) => item.id === demoSnapshot.settings.modelId) ?? null);

  return (
    <>
      <Section
        title="它现在怎么回话"
        description="没有 Key 也能用：离线脚本演示不需要网络。接真实 DeepSeek 是可选项。"
      >
        <SettingsRows>
          <SettingsRow
            label="回复来源"
            description={demoSnapshot === null ? '还没读到设置。' : demoReplyMode(mode)}
          >
            <Button
              size="small"
              variant="quiet"
              data-testid="start-go-voice"
              onClick={() => goToView('voice')}
            >
              改
            </Button>
          </SettingsRow>

          <SettingsRow
            label="本机识别"
            description={
              demoSnapshot === null
                ? '还没读到识别设置。'
                : model === null
                  ? '还没选识别模型：文字对话不需要它。'
                  : model.cached
                    ? `${model.name} · 已在本机`
                    : `${model.name} · 还没有下载`
            }
          >
            <Button size="small" variant="quiet" onClick={() => goToView('voice')}>
              {COPY.voiceEntry}
            </Button>
          </SettingsRow>

          <SettingsRow
            label="DeepSeek Key"
            labelFor="group"
            wide
            description="Key 只保存在本机；能不能连通，要在实际对话后才知道。"
          >
            {demoSnapshot === null ? null : (
              <div className="demo-key">
                <span className="config-toolbar__state" role="status">
                  {demoSnapshot.keyConfigured
                    ? '本机已存有 Key，能不能连通还没验证。'
                    : demoSnapshot.keyAvailable
                      ? '还没有 Key。'
                      : '本机凭据存储不可用：现在存不进去。'}
                </span>
                <Field label="API Key" description="粘贴 DeepSeek 的 Key，保存后不再显示。">
                  {({ inputId, describedBy }) => (
                    <>
                      <input
                        id={inputId}
                        className="pk-input"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={describedBy}
                        value={value}
                        disabled={!demoSnapshot.keyAvailable || savingKey}
                        data-testid="demo-key-input"
                        onChange={(event) => setValue(event.target.value)}
                      />
                      {/* 两个按钮同一行；容器窄时各自折行，不把输入框挤窄。 */}
                      <div className="demo-key__actions">
                        <Button
                          variant="primary"
                          size="small"
                          disabled={!demoSnapshot.keyAvailable || savingKey || value.trim() === ''}
                          data-testid="demo-key-save"
                          onClick={() => void saveKey()}
                        >
                          {savingKey ? '正在保存…' : '存到本机'}
                        </Button>
                        <Button
                          size="small"
                          disabled={!demoSnapshot.keyConfigured || savingKey}
                          data-testid="demo-key-remove"
                          onClick={() => void removeKey()}
                        >
                          移除本机 Key
                        </Button>
                      </div>
                    </>
                  )}
                </Field>
              </div>
            )}
          </SettingsRow>
        </SettingsRows>
      </Section>

      <div className="pk-split">
        <div className="pk-split__main">
          <Section
            title="桌面上就是这一只"
            description="在装扮页改形态、配色和大小，保存后桌面就是这个样子。"
          >
            {app.available ? (
              <SettingsRows>
                <SettingsRow
                  label="上手引导"
                  description="引导在桌宠的气泡里一步一步走，这里只是重放一次。"
                >
                  <Button
                    size="small"
                    variant="quiet"
                    disabled={app.saving}
                    data-testid="start-guide"
                    onClick={() => void replayGuide()}
                  >
                    重新播放
                  </Button>
                </SettingsRow>
                <SettingsRow
                  label="想换个样子"
                  description="形态、配色、大小与是否显示都在装扮页。"
                >
                  <Button size="small" variant="quiet" onClick={() => goToView('appearance')}>
                    去装扮
                  </Button>
                </SettingsRow>
              </SettingsRows>
            ) : (
              <p className="console-muted">{COPY.appUnavailable}</p>
            )}
          </Section>
        </div>
        <div className="pk-split__aside">
          <PetPreview values={app.values} agent={app.snapshot?.agent ?? null} />
        </div>
      </div>

      <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
        {snapshot === null ? null : (
          <HostSection
            snapshot={snapshot}
            loading={loading}
            onRetry={onRetry}
            onRequestStopAll={onRequestStopAll}
            stopping={stopping}
          />
        )}
      </ConsoleStatus>
    </>
  );
}

interface HostSectionProps {
  snapshot: ConsoleSnapshot;
  loading: boolean;
  onRetry: () => void;
  onRequestStopAll: () => void;
  stopping: boolean;
}

/** 运行状态只报确切的计数；有空闲、有任务、有未就绪插件是三件不同的事。 */
function HostSection({
  snapshot,
  loading,
  onRetry,
  onRequestStopAll,
  stopping,
}: HostSectionProps): JSX.Element {
  const { host } = snapshot;
  const runtime = hostRuntime(host.runtime);
  const busy = host.runningTasks > 0 || host.pendingWork > 0;
  const taskRef = useRef<HTMLDivElement>(null);
  const hadStopRef = useRef(busy);

  /*
   * 任务可能在确认框打开期间自然结束，停止入口随之卸载，焦点会掉到 body。
   * 只在"入口刚消失且焦点确实无人接管"时，把它就近交给任务行。
   */
  useEffect(() => {
    const vanished = hadStopRef.current && !busy;
    hadStopRef.current = busy;
    if (vanished && document.activeElement === document.body) {
      taskRef.current?.focus();
    }
  }, [busy]);

  return (
    <Section
      title="运行状态"
      actions={
        <button
          type="button"
          className="console-action"
          data-testid="console-refresh"
          onClick={onRetry}
          disabled={loading}
        >
          {loading ? COPY.refreshing : COPY.refresh}
        </button>
      }
    >
      <div className="console-status">
        <p className="console-lead">
          <StatusBadge tone={runtime.tone}>{runtime.text}</StatusBadge>
          <span>{hostSummary(host.runtime, host.installedPlugins, host.activePlugins)}</span>
        </p>
        <div className="console-task" ref={taskRef} tabIndex={-1}>
          <p className="console-task__text">{taskSummary(host.runningTasks, host.pendingWork)}</p>
          {busy ? (
            <button
              type="button"
              className="console-action"
              data-testid="console-stop-all"
              aria-disabled={stopping}
              aria-busy={stopping}
              onClick={() => {
                if (!stopping) {
                  onRequestStopAll();
                }
              }}
            >
              {stopping ? '正在停止…' : '停止全部任务'}
            </button>
          ) : null}
        </div>
        {host.unreadyPlugins > 0 || host.pendingRestartPlugins > 0 ? (
          <p className="console-muted">
            {host.unreadyPlugins} 个扩展未就绪，{host.pendingRestartPlugins} 个需要重启后生效。
          </p>
        ) : null}
      </div>
    </Section>
  );
}
