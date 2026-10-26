import type { ConsoleSnapshot } from '@pet/contracts';
import type { JSX } from 'react';

import { List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';
import { ConsoleStatus } from '../console-status.js';
import { hostSummary, hostRuntime, ownerKey, pluginState, taskSummary } from '../labels.js';

export interface StartPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
}

/** 开始页：一句状态、宿主运行情况、插件与任务摘要。 */
export function StartPage({
  snapshot,
  loading,
  error,
  available,
  onRetry,
}: StartPageProps): JSX.Element {
  return (
    <ConsolePane title="开始" summary="当前宿主的运行情况。以下内容来自本机宿主，只读。">
      <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
        {snapshot === null ? null : <StartContent snapshot={snapshot} />}
      </ConsoleStatus>
    </ConsolePane>
  );
}

function StartContent({ snapshot }: { snapshot: ConsoleSnapshot }): JSX.Element {
  const { host } = snapshot;
  const runtime = hostRuntime(host.runtime);
  const hasPlugins = snapshot.plugins.length > 0;

  return (
    <>
      <Section title="状态">
        <p className="console-lead">
          <StatusBadge tone={runtime.tone}>{runtime.text}</StatusBadge>
          <span>{hostSummary(host.runtime, host.installedPlugins, host.activePlugins)}</span>
        </p>
        <p className="console-muted">{taskSummary(host.runningTasks, host.pendingWork)}</p>
      </Section>

      <Section title="插件">
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
