import type { ConsolePlugin, ConsolePluginAction, ConsoleSnapshot } from '@pet/contracts';
import { errorMessage } from '@pet/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { ConsoleStatus } from '../console-status.js';
import { COPY } from '../copy.js';
import { hostRuntime, ownerKey, pluginState, taskSummary } from '../labels.js';
import { Button, Status, type StatusTone } from '../minimal-ui/controls.js';

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
}

/**
 * 一个功能模块：用户看到的插件按「它替用户做哪件事」分组，而不是按包名平铺。
 *
 * `internal` 里的包是同一条能力链的内部组成件（采样、按键、语音队列）：它们确实
 * 可以被停用，但不该和用户主动选择的插件同权出现，所以默认折在组内。
 */
interface PluginModule {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  /** 用户可操作的插件（完整 pluginId）。 */
  readonly plugins: readonly string[];
  /** 内部组成件；没列在这里的模块就是没有。 */
  readonly internal?: readonly string[];
}

const MODULES: readonly PluginModule[] = [
  {
    id: 'agent',
    title: '对话与智能体',
    note: '把你说的话交给助手，并把回复与任务带回来。',
    plugins: [
      'pet.agent-cortico',
      'pet.harness-cortico',
      'pet.chat',
      'pet.llm-provider',
      'pet.text-client',
      'pet.companion-client',
    ],
  },
  {
    id: 'gateway',
    title: '模型网关',
    note: '模型与 QQ 参与都经同一个 Magpie 网关出入。',
    plugins: ['pet.model-connection-magpie', 'pet.qq-participation-magpie'],
  },
  {
    id: 'asr',
    title: '语音输入 ASR',
    note: '把麦克风里的声音转成文字。',
    plugins: ['pet.asr-magpie', 'pet.asr-cloud', 'pet.asr-local'],
    internal: ['pet.shared-voice', 'pet.voice-chat', 'pet.audio-capture', 'pet.talk-key'],
  },
  {
    id: 'tts',
    title: '语音输出 TTS',
    note: '把回复念出来。',
    plugins: ['pet.tts-magpie', 'pet.speech-output', 'pet.system-tts', 'pet.builtin-speech'],
    internal: ['pet.shared-speech'],
  },
  {
    id: 'qq',
    title: 'QQ 接入',
    note: '服务端与这台机器各自连 QQ 的那一层。',
    plugins: [
      'pet.qq-official',
      'pet.qq-onebot',
      'pet.shared-qq',
      'pet.qq-media-codec',
      'pet.local-host-bridge',
      'pet.local-agent-link',
    ],
  },
  {
    id: 'runtime',
    title: '状态与执行',
    note: '记录本机状态，并跑需要独立进程的任务。',
    plugins: ['pet.state-sqlite', 'pet.cloud-exec'],
  },
  {
    id: 'desktop',
    title: '桌面呈现',
    note: '桌宠本体的样子，以及设置台里那几页。',
    plugins: [
      'pet.profile',
      'pet.avatar-default',
      'pet.page-start',
      'pet.page-conversation',
      'pet.page-persona',
      'pet.page-appearance',
      'pet.page-voice',
    ],
  },
];

const OTHER = 'other';

function toneOf(tone: ReturnType<typeof hostRuntime>['tone']): StatusTone {
  return tone === 'neutral' ? 'muted' : tone;
}

/** Search projects the current owner snapshots; actions retain their full owner. */
export function PluginsPage(props: PluginsPageProps): JSX.Element {
  const [query, setQuery] = useState('');
  const plugins = props.snapshot?.plugins ?? [];
  const search = query.trim().toLocaleLowerCase();
  const matches = (plugin: ConsolePlugin): boolean =>
    (plugin.name + ' ' + plugin.owner.pluginId).toLocaleLowerCase().includes(search);
  const visible = search === '' ? plugins : plugins.filter(matches);
  const known = new Set(
    MODULES.flatMap((module) => [...module.plugins, ...(module.internal ?? [])]),
  );
  const others = visible.filter((plugin) => !known.has(plugin.owner.pluginId));
  const sections = MODULES.map((module) => ({
    module,
    own: visible.filter((plugin) => module.plugins.includes(plugin.owner.pluginId)),
    internal: visible.filter((plugin) => module.internal?.includes(plugin.owner.pluginId) === true),
  })).filter((section) => section.own.length + section.internal.length > 0);

  const row = (plugin: ConsolePlugin): JSX.Element => (
    <PluginRow
      key={ownerKey(plugin.owner)}
      plugin={plugin}
      pending={props.pending.get(ownerKey(plugin.owner))}
      onOpenConfig={props.onOpenConfig}
      onOpenPermissions={props.onOpenPermissions}
      onAction={props.onAction}
    />
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
            <p className="plugin-tools__count" role="status" aria-live="polite">
              {visible.length} / {plugins.length} 个插件
            </p>
          </div>
          {visible.length === 0 ? (
            <div className="plugin-empty">
              <p>{plugins.length === 0 ? '尚未安装插件。' : '没有符合搜索条件的插件。'}</p>
              {plugins.length > 0 ? <Button onClick={() => setQuery('')}>清除搜索</Button> : null}
            </div>
          ) : (
            <div className="plugin-modules">
              {sections.map(({ module, own, internal }) => (
                <section
                  className="plugin-module"
                  key={module.id}
                  data-testid={'plugin-module-' + module.id}
                >
                  <h2 className="plugin-module__title">{module.title}</h2>
                  <p className="plugin-module__note">{module.note}</p>
                  {own.length === 0 ? null : <div className="plugin-rows">{own.map(row)}</div>}
                  {internal.length === 0 ? null : (
                    <details
                      className="plugin-fold"
                      data-testid={'plugin-internal-' + module.id}
                      open={search !== ''}
                    >
                      <summary className="plugin-fold__summary">
                        内部组成件（{internal.length}）
                      </summary>
                      <div className="plugin-rows">{internal.map(row)}</div>
                    </details>
                  )}
                </section>
              ))}
              {others.length === 0 ? null : (
                <section className="plugin-module" data-testid={'plugin-module-' + OTHER}>
                  <h2 className="plugin-module__title">其他</h2>
                  <p className="plugin-module__note">还没有归入上面任何模块的插件。</p>
                  <div className="plugin-rows">{others.map(row)}</div>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </ConsoleStatus>
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
 * 一行一个插件：名称、状态、开关，必要时一颗卸载图标。
 *
 * 开关读宿主的 desiredActive（想不想让它跑），不读 state（此刻跑没跑起来）：
 * 未就绪或失败的插件仍然可能是想启用的，那时必须还能停用。
 * 名称按钮的伪元素铺满整行，动作控件压在它上面，于是既没有嵌套的可交互角色，
 * 点开关或垃圾桶也不会顺带跳页。动作进行中名称按钮也停下：先等宿主的真实结果。
 */
function PluginRow({
  plugin,
  pending,
  onOpenConfig,
  onOpenPermissions,
  onAction,
}: PluginRowProps): JSX.Element {
  const state = pluginState(plugin.state);
  const repair = repairHint(plugin);
  const actions = actionsFor(plugin);
  const busy = pending !== undefined;
  const toggle = plugin.desiredActive ? 'disable' : 'enable';
  const open = onOpenConfig;
  /*
   * 受保护的包停不掉，开关只能停在「想启用」。未就绪或失败时，
   * actionsFor 里本来就允许的 enable 得有一颗自己的按钮，否则没有出路。
   */
  const retry =
    plugin.protected &&
    plugin.desiredActive &&
    (plugin.state === 'unready' || plugin.state === 'failed') &&
    actions.includes('enable');
  return (
    <article
      className="plugin-card plugin-row"
      data-owner-key={ownerKey(plugin.owner)}
      data-plugin-id={plugin.owner.pluginId}
      data-plugin-state={plugin.state}
      data-plugin-builtin={plugin.origin === 'builtin'}
      data-openable={open !== undefined}
    >
      <div className="plugin-row__line">
        <h3 className="plugin-row__name">
          {open === undefined ? (
            plugin.name
          ) : (
            <button
              type="button"
              className="plugin-card__open"
              data-testid={'plugin-open-' + plugin.owner.pluginId}
              disabled={busy}
              onClick={() => open(plugin)}
            >
              {plugin.name}
            </button>
          )}
        </h3>
        {plugin.protected ? <span className="plugin-row__tag">受保护</span> : null}
        <span className="plugin-row__state">
          <Status tone={toneOf(state.tone)}>{state.text}</Status>
        </span>
        <label className="plugin-toggle" title="启用">
          <span className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={'启用 ' + plugin.name}
              data-testid={'plugin-toggle-' + plugin.owner.pluginId}
              checked={plugin.desiredActive}
              disabled={busy || !actions.includes(toggle)}
              onChange={() => onAction(plugin, toggle)}
            />
            <i aria-hidden="true" />
          </span>
        </label>
        {actions.includes('uninstall') ? (
          <button
            type="button"
            className="icon-btn plugin-row__remove"
            aria-label={'卸载 ' + plugin.name}
            data-testid={'plugin-uninstall-' + plugin.owner.pluginId}
            disabled={busy}
            onClick={() => onAction(plugin, 'uninstall')}
          >
            <RemoveIcon />
          </button>
        ) : null}
      </div>
      {plugin.reason ? (
        <p className="plugin-row__note" role="alert">
          {errorMessage(plugin.reason)}
        </p>
      ) : null}
      {repair ? (
        <div className="plugin-row__repair">
          <p className="plugin-row__note">{repair.text}</p>
          {retry || repair.permissions ? (
            <div className="plugin-row__repair-actions">
              {retry ? (
                <Button
                  size="small"
                  data-testid={'plugin-retry-' + plugin.owner.pluginId}
                  aria-label={'重试启用 ' + plugin.name}
                  disabled={busy}
                  onClick={() => onAction(plugin, 'enable')}
                >
                  重试
                </Button>
              ) : null}
              {repair.permissions ? (
                <Button size="small" variant="ghost" onClick={onOpenPermissions}>
                  {COPY.goPermissions}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {pending === undefined ? null : (
        <p className="plugin-row__note" role="status">
          {pendingLabel(pending)}
        </p>
      )}
    </article>
  );
}

/** 卸载是破坏性动作，只留图标，名字由按钮的 aria-label 承担。 */
function RemoveIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9.5 7V5.6c0-.9.7-1.6 1.6-1.6h1.8c.9 0 1.6.7 1.6 1.6V7" />
      <path d="m6.6 7 .8 11.2c.1 1 .9 1.8 2 1.8h5.2c1.1 0 1.9-.8 2-1.8L17.4 7" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </svg>
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
 * 状态说明需要审批就去权限页，待重启就直说要重启。
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
      text: '启用被拒绝：还没有确认这个插件包可信。确认后' + retryHint(plugin),
      permissions: true,
    };
  }
  return {
    text:
      plugin.state === 'unready'
        ? '没有就绪，可能缺少依赖或配置；' + retryHint(plugin)
        : '启用没有完成；' + retryHint(plugin),
    permissions: false,
  };
}

/**
 * 一行只有一件开关，所以「重试启用」得说成开关上的动作；
 * 受保护的包停不掉，只能说重试，不能让人先去停用。
 */
function retryHint(plugin: ConsolePlugin): string {
  if (plugin.protected && plugin.desiredActive) {
    return '可以重试启用。';
  }
  return plugin.desiredActive ? '先停用，再重新启用。' : '重新启用。';
}

function RunSection({
  snapshot,
  loading,
  onRetry,
  onOpenPermissions,
}: {
  snapshot: ConsoleSnapshot;
  loading: boolean;
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
      </span>
    </div>
  );
}
