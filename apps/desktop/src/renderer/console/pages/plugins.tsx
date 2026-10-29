import type { ConsolePlugin, ConsolePluginAction, ConsoleSnapshot } from '@pet/contracts';
import { errorMessage } from '@pet/contracts';
import { useEffect, useRef, type JSX } from 'react';

import { Button, List, ListItem, Section, StatusBadge } from '@pet/ui-kit';

import { ConsoleStatus } from '../console-status.js';
import { COPY } from '../copy.js';
import {
  contributionKind,
  describePermission,
  hostRuntime,
  hostSummary,
  ownerKey,
  pluginOrigin,
  pluginState,
  taskSummary,
} from '../labels.js';
import { SettingsSection } from '../settings-shell.js';
import { actionLabel } from '../use-plugin-actions.js';

export interface PluginsPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
  /** 打开某个插件的配置面板；不传就不渲染入口。 */
  onOpenConfig: ((plugin: ConsolePlugin) => void) | undefined;
  /** 前往权限与数据页；由外壳提供，页内不自己改路由。 */
  onOpenPermissions: () => void;
  /** 正在进行的动作，键是 ownerKey。 */
  pending: ReadonlyMap<string, ConsolePluginAction>;
  /** 发起启用/停用/卸载；确认由外壳统一处理。 */
  onAction: (plugin: ConsolePlugin, action: ConsolePluginAction) => void;
  /** 运行状态这一块要发起「停止全部任务」；确认框仍然在外壳里。 */
  onRequestStopAll: () => void;
  stopping: boolean;
}

/** 插件页：真实插件列表、声明权限、状态与修复入口。 */
export function PluginsPage({
  snapshot,
  loading,
  error,
  available,
  onRetry,
  onOpenConfig,
  onOpenPermissions,
  pending,
  onAction,
  onRequestStopAll,
  stopping,
}: PluginsPageProps): JSX.Element {
  return (
    <>
      <ConsoleStatus loading={loading} error={error} available={available} onRetry={onRetry}>
        {snapshot === null ? null : (
          <PluginContent
            snapshot={snapshot}
            loading={loading}
            onRetry={onRetry}
            onOpenConfig={onOpenConfig}
            onOpenPermissions={onOpenPermissions}
            pending={pending}
            onAction={onAction}
            onRequestStopAll={onRequestStopAll}
            stopping={stopping}
          />
        )}
      </ConsoleStatus>
    </>
  );
}

interface PluginContentProps {
  snapshot: ConsoleSnapshot;
  loading: boolean;
  onRetry: () => void;
  onOpenConfig: ((plugin: ConsolePlugin) => void) | undefined;
  onOpenPermissions: () => void;
  pending: ReadonlyMap<string, ConsolePluginAction>;
  onAction: (plugin: ConsolePlugin, action: ConsolePluginAction) => void;
  onRequestStopAll: () => void;
  stopping: boolean;
}

function PluginContent({
  snapshot,
  loading,
  onRetry,
  onOpenConfig,
  onOpenPermissions,
  pending,
  onAction,
  onRequestStopAll,
  stopping,
}: PluginContentProps): JSX.Element {
  // 贡献条目只带 owner，按 owner 找显示名；找不到时退回技术 id。
  const names = new Map(snapshot.plugins.map((plugin) => [ownerKey(plugin.owner), plugin.name]));

  return (
    <>
      <RunSection host={snapshot.host} stopping={stopping} onRequestStopAll={onRequestStopAll} />

      <Section
        title="已安装"
        description="插件代码按本机程序对待。启用只是让它开始运行，不会替你批准任何权限。"
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
        {snapshot.plugins.length === 0 ? (
          <p className="console-muted">尚未安装插件。</p>
        ) : (
          <ul className="plugin-list" aria-label="已安装插件">
            {snapshot.plugins.map((plugin) => (
              <PluginRow
                key={ownerKey(plugin.owner)}
                plugin={plugin}
                pending={pending.get(ownerKey(plugin.owner))}
                onOpenConfig={onOpenConfig}
                onOpenPermissions={onOpenPermissions}
                onAction={onAction}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="贡献目录">
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

interface PluginRowProps {
  plugin: ConsolePlugin;
  pending: ConsolePluginAction | undefined;
  onOpenConfig: ((plugin: ConsolePlugin) => void) | undefined;
  onOpenPermissions: () => void;
  onAction: (plugin: ConsolePlugin, action: ConsolePluginAction) => void;
}

/**
 * 一个插件：状态、来源、版本、声明权限、错误与修复入口。
 *
 * 可做的动作由状态决定（见 actionsFor）。宿主会拒绝的动作不渲染，
 * 先在这里说清楚，比点了再报错好。
 */
function PluginRow({
  plugin,
  pending,
  onOpenConfig,
  onOpenPermissions,
  onAction,
}: PluginRowProps): JSX.Element {
  const state = pluginState(plugin.state);
  const busy = pending !== undefined;
  const hasConfig = onOpenConfig !== undefined;

  return (
    <li className="plugin-row" data-owner-key={ownerKey(plugin.owner)}>
      <div className="plugin-row__head">
        <span className="plugin-row__name">{plugin.name}</span>
        <StatusBadge tone={state.tone}>{state.text}</StatusBadge>
        <span className="plugin-row__meta">
          {pluginOrigin(plugin.origin)} · 版本 {plugin.version}
          {plugin.protected ? ' · 受保护' : ''}
        </span>
      </div>

      {plugin.reason === undefined ? null : (
        <p className="plugin-row__error" role="alert">
          {errorMessage(plugin.reason)}
        </p>
      )}

      <PluginRepair
        plugin={plugin}
        busy={busy}
        onOpenConfig={onOpenConfig}
        onOpenPermissions={onOpenPermissions}
      />

      <PluginPermissions plugin={plugin} />

      <div className="plugin-row__actions">
        {actionsFor(plugin).map((action) => (
          <Button
            key={action}
            size="small"
            /* 内置功能的卸载可以恢复，不用危险色把两件事说成同一件。 */
            variant={action === 'uninstall' && plugin.origin === 'user' ? 'danger' : 'secondary'}
            disabled={busy}
            data-testid={`plugin-${action}-${plugin.owner.pluginId}`}
            onClick={() => onAction(plugin, action)}
          >
            {pending === action ? pendingLabel(action) : actionLabel(action)}
          </Button>
        ))}
        {hasConfig ? (
          <Button
            size="small"
            variant="quiet"
            data-testid={`plugin-config-${plugin.owner.pluginId}`}
            aria-label={`配置 ${plugin.name}`}
            onClick={() => onOpenConfig(plugin)}
          >
            {COPY.config}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * 这个状态下能做的动作；顺序就是界面顺序。
 *
 * 只有一条限制：受保护的包既不能停用也不能卸载，宿主也分别拒绝。
 * 其余内置功能可以卸载——按 ADR-0010 那是“从当前与后续启动中移除”，
 * 应用代码还在，之后能从权限页恢复；用户插件卸载才会删代码包。
 *
 * 未就绪与失败都同时给启用和停用：未就绪可能只是依赖缺失（运行区还在，
 * 只能靠停用释放），也可能压根没激活起来（要再启用一次）。只给其中一个，
 * 另一种情况就没有出路。待重启与正在切换的状态不给动作，理由由 PluginRepair 说明。
 */
function actionsFor(plugin: ConsolePlugin): ConsolePluginAction[] {
  const stop: ConsolePluginAction[] = plugin.protected ? [] : ['disable'];
  const remove: ConsolePluginAction[] = plugin.protected ? [] : ['uninstall'];
  switch (plugin.state) {
    case 'disabled':
      return ['enable', ...remove];
    case 'unready':
    case 'failed':
      return ['enable', ...stop, ...remove];
    case 'active':
      return [...stop, ...remove];
    case 'rejected':
      return remove;
    case 'pending_restart':
    case 'activating':
    case 'deactivating':
      return [];
  }
}

function pendingLabel(action: ConsolePluginAction): string {
  switch (action) {
    case 'enable':
      return COPY.enabling;
    case 'disable':
      return COPY.disabling;
    case 'uninstall':
      return COPY.uninstalling;
  }
}

/**
 * 失败后的下一步。只给真实存在的那几个：
 * 有配置就读配置，状态说明需要审批就去权限页，待重启就直说要重启。
 */
function PluginRepair({
  plugin,
  busy,
  onOpenConfig,
  onOpenPermissions,
}: {
  plugin: ConsolePlugin;
  busy: boolean;
  onOpenConfig: ((plugin: ConsolePlugin) => void) | undefined;
  onOpenPermissions: () => void;
}): JSX.Element | null {
  if (plugin.state === 'pending_restart') {
    return <p className="plugin-row__hint">需重启应用完成清理，重启前这个插件不会再启动。</p>;
  }
  if (plugin.state === 'rejected') {
    return (
      <p className="plugin-row__hint">
        这个插件与当前应用版本或平台不兼容，无法启用；需要安装兼容的版本。
      </p>
    );
  }
  if (plugin.state !== 'failed' && plugin.state !== 'unready') {
    return null;
  }

  /*
   * permission-denied 在启用阶段只有一种来源：这个插件包还没有被确认为可信。
   * 插件声明的敏感权限走的是运行中的一次性审批（M2-05），与这里的信任确认不是一回事，
   * 所以文案不能写成"已批准/未批准权限"。
   */
  const untrusted = plugin.reason?.code === 'permission-denied';
  return (
    <p className="plugin-row__hint">
      {untrusted
        ? '启用被拒绝：还没有确认这个插件包可信。确认后可以重试启用。'
        : plugin.state === 'unready'
          ? '没有就绪，可能缺少依赖或配置；可以重试启用，或停用后重新配置。'
          : '启用没有完成，可以重试。'}
      {untrusted ? (
        <Button size="small" variant="quiet" onClick={onOpenPermissions}>
          {COPY.goPermissions}
        </Button>
      ) : null}
      {onOpenConfig === undefined ? null : (
        <Button size="small" variant="quiet" disabled={busy} onClick={() => onOpenConfig(plugin)}>
          {COPY.repairConfig}
        </Button>
      )}
    </p>
  );
}

/**
 * 声明权限：是请求，不是授权。
 * 这里只做展示，不改状态——审批在 M2-05，插件内容也不能触发它。
 */
function PluginPermissions({ plugin }: { plugin: ConsolePlugin }): JSX.Element {
  if (plugin.permissions.length === 0) {
    return <p className="plugin-row__hint">没有声明额外权限。</p>;
  }
  return (
    <details className="plugin-row__permissions">
      <summary className="plugin-row__summary">
        声明的权限（{plugin.permissions.length}）· 这是请求，不是授权
      </summary>
      <ul className="plugin-row__permission-list">
        {plugin.permissions.map((permission, index) => (
          <li key={`${permission.kind}|${index}`}>{describePermission(permission)}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * 运行状态：这一页管的就是本机在跑的东西，所以它排在插件列表上面。
 * 只报确切的计数——有空闲、有任务、有未就绪插件是三件不同的事；
 * 刷新用下面「已安装」那一个，这里不放第二个。
 */
function RunSection({
  host,
  stopping,
  onRequestStopAll,
}: {
  host: ConsoleSnapshot['host'];
  stopping: boolean;
  onRequestStopAll: () => void;
}): JSX.Element {
  const runtime = hostRuntime(host.runtime);
  const busy = host.runningTasks > 0 || host.pendingWork > 0;
  const taskRef = useRef<HTMLDivElement>(null);
  const hadStopRef = useRef(busy);

  /*
   * 任务可能在确认框打开期间自然结束，停止入口随之卸载，焦点会掉到 body。
   * 只在「入口刚消失且焦点确实无人接管」时，把它就近交给任务行。
   */
  useEffect(() => {
    const vanished = hadStopRef.current && !busy;
    hadStopRef.current = busy;
    if (vanished && document.activeElement === document.body) {
      taskRef.current?.focus();
    }
  }, [busy]);

  return (
    <SettingsSection title="运行状态">
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
    </SettingsSection>
  );
}
