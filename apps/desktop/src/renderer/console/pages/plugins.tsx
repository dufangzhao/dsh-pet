import type { ConsolePlugin, ConsolePluginAction, ConsoleSnapshot } from '@pet/contracts';
import { errorMessage } from '@pet/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { ConsoleStatus } from '../console-status.js';
import { COPY } from '../copy.js';
import {
  describePermission,
  hostRuntime,
  ownerKey,
  pluginOrigin,
  pluginState,
  taskSummary,
} from '../labels.js';
import { Button, Status, type StatusTone } from '../minimal-ui/controls.js';
import { actionLabel } from '../use-plugin-actions.js';

export interface PluginsPageProps {
  snapshot: ConsoleSnapshot | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  onRetry: () => void;
  onOpenConfig: ((plugin: ConsolePlugin) => void) | undefined;
  onOpenPermissions: () => void;
  pending: ReadonlyMap<string, ConsolePluginAction>;
  onAction: (plugin: ConsolePlugin, action: ConsolePluginAction) => void;
  onRequestStopAll: () => void;
  stopping: boolean;
}

type PluginFilter = 'all' | 'active' | 'disabled' | 'builtin';
const FILTERS: readonly { id: PluginFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '已启用' },
  { id: 'disabled', label: '已停用' },
  { id: 'builtin', label: '内置' },
];

function toneOf(tone: ReturnType<typeof hostRuntime>['tone']): StatusTone {
  return tone === 'neutral' ? 'muted' : tone;
}

/** Search and filters project the current owner snapshots; actions retain their full owner. */
export function PluginsPage(props: PluginsPageProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PluginFilter>('all');
  const plugins = props.snapshot?.plugins ?? [];
  const search = query.trim().toLocaleLowerCase();
  const visible = plugins.filter(
    (plugin) =>
      (filter === 'all' ||
        (filter === 'builtin' ? plugin.origin === 'builtin' : plugin.state === filter)) &&
      (plugin.name + ' ' + plugin.owner.pluginId).toLocaleLowerCase().includes(search),
  );
  return (
    <ConsoleStatus
      loading={props.loading}
      error={props.error}
      available={props.available}
      onRetry={props.onRetry}
    >
      {props.snapshot === null ? null : (
        <>
          <RunSection
            snapshot={props.snapshot}
            loading={props.loading}
            stopping={props.stopping}
            onRequestStopAll={props.onRequestStopAll}
            onRetry={props.onRetry}
            onOpenPermissions={props.onOpenPermissions}
          />
          <div className="plugin-tools">
            <label className="plugin-search">
              <svg
                className="plugin-search__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="6" />
                <path d="m15 15 5 5" />
              </svg>
              <input
                type="search"
                className="plugin-search__input"
                value={query}
                aria-label="搜索插件"
                placeholder="搜索插件"
                data-testid="plugin-search"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="plugin-filters" role="group" aria-label="筛选插件">
              {FILTERS.map((item) => (
                <Button
                  key={item.id}
                  className="plugin-filter"
                  aria-pressed={filter === item.id}
                  data-testid={'plugin-filter-' + item.id}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <p className="row__value" role="status" aria-live="polite">
            {visible.length} / {plugins.length} 个插件
          </p>
          {visible.length === 0 ? (
            <div className="plugin-empty">
              <p>{plugins.length === 0 ? '尚未安装插件。' : '没有符合搜索条件的插件。'}</p>
              {plugins.length > 0 ? (
                <Button
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  清除筛选
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="plugins-grid">
              {visible.map((plugin) => (
                <PluginCard
                  key={ownerKey(plugin.owner)}
                  plugin={plugin}
                  pending={props.pending.get(ownerKey(plugin.owner))}
                  onOpenConfig={props.onOpenConfig}
                  onOpenPermissions={props.onOpenPermissions}
                  onAction={props.onAction}
                />
              ))}
            </div>
          )}
        </>
      )}
    </ConsoleStatus>
  );
}

interface PluginCardProps {
  plugin: ConsolePlugin;
  pending: ConsolePluginAction | undefined;
  onOpenConfig: ((plugin: ConsolePlugin) => void) | undefined;
  onOpenPermissions: () => void;
  onAction: (plugin: ConsolePlugin, action: ConsolePluginAction) => void;
}

function PluginCard({
  plugin,
  pending,
  onOpenConfig,
  onOpenPermissions,
  onAction,
}: PluginCardProps): JSX.Element {
  const state = pluginState(plugin.state);
  const repair = repairHint(plugin);
  const actions = actionsFor(plugin);
  const busy = pending !== undefined;
  return (
    <article
      className="card plugin-card"
      data-owner-key={ownerKey(plugin.owner)}
      data-plugin-id={plugin.owner.pluginId}
      data-plugin-state={plugin.state}
      data-plugin-builtin={plugin.origin === 'builtin'}
    >
      <div className="card__body">
        <div className="plugin-card__top">
          <span className="plugin-icon" aria-hidden="true">
            {plugin.name.slice(0, 1)}
          </span>
          <div className="plugin-card__id">
            <h2 className="card__title">{plugin.name}</h2>
            <p className="plugin-card__desc">
              {plugin.protected
                ? '应用基础功能'
                : plugin.origin === 'builtin'
                  ? '随应用提供，可单独启用或停用'
                  : '你安装的插件'}
            </p>
          </div>
        </div>
        <div className="plugin-card__meta">
          <span className="plugin-tag">{pluginOrigin(plugin.origin)}</span>
          <span>版本 {plugin.version}</span>
          <Status tone={toneOf(state.tone)}>{state.text}</Status>
          {plugin.protected ? <span className="plugin-tag">受保护</span> : null}
        </div>
        {plugin.reason ? (
          <p className="plugin-card__note" role="alert">
            {errorMessage(plugin.reason)}
          </p>
        ) : null}
        {repair ? <p className="plugin-card__note">{repair.text}</p> : null}
        <PluginPermissions permissions={plugin.permissions} />
        <div className="card__foot">
          {actions.map((action) => (
            <Button
              key={action}
              variant={action === 'uninstall' && plugin.origin === 'user' ? 'danger' : 'secondary'}
              disabled={busy}
              data-testid={'plugin-' + action + '-' + plugin.owner.pluginId}
              onClick={() => onAction(plugin, action)}
            >
              {pending === action ? pendingLabel(action) : actionLabel(action)}
            </Button>
          ))}
          {onOpenConfig ? (
            <Button
              variant="ghost"
              disabled={busy}
              data-testid={'plugin-config-' + plugin.owner.pluginId}
              aria-label={'配置 ' + plugin.name}
              onClick={() => onOpenConfig(plugin)}
            >
              {COPY.config}
            </Button>
          ) : null}
          {repair?.permissions ? (
            <Button variant="ghost" onClick={onOpenPermissions}>
              {COPY.goPermissions}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
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
 * 另一种情况就没有出路。待重启与正在切换的状态不给动作，理由由 repairHint 说明。
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
 * 状态说明需要审批就去权限页，待重启就直说要重启；配置入口在脚上另有一颗。
 */
function repairHint(plugin: ConsolePlugin): { text: string; permissions: boolean } | null {
  if (plugin.state === 'pending_restart') {
    return { text: '需重启应用完成清理，重启前这个插件不会再启动。', permissions: false };
  }
  if (plugin.state === 'rejected') {
    return {
      text: '这个插件与当前应用版本或平台不兼容，无法启用；需要安装兼容的版本。',
      permissions: false,
    };
  }
  if (plugin.state !== 'failed' && plugin.state !== 'unready') {
    return null;
  }

  /*
   * permission-denied 在启用阶段只有一种来源：这个插件包还没有被确认为可信。
   * 插件声明的敏感权限走的是运行中的一次性审批（M2-05），与这里的信任确认不是一回事，
   * 所以文案不能写成"已批准/未批准权限"。
   */
  if (plugin.reason?.code === 'permission-denied') {
    return {
      text: '启用被拒绝：还没有确认这个插件包可信。确认后可以重试启用。',
      permissions: true,
    };
  }
  return {
    text:
      plugin.state === 'unready'
        ? '没有就绪，可能缺少依赖或配置；可以重试启用，或停用后重新配置。'
        : '启用没有完成，可以重试。',
    permissions: false,
  };
}

/**
 * 声明权限：是请求，不是授权。
 * 这里只做展示，不改状态——审批在 M2-05，插件内容也不能触发它。
 */
function PluginPermissions({
  permissions,
}: {
  permissions: ConsolePlugin['permissions'];
}): JSX.Element {
  if (permissions.length === 0) {
    return <p className="row__desc">没有声明额外权限。</p>;
  }
  return (
    <details>
      <summary className="row__desc">
        声明的权限（{permissions.length}）· 这是请求，不是授权
      </summary>
      <ul className="row__desc">
        {permissions.map((permission, index) => (
          <li key={permission.kind + '|' + index}>{describePermission(permission)}</li>
        ))}
      </ul>
    </details>
  );
}

function RunSection({
  snapshot,
  loading,
  stopping,
  onRequestStopAll,
  onRetry,
  onOpenPermissions,
}: {
  snapshot: ConsoleSnapshot;
  loading: boolean;
  stopping: boolean;
  onRequestStopAll: () => void;
  onRetry: () => void;
  onOpenPermissions: () => void;
}): JSX.Element {
  const host = snapshot.host;
  const runtime = hostRuntime(host.runtime);
  const busy = host.runningTasks > 0 || host.pendingWork > 0;
  const toolbar = useRef<HTMLDivElement>(null);
  const hadStop = useRef(busy);
  useEffect(() => {
    const vanished = hadStop.current && !busy;
    hadStop.current = busy;
    if (vanished && document.activeElement === document.body) toolbar.current?.focus();
  }, [busy]);
  return (
    <div
      className="plugin-toolbar"
      data-runtime-state={host.runtime}
      aria-label="运行状态"
      ref={toolbar}
      tabIndex={-1}
    >
      <span className="plugin-toolbar__state" role="status">
        <Status tone={toneOf(runtime.tone)}>{runtime.text}</Status>
      </span>
      <span className="plugin-toolbar__stats">
        <span>
          已安装 <b>{host.installedPlugins}</b>
        </span>
        <span>
          已启用 <b>{host.activePlugins}</b>
        </span>
        <span>{taskSummary(host.runningTasks, host.pendingWork)}</span>
        {host.unreadyPlugins > 0 ? (
          <Status tone="warn">{host.unreadyPlugins} 个未就绪</Status>
        ) : null}
        {host.pendingRestartPlugins > 0 ? (
          <Status tone="warn">{host.pendingRestartPlugins} 个待重启</Status>
        ) : null}
      </span>
      <span className="plugin-toolbar__actions">
        <Button size="small" data-testid="console-refresh" disabled={loading} onClick={onRetry}>
          {loading ? COPY.refreshing : COPY.refresh}
        </Button>
        <Button size="small" data-testid="plugins-permissions" onClick={onOpenPermissions}>
          权限与数据
        </Button>
        {busy ? (
          <Button
            size="small"
            data-testid="console-stop-all"
            aria-disabled={stopping}
            aria-busy={stopping}
            onClick={() => {
              if (!stopping) onRequestStopAll();
            }}
          >
            {stopping ? '正在停止…' : '停止全部任务'}
          </Button>
        ) : null}
      </span>
    </div>
  );
}
