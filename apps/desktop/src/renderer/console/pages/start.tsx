import type { ConsoleSnapshot } from '@pet/contracts';
import { useEffect, useRef, type JSX } from 'react';

import { List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';
import { ConsoleStatus } from '../console-status.js';
import { COPY } from '../copy.js';
import { hostSummary, hostRuntime, ownerKey, pluginState, taskSummary } from '../labels.js';

export interface StartPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
  /** 打开停止确认框；只有真的存在工作时才会渲染入口。 */
  onRequestStopAll: () => void;
  stopping: boolean;
}

/** 开始页：一句状态、任务行、插件摘要。操作只贴在这两处数据旁。 */
export function StartPage({
  snapshot,
  loading,
  error,
  available,
  onRetry,
  onRequestStopAll,
  stopping,
}: StartPageProps): JSX.Element {
  return (
    <ConsolePane title="开始">
      <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
        {snapshot === null ? null : (
          <StartContent
            snapshot={snapshot}
            loading={loading}
            onRetry={onRetry}
            onRequestStopAll={onRequestStopAll}
            stopping={stopping}
          />
        )}
      </ConsoleStatus>
    </ConsolePane>
  );
}

interface StartContentProps {
  snapshot: ConsoleSnapshot;
  loading: boolean;
  onRetry: () => void;
  onRequestStopAll: () => void;
  stopping: boolean;
}

function StartContent({
  snapshot,
  loading,
  onRetry,
  onRequestStopAll,
  stopping,
}: StartContentProps): JSX.Element {
  const { host } = snapshot;
  const runtime = hostRuntime(host.runtime);
  const busy = host.runningTasks > 0 || host.pendingWork > 0;
  const hasPlugins = snapshot.plugins.length > 0;
  const taskRef = useRef<HTMLDivElement>(null);
  const hadStopRef = useRef(busy);

  /*
   * 任务可能在确认框打开期间自然结束，停止入口随之卸载，焦点会掉到 body。
   * 只在“入口刚消失且焦点确实无人接管”时，把它就近交给任务行；
   * 如果焦点已经落在别的控件上（例如刚点过刷新），就不该抢回来。
   */
  useEffect(() => {
    const vanished = hadStopRef.current && !busy;
    hadStopRef.current = busy;
    if (vanished && document.activeElement === document.body) {
      taskRef.current?.focus();
    }
  }, [busy]);

  return (
    <>
      <div className="console-status">
        <p className="console-lead">
          <StatusBadge tone={runtime.tone}>{runtime.text}</StatusBadge>
          <span>{hostSummary(host.runtime, host.installedPlugins, host.activePlugins)}</span>
        </p>
        {/*
          停止入口只在真有工作时出现，并紧贴任务行：空闲页面不该有抢眼动作。
          请求进行中保持可聚焦（aria-disabled 而不是 disabled），
          因为确认框关闭后要把焦点还给这个按钮。
        */}
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
      </div>

      <Section
        title="插件"
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
        {/*
          只报确切的两个计数。unreadyPlugins 不含 failed，所以任何"均已加载完成"
          之类的结论都会在存在失败插件时说假话，这里一律不下结论。
        */}
        {host.unreadyPlugins > 0 || host.pendingRestartPlugins > 0 ? (
          <p className="console-muted">
            {host.unreadyPlugins} 个插件未就绪，{host.pendingRestartPlugins} 个插件需要重启后生效。
          </p>
        ) : null}
        {hasPlugins ? (
          <List label="插件状态摘要">
            {snapshot.plugins.slice(0, 3).map((plugin) => {
              const state = pluginState(plugin.state);
              return (
                <ListItem
                  key={ownerKey(plugin.owner)}
                  title={plugin.name}
                  description={`版本 ${plugin.version}`}
                  trailing={<StatusBadge tone={state.tone}>{state.text}</StatusBadge>}
                />
              );
            })}
          </List>
        ) : (
          <p className="console-muted">尚未安装任何插件。</p>
        )}
      </Section>
    </>
  );
}
