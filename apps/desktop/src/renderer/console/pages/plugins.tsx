import type { ConsolePlugin, ConsolePluginAction, ConsoleSnapshot } from '@pet/contracts';
import { errorMessage } from '@pet/contracts';
import { useEffect, useRef, type JSX, type ReactNode } from 'react';

import { ConsoleStatus } from '../console-status.js';
import { COPY } from '../copy.js';
import {
  contributionKind,
  describePermission,
  hostRuntime,
  ownerKey,
  pluginOrigin,
  pluginState,
  taskSummary,
} from '../labels.js';
import { Button, Card, Status, type StatusTone } from '../minimal-ui/controls.js';
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

/** 一行「名称在左、值在右」：插件与运行状态共用这一种排法。 */
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="row">
      <span className="row__text">
        <span className="row__label">{label}</span>
      </span>
      <span className="row__value">{children}</span>
    </div>
  );
}

function toneOf(tone: ReturnType<typeof hostRuntime>['tone']): StatusTone {
  return tone === 'neutral' ? 'muted' : tone;
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
      <RunSection
        host={snapshot.host}
        plugins={snapshot.plugins}
        loading={loading}
        stopping={stopping}
        onRequestStopAll={onRequestStopAll}
        onRetry={onRetry}
      />

      {snapshot.plugins.length === 0 ? (
        <Card title="已安装">
          <p className="row__desc">尚未安装插件。</p>
        </Card>
      ) : (
        snapshot.plugins.map((plugin) => (
          <div key={ownerKey(plugin.owner)} data-owner-key={ownerKey(plugin.owner)}>
            <PluginCard
              plugin={plugin}
              pending={pending.get(ownerKey(plugin.owner))}
              onOpenConfig={onOpenConfig}
              onOpenPermissions={onOpenPermissions}
              onAction={onAction}
            />
          </div>
        ))
      )}

      <Card title="贡献目录">
        {snapshot.contributions.length === 0 ? (
          <p className="row__desc">没有插件注册界面条目。</p>
        ) : (
          <div className="rows rows--tight">
            {snapshot.contributions.map((item) => (
              <Row key={ownerKey(item.owner) + '|' + item.id} label={item.title}>
                {(names.get(ownerKey(item.owner)) ?? item.owner.pluginId) +
                  ' · ' +
                  contributionKind(item.kind)}
              </Row>
            ))}
          </div>
        )}
      </Card>

      <details className="card">
        <summary className="card__head">
          <span className="card__title">高级</span>
        </summary>
        <div className="card__body">
          <div className="rows rows--tight">
            {snapshot.plugins.map((plugin) => (
              <Row key={ownerKey(plugin.owner)} label={plugin.name}>
                {plugin.owner.instanceId + ' · 第 ' + plugin.owner.generation + ' 代'}
              </Row>
            ))}
          </div>
        </div>
      </details>
    </>
  );
}

interface PluginCardProps {
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
function PluginCard({
  plugin,
  pending,
  onOpenConfig,
  onOpenPermissions,
  onAction,
}: PluginCardProps): JSX.Element {
  const state = pluginState(plugin.state);
  const busy = pending !== undefined;
  const repair = repairHint(plugin);
  const actions = actionsFor(plugin);
  const hasConfig = onOpenConfig !== undefined;
  const hasRepair = repair !== null && repair.permissions;

  return (
    <Card title={plugin.name} action={<Status tone={toneOf(state.tone)}>{state.text}</Status>}>
      <div className="rows rows--tight">
        <Row label="来源">
          {pluginOrigin(plugin.origin) +
            ' · 版本 ' +
            plugin.version +
            (plugin.protected ? ' · 受保护' : '')}
        </Row>
        {plugin.reason === undefined ? null : (
          <Row label="原因">
            <Status tone="danger">{errorMessage(plugin.reason)}</Status>
          </Row>
        )}
      </div>

      <PluginPermissions permissions={plugin.permissions} />

      {repair === null ? null : <p className="row__desc">{repair.text}</p>}

      {actions.length === 0 && !hasConfig && !hasRepair ? null : (
        <div className="card__foot">
          {actions.map((action) => (
            <Button
              key={action}
              /* 内置功能的卸载可以恢复，不用危险色把两件事说成同一件。 */
              variant={action === 'uninstall' && plugin.origin === 'user' ? 'danger' : 'secondary'}
              disabled={busy}
              data-testid={'plugin-' + action + '-' + plugin.owner.pluginId}
              onClick={() => onAction(plugin, action)}
            >
              {pending === action ? pendingLabel(action) : actionLabel(action)}
            </Button>
          ))}
          {hasRepair ? (
            <Button variant="ghost" onClick={onOpenPermissions}>
              {COPY.goPermissions}
            </Button>
          ) : null}
          {hasConfig ? (
            <Button
              variant="ghost"
              data-testid={'plugin-config-' + plugin.owner.pluginId}
              aria-label={'配置 ' + plugin.name}
              onClick={() => onOpenConfig(plugin)}
            >
              {COPY.config}
            </Button>
          ) : null}
        </div>
      )}
    </Card>
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

/**
 * 运行状态：这一页管的就是本机在跑的东西，所以它排在插件列表上面。
 * 只报确切的计数——有空闲、有任务、有未就绪插件是三件不同的事；
 * 刷新与停止入口都收在这一节的脚上。
 */
function RunSection({
  host,
  plugins,
  loading,
  stopping,
  onRequestStopAll,
  onRetry,
}: {
  host: ConsoleSnapshot['host'];
  plugins: readonly ConsolePlugin[];
  loading: boolean;
  stopping: boolean;
  onRequestStopAll: () => void;
  onRetry: () => void;
}): JSX.Element {
  const runtime = hostRuntime(host.runtime);
  const busy = host.runningTasks > 0 || host.pendingWork > 0;
  const taskRef = useRef<HTMLDivElement>(null);
  const hadStopRef = useRef(busy);
  const disabledCount = plugins.filter((plugin) => plugin.state === 'disabled').length;
  const protectedCount = plugins.filter((plugin) => plugin.protected).length;

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
    <Card title="运行状态" action={<Status tone={toneOf(runtime.tone)}>{runtime.text}</Status>}>
      <div className="rows rows--tight">
        <Row label="已安装">{host.installedPlugins}</Row>
        <Row label="已启用">{host.activePlugins}</Row>
        <Row label="已停用">{disabledCount}</Row>
        <Row label="受保护">{protectedCount}</Row>
        <div className="row" ref={taskRef} tabIndex={-1}>
          <span className="row__text">
            <span className="row__label">任务</span>
          </span>
          <span className="row__value">{taskSummary(host.runningTasks, host.pendingWork)}</span>
        </div>
        {host.unreadyPlugins === 0 ? null : <Row label="未就绪">{host.unreadyPlugins}</Row>}
        {host.pendingRestartPlugins === 0 ? null : (
          <Row label="待重启">{host.pendingRestartPlugins}</Row>
        )}
      </div>

      <div className="card__foot">
        <Button data-testid="console-refresh" disabled={loading} onClick={onRetry}>
          {loading ? COPY.refreshing : COPY.refresh}
        </Button>
        {busy ? (
          <Button
            data-testid="console-stop-all"
            /* 不换成 disabled：等待期间这一颗还要保住焦点，重复点击由这里挡住。 */
            aria-disabled={stopping}
            aria-busy={stopping}
            onClick={() => {
              if (!stopping) {
                onRequestStopAll();
              }
            }}
          >
            {stopping ? '正在停止…' : '停止全部任务'}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
