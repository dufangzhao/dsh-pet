import type { ConsoleSnapshot } from '@pet/contracts';
import { errorMessage } from '@pet/contracts';
import type { JSX } from 'react';

import { List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

import { ConsolePane } from '../console-pane.js';
import { ConsoleStatus } from '../console-status.js';
import { contributionKind, ownerKey, pluginOrigin, pluginState } from '../labels.js';

export interface PluginsPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
}

/** 插件页：真实插件列表与贡献目录，全部只读。 */
export function PluginsPage({
  snapshot,
  loading,
  error,
  available,
  onRetry,
}: PluginsPageProps): JSX.Element {
  return (
    <ConsolePane title="插件" summary="宿主已加载的插件，以及它们向界面注册的条目。">
      <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
        {snapshot === null ? null : <PluginContent snapshot={snapshot} />}
      </ConsoleStatus>
    </ConsolePane>
  );
}

function PluginContent({ snapshot }: { snapshot: ConsoleSnapshot }): JSX.Element {
  // 贡献条目只带 owner，按 owner 找显示名；找不到时退回技术 id。
  const names = new Map(snapshot.plugins.map((plugin) => [ownerKey(plugin.owner), plugin.name]));

  return (
    <>
      <Section title="已安装" description="按宿主报告的加载状态列出，不在这里启停或卸载。">
        {snapshot.plugins.length === 0 ? (
          <p className="console-muted">尚未安装插件。</p>
        ) : (
          <List label="已安装插件">
            {snapshot.plugins.map((plugin) => {
              const state = pluginState(plugin.state);
              return (
                <ListItem
                  key={ownerKey(plugin.owner)}
                  title={plugin.name}
                  description={
                    <>
                      {pluginOrigin(plugin.origin)}
                      {plugin.protected ? ' · 受保护' : ''}
                      {plugin.reason === undefined ? null : ` · ${errorMessage(plugin.reason)}`}
                    </>
                  }
                  meta={plugin.version}
                  trailing={<StatusBadge tone={state.tone}>{state.text}</StatusBadge>}
                />
              );
            })}
          </List>
        )}
      </Section>

      <Section title="贡献目录" description="插件注册的命令与面板，详情由宿主解析。">
        {snapshot.contributions.length === 0 ? (
          <p className="console-muted">没有插件注册界面条目。</p>
        ) : (
          <List label="贡献目录">
            {snapshot.contributions.map((item) => (
              <ListItem
                key={`${ownerKey(item.owner)}|${item.id}`}
                title={item.title}
                description={names.get(ownerKey(item.owner)) ?? item.owner.pluginId}
                meta={contributionKind(item.kind)}
              />
            ))}
          </List>
        )}
      </Section>

      <details className="console-advanced">
        <summary className="console-advanced__summary">高级</summary>
        <div className="console-advanced__body">
          <Section title="条目标识" description="排查问题时用来区分同名插件与条目。">
            <List label="条目标识">
              {snapshot.plugins.map((plugin) => (
                <ListItem
                  key={ownerKey(plugin.owner)}
                  title={plugin.name}
                  meta={plugin.owner.generation}
                  description={plugin.owner.instanceId}
                />
              ))}
            </List>
          </Section>
        </div>
      </details>
    </>
  );
}
