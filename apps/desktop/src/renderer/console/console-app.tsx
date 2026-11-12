/**
 * 设置台外壳：四页日常 + 三个恢复入口，一份服务连接与一份本机呈现。
 *
 * 共享组合里不再有本地 Core、模型目录、录音会话或引导：那几条数据源在这里根本不挂，
 * 不是藏起来。导航仍是 React 状态——宿主按完整 URL 校验请求来源，改 hash 会让请求被拒。
 * 切页只清掉一次性回执，不碰任何页面自己的草稿。
 */
import type { ConsolePlugin, ConsolePluginAction, ConsoleSecurityChange } from '@pet/contracts';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Dialog, Toast, useToastStore } from '@pet/ui-kit';

import { Button } from './original-ui/kit.js';
import { Button as MinimalButton } from './minimal-ui/controls.js';

import { RECOVERY_ITEMS } from './app-views.js';
import {
  CONSOLE_VIEWS,
  CONSOLE_VIEW_SUMMARY,
  consoleNavItems,
  isConsoleView,
  type ConsoleView,
} from '../shared/console-views.js';
import { ActivityIcon } from './icons.js';
import { ApprovalNotice } from './console-approvals.js';
import { COPY } from './copy.js';
import { AboutPage } from './pages/about.js';
import { AppearancePage } from './pages/appearance.js';
import { ConversationPage } from './pages/conversation.js';
import { PermissionsPage } from './pages/permissions.js';
import { PersonaPage } from './pages/persona.js';
import { PluginConfigPanel } from './pages/plugin-config.js';
import { PluginsPage } from './pages/plugins.js';
import { StartPage } from './pages/start.js';
import { MinimalShell as SettingsShell } from './minimal-ui/shell.js';
import { connectionView } from '../shared/companion-state.js';
import { useCompanion } from '../shared/use-companion.js';
import { useConsoleVoice } from './use-console-voice.js';
import { useLocalPresentation } from '../shared/use-local-presentation.js';
import { useConsoleSnapshot } from './use-snapshot.js';
import { actionLabel, usePluginActions } from './use-plugin-actions.js';
import { useSecurity } from './use-security.js';
import { usePresentationTheme } from './use-presentation-theme.js';

const CANCEL = '取消';

/** 卸载之后共同的两件事：本机数据还在，信任却不会跟着回来。 */
const KEPT_AFTER_UNINSTALL =
  '配置、凭据和数据保留在本机；信任不随卸载保留，恢复或重装后仍要重新确认。';

/** 需要确认的动作：启用可逆，停用与卸载会改动安装结果，都要问一次。 */
const CONFIRM: Readonly<
  Record<
    'disable' | 'uninstall',
    {
      title: (name: string) => string;
      body: (builtin: boolean) => string;
      confirm: string;
    }
  >
> = {
  disable: {
    title: (name) => `停用 ${name}？`,
    body: () => '它注册的入口会立即消失，正在进行的本地工作会结束。配置、凭据和数据都保留在本机。',
    confirm: '确认停用',
  },
  uninstall: {
    title: (name) => `卸载 ${name}？`,
    body: (builtin) =>
      builtin
        ? `这是应用自带的功能。卸载结果会保存下来：它从当前和后续启动中移除，重启后也不会自己回来；应用代码仍在，之后可以在插件权限中恢复。${KEPT_AFTER_UNINSTALL}`
        : `这会删除它的代码包，不能撤销。${KEPT_AFTER_UNINSTALL}`,
    confirm: '确认卸载',
  },
};

/** 恢复入口的标题与说明。这一页可以出现技术词，日常页不出现。 */
const RECOVERY_TITLES: Readonly<Record<string, string>> = {
  plugins: '插件',
  permissions: '插件权限与来源',
  about: '关于',
};

const RECOVERY_SUMMARY: Readonly<Record<string, string>> = {
  plugins: '安装、来源信任与需要重启的改动都在这里；日常设置不用进这一页。',
  permissions: '信任确认、请求审批与本机数据的去向。',
  about: '版本与许可。',
};

const RECOVERY_VIEWS = ['plugins', 'permissions', 'about'] as const;
type RecoveryView = (typeof RECOVERY_VIEWS)[number];
type Selection = ConsoleView | RecoveryView;

export function ConsoleApp(): JSX.Element {
  const [view, setView] = useState<Selection>('start');
  const [configuring, setConfiguring] = useState<ConsolePlugin | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    plugin: ConsolePlugin;
    action: 'disable' | 'uninstall';
  } | null>(null);
  const dirtyRef = useRef(false);
  const toasts = useToastStore();
  const companion = useCompanion();
  // 语音 owner 挂在外壳上：换页不打断录音，页面只拿视图。
  const voice = useConsoleVoice(companion);
  const presentation = useLocalPresentation();
  const snapshotState = useConsoleSnapshot();
  const securityState = useSecurity();
  const pluginActions = usePluginActions({
    applySnapshot: snapshotState.applySnapshot,
    markUncertain: snapshotState.markUncertain,
  });
  const presentationError = usePresentationTheme();

  const notify = useCallback(
    (message: string, tone: 'ok' | 'danger') => {
      toasts.push(message, tone);
    },
    [toasts],
  );

  const select = useCallback(
    (next: string) => {
      // 换页只清掉一次性回执；各页的草稿留在它们自己那里。
      companion.clearNotice();
      setConfiguring(null);
      setView(isSelection(next) ? next : 'start');
    },
    [companion],
  );

  useEffect(
    () =>
      window.petSettings?.onNavigate((request) => {
        if (request.view === 'plugins') setView('plugins');
        else if (request.view === 'about') setView('about');
        else if (isSelection(request.view)) setView(request.view);
      }),
    [],
  );

  const runPluginAction = useCallback(
    async (plugin: ConsolePlugin, action: ConsolePluginAction) => {
      const outcome = await pluginActions.run(plugin, action);
      if (outcome.ok) {
        toasts.push(`已${actionLabel(action)} ${plugin.name}。`, 'ok');
        return;
      }
      toasts.push(`${actionLabel(action)} ${plugin.name}：${outcome.error}`, 'danger');
    },
    [pluginActions, toasts],
  );

  const requestPluginAction = useCallback(
    (plugin: ConsolePlugin, action: ConsolePluginAction) => {
      if (action === 'enable') {
        void runPluginAction(plugin, action);
        return;
      }
      setConfirmAction({ plugin, action });
    },
    [runPluginAction],
  );

  const confirmPluginAction = useCallback(async () => {
    const request = confirmAction;
    setConfirmAction(null);
    if (request !== null) await runPluginAction(request.plugin, request.action);
  }, [confirmAction, runPluginAction]);

  const shared = {
    snapshot: snapshotState.snapshot,
    loading: snapshotState.loading,
    error: snapshotState.error,
    available: snapshotState.available,
    onRetry: snapshotState.refresh,
  };

  const pendingApprovals = securityState.security?.pending.length ?? 0;
  const items = [...consoleNavItems(), ...RECOVERY_ITEMS];
  const connection = companion.state === null ? null : connectionView(companion.state);
  const notice =
    pendingApprovals === 0 ? undefined : (
      <ApprovalNotice count={pendingApprovals} onOpen={() => setView('permissions')} />
    );

  return (
    <>
      <SettingsShell
        items={items}
        selected={view}
        onSelect={select}
        brand={COPY.appName}
        title={
          configuring?.name ??
          (isRecovery(view) ? (RECOVERY_TITLES[view] ?? COPY.appName) : viewTitle(view))
        }
        summary={
          (isRecovery(view) ? RECOVERY_SUMMARY[view] : (CONSOLE_VIEW_SUMMARY[view] ?? '')) ||
          undefined
        }
        notice={notice}
        footer={
          <div className="pb-run">
            <span className="pb-run__state" data-state={connection?.tone ?? 'offline'}>
              {connection === null ? '连接状态未读取' : connection.label}
            </span>
            {companion.state?.snapshot == null ? null : (
              // 完整名字留在 title 与可访问文本里；排版只负责省略。
              <span
                className="row__value pb-run__name"
                title={companion.state.snapshot.agent.name}
                data-testid="connection-name"
              >
                {companion.state.snapshot.agent.name}
              </span>
            )}
            <MinimalButton
              size="small"
              className="pb-run__button"
              data-testid="connection-refresh"
              aria-label="刷新连接状态"
              title="刷新连接状态"
              busy={companion.loading}
              onClick={companion.refresh}
            >
              {/* 折叠轨里只显示这一枚图标；宽窗口显示完整文字，图标不出现。 */}
              <ActivityIcon className="pb-run__icon" />
              <span className="pb-run__label">刷新连接</span>
            </MinimalButton>
          </div>
        }
      >
        {presentationError ? (
          <p role="alert" className="minimal-error">
            {presentationError}
          </p>
        ) : null}
        {renderBody()}
      </SettingsShell>

      <Dialog
        open={confirmAction !== null}
        title={
          confirmAction === null
            ? ''
            : CONFIRM[confirmAction.action].title(confirmAction.plugin.name)
        }
        onClose={() => setConfirmAction(null)}
        footer={
          <>
            <Button data-autofocus onClick={() => setConfirmAction(null)}>
              {CANCEL}
            </Button>
            <Button
              variant="danger"
              data-testid="plugin-action-confirm"
              onClick={() => void confirmPluginAction()}
            >
              {confirmAction === null ? '' : CONFIRM[confirmAction.action].confirm}
            </Button>
          </>
        }
      >
        {confirmAction === null
          ? null
          : CONFIRM[confirmAction.action].body(confirmAction.plugin.origin === 'builtin')}
      </Dialog>

      <Toast items={toasts.items} onDismiss={toasts.dismiss} />
    </>
  );

  function renderBody(): JSX.Element {
    if (configuring !== null) {
      return (
        <PluginConfigPanel
          key={ownerKeyOf(configuring)}
          owner={configuring.owner}
          backLabel={COPY.backToRecovery}
          onBack={() => setConfiguring(null)}
          onDirtyChange={(dirty) => {
            dirtyRef.current = dirty;
          }}
        />
      );
    }
    switch (view) {
      case 'start':
        return (
          <StartPage
            companion={companion}
            presentation={presentation}
            voice={voice.controller}
            notify={notify}
          />
        );
      case 'conversation':
        return (
          <ConversationPage
            companion={companion}
            notify={notify}
            voice={voice.controller}
            onGoToStart={() => select('start')}
          />
        );
      case 'persona':
        return (
          <PersonaPage
            companion={companion}
            presentation={presentation}
            notify={notify}
            onOpenPlugins={() => select('plugins')}
          />
        );
      case 'appearance':
        return <AppearancePage presentation={presentation} notify={notify} />;
      case 'permissions':
        return (
          <PermissionsPage
            security={securityState.security}
            loading={shared.loading || securityState.loading}
            error={shared.error ?? securityState.error}
            available={shared.available}
            onRetry={() => {
              shared.onRetry();
              securityState.refresh();
            }}
            onApplyChange={(change: ConsoleSecurityChange) =>
              securityState.applySecurity(change.security)
            }
            onUncertain={() => securityState.markUncertain()}
            notify={notify}
          />
        );
      case 'about':
        return <AboutPage {...shared} />;
      default:
        return (
          <PluginsPage
            {...shared}
            onOpenConfig={setConfiguring}
            onOpenPermissions={() => setView('permissions')}
            pending={pluginActions.pending}
            onAction={requestPluginAction}
          />
        );
    }
  }
}

function isRecovery(value: string): value is RecoveryView {
  return (RECOVERY_VIEWS as readonly string[]).includes(value);
}

function isSelection(value: string): value is Selection {
  return isConsoleView(value) || isRecovery(value);
}

function viewTitle(view: Selection): string {
  return CONSOLE_VIEWS.find((item) => item.id === view)?.label ?? COPY.appName;
}

function ownerKeyOf(plugin: ConsolePlugin): string {
  return plugin.owner.pluginId + '/' + plugin.owner.instanceId;
}
