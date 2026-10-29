import type { ConsolePlugin, ConsolePluginAction, ConsoleSecurityChange } from '@pet/contracts';
import { useCallback, useRef, useState, type JSX } from 'react';

import { Dialog, Toast, useToastStore } from '@pet/ui-kit';

import { Button } from './original-ui/kit.js';

import type { AppView } from './app-views.js';
import {
  RECOVERY_ITEMS,
  VIEW_SUMMARY,
  appViewOf,
  navItemsOf,
  resolveSelection,
} from './app-views.js';
import { ApprovalNotice } from './console-approvals.js';
import { COPY } from './copy.js';
import { ownerKey } from './labels.js';
import { AboutPage } from './pages/about.js';
import { AppearancePage } from './pages/appearance.js';
import { ConversationPage } from './pages/conversation.js';
import { DemoRecorder } from './pages/demo-console.js';
import { GenericPage } from './pages/generic-page.js';
import { PermissionsPage } from './pages/permissions.js';
import { PersonaPage } from './pages/persona.js';
import { PluginConfigPanel } from './pages/plugin-config.js';
import { PluginsPage } from './pages/plugins.js';
import { StartGuideAction, StartPage } from './pages/start.js';
import { VoicePage } from './pages/voice.js';
import { SettingsShell } from './settings-shell.js';
import { THEMES, themeAriaLabel, themeLabel, type Theme } from './theme.js';
import { useApplication } from './use-application.js';
import { useConsoleSnapshot } from './use-snapshot.js';
import { useDemo } from './use-demo.js';
import { useModelConnection } from './use-model-connection.js';
import { actionLabel, usePluginActions } from './use-plugin-actions.js';
import { useSecurity } from './use-security.js';
import { useStopAll } from './use-stop-all.js';
import { useTheme } from './use-theme.js';

const STOP_ALL = {
  title: '停止全部任务',
  confirm: '确认停止',
  cancel: '取消',
  /** 宿主确认接受后仍可能有余量在收尾，文案跟着返回的 pendingWork 走。 */
  accepted: (pendingWork: number): string =>
    pendingWork > 0
      ? `已停止当前任务，还有 ${pendingWork} 项工作正在结束。`
      : '已停止当前任务，应用继续运行。',
} as const;

/** 卸载之后共同的两件事：本机数据还在，信任却不会跟着回来——恢复或重装后仍要重新确认。 */
const KEPT_AFTER_UNINSTALL =
  '配置、凭据和数据保留在本机；信任不随卸载保留，恢复或重装后仍要重新确认。';

/**
 * 需要确认的动作。启用是可逆的日常操作，点一下就做；
 * 停用会取消任务并隐藏入口，卸载会改动安装结果，两者都必须问一次。
 */
const CONFIRM: Readonly<
  Record<
    'disable' | 'uninstall',
    { title: (name: string) => string; body: (plugin: ConsolePlugin) => string; confirm: string }
  >
> = {
  disable: {
    title: (name) => `停用 ${name}？`,
    body: () => '正在运行的任务会被取消，它注册的入口会立即消失。配置、凭据和数据都保留在本机。',
    confirm: '确认停用',
  },
  uninstall: {
    title: (name) => `卸载 ${name}？`,
    body: (plugin) =>
      plugin.origin === 'builtin'
        ? `这是应用自带的功能。卸载结果会保存下来：它从当前和后续启动中移除，重启后也不会自己回来；应用代码仍在，之后可以在「权限与数据」里恢复。${KEPT_AFTER_UNINSTALL}`
        : `这会删除它的代码包，不能撤销。${KEPT_AFTER_UNINSTALL}`,
    confirm: '确认卸载',
  },
};

const CANCEL = '取消';

/** 恢复入口的标题与说明。这一页可以出现技术词，日常页不出现。 */
const RECOVERY_TITLES: Readonly<Record<string, string>> = {
  plugins: '扩展',
  permissions: '权限与数据',
  about: '关于',
};

const RECOVERY_SUMMARY: Readonly<Record<string, string>> = {
  plugins: '安装、来源信任与需要重启的改动都在这里；日常设置不用进这一页。',
  permissions: '信任确认、请求审批与本机数据的去向。',
  about: '版本与许可。',
};

/**
 * 设置台外壳：导航、主题、三份真实快照与停止命令的唯一持有者。
 *
 * 日常入口来自宿主给的 pages：扩展被停用、报错或移除时那一页自然消失，
 * 这里不跟着改；一条都没有时落到扩展列表，不显示空页。
 * 录音会话（useDemo）与应用状态（useApplication）各只有一份，页面不自己新建。
 */
export function ConsoleApp(): JSX.Element {
  // 页面只用 React 状态：宿主按完整 URL 校验请求来源，改 hash 会让后续请求被拒。
  const [selection, setSelection] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** 正在编辑配置的扩展；null 表示停在扩展列表。 */
  const [configuring, setConfiguring] = useState<ConsolePlugin | null>(null);
  /** 表单里还有没保存的改动时，切页或返回列表前先问一次。 */
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
  /** 等待确认的扩展动作；null 表示没有确认框。 */
  const [confirmAction, setConfirmAction] = useState<{
    plugin: ConsolePlugin;
    action: 'disable' | 'uninstall';
  } | null>(null);
  const dirtyRef = useRef(false);
  const toasts = useToastStore();
  const { theme, setTheme } = useTheme();
  const app = useApplication();
  const snapshotState = useConsoleSnapshot();
  const securityState = useSecurity();
  const stopAll = useStopAll();
  const pluginActions = usePluginActions({
    applySnapshot: snapshotState.applySnapshot,
    markUncertain: snapshotState.markUncertain,
  });

  const notify = useCallback(
    (message: string, tone: 'ok' | 'danger') => {
      toasts.push(message, tone);
    },
    [toasts],
  );

  const demoState = useDemo({ notify });
  const models = useModelConnection();

  /*
   * 安全写操作返回两份真实快照：先都采用，再由调用方判断 operationError。
   * 只应用其中一份会让页面一半新一半旧。
   */
  const applySecurityChange = useCallback(
    (change: ConsoleSecurityChange) => {
      snapshotState.applySnapshot(change.snapshot);
      securityState.applySecurity(change.security);
    },
    [snapshotState, securityState],
  );

  /** 结果未确认时两份都可能过期，一起收起，等用户自己重新读取。 */
  const markUncertainAll = useCallback(() => {
    snapshotState.markUncertain();
    securityState.markUncertain();
  }, [snapshotState, securityState]);

  /**
   * 有未保存改动时先挂起目标动作，确认后才执行。
   * 目标动作存成函数而不是"待确认的页面"，返回列表和切页共用一套确认。
   */
  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) {
      setDiscarding(() => action);
      return;
    }
    action();
  }, []);

  const pages = app.snapshot?.pages ?? [];
  const items = [...navItemsOf(pages), ...RECOVERY_ITEMS];
  const current = resolveSelection(items, selection) ?? 'plugins';
  const page = pages.find((candidate) => candidate.id === current) ?? null;
  const view = page === null ? null : appViewOf(page);

  const select = useCallback(
    (next: string) => {
      guard(() => {
        setConfiguring(null);
        setSelection(next);
      });
    },
    [guard],
  );

  /** 页间跳转只按视图找宿主给的那一页；那一页被撤回就落到扩展，不在本机猜 id。 */
  const goToView = useCallback(
    (target: AppView) => {
      const found = pages.find((candidate) => appViewOf(candidate) === target);
      select(found?.id ?? 'plugins');
    },
    [pages, select],
  );

  const openConfig = useCallback(
    (plugin: ConsolePlugin) => {
      guard(() => setConfiguring(plugin));
    },
    [guard],
  );

  const closeConfig = useCallback(() => {
    guard(() => setConfiguring(null));
  }, [guard]);

  /**
   * 执行一次扩展动作，结果只报事实：达成说做了，没达成说为什么。
   * 未确认时页面已经由 markUncertain 收起旧数据，这里不补读也不自动重试。
   */
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

  /**
   * 行上的按钮先到这里。停用与卸载要确认，启用直接做；
   * 但无论哪条路径都要穿过 guard，未保存的配置不能因为一次动作被丢掉。
   */
  const requestPluginAction = useCallback(
    (plugin: ConsolePlugin, action: ConsolePluginAction) => {
      guard(() => {
        if (action === 'enable') {
          void runPluginAction(plugin, action);
          return;
        }
        setConfirmAction({ plugin, action });
      });
    },
    [guard, runPluginAction],
  );

  const confirmPluginAction = useCallback(async () => {
    const request = confirmAction;
    setConfirmAction(null);
    if (request !== null) {
      await runPluginAction(request.plugin, request.action);
    }
  }, [confirmAction, runPluginAction]);

  const confirmStopAll = useCallback(async () => {
    setConfirming(false);
    const outcome = await stopAll.stop();
    if (outcome.status !== null) {
      toasts.push(STOP_ALL.accepted(outcome.status.pendingWork), 'ok');
      // stopAll 不改扩展，宿主返回的就是最新运行状态，直接合并，不再补一次读取。
      snapshotState.applyHostStatus(outcome.status);
    } else {
      toasts.push(outcome.error ?? '停止失败。', 'danger');
    }
  }, [snapshotState, stopAll, toasts]);

  const shared = {
    snapshot: snapshotState.snapshot,
    loading: snapshotState.loading,
    error: snapshotState.error,
    available: snapshotState.available,
    onRetry: snapshotState.refresh,
  };

  const pendingApprovals = securityState.security?.pending.length ?? 0;
  /** 录音会话是全场的：停在别的页也看得见，也能结束或取消。 */
  const recordingStrip =
    demoState.recording === null || view === 'voice' || view === 'conversation' ? null : (
      <div className="pb-strip">
        <DemoRecorder demo={demoState} />
      </div>
    );
  const notice =
    pendingApprovals === 0 && recordingStrip === null ? undefined : (
      <>
        <ApprovalNotice count={pendingApprovals} onOpen={() => select('permissions')} />
        {recordingStrip}
      </>
    );

  const configPanel = (owner: ConsolePlugin['owner'], back: () => void) => (
    <PluginConfigPanel
      key={ownerKey(owner)}
      owner={owner}
      backLabel={COPY.backToRecovery}
      onBack={back}
      onDirtyChange={(dirty) => {
        dirtyRef.current = dirty;
      }}
    />
  );

  return (
    <>
      <SettingsShell
        items={items}
        selected={current}
        onSelect={select}
        brand={COPY.appName}
        actions={view === 'start' ? <StartGuideAction app={app} notify={notify} /> : undefined}
        title={configuring?.name ?? page?.title ?? RECOVERY_TITLES[current] ?? COPY.appName}
        /* 空字符串＝这一页不写整页说明：开始页的句子在「连接模型」那一节里。 */
        summary={
          (page === null ? RECOVERY_SUMMARY[current] : (VIEW_SUMMARY[view ?? 'generic'] ?? '')) ||
          undefined
        }
        notice={notice}
        footer={
          <>
            <RunToggle
              ready={app.snapshot?.agent.state === 'ready'}
              paused={models.snapshot?.paused ?? false}
              busy={models.pausing}
              onToggle={(next) => {
                void models.setPaused(next);
              }}
            />
            <ThemePicker theme={theme} onChange={setTheme} />
          </>
        }
      >
        {renderBody()}
      </SettingsShell>

      <Dialog
        open={confirming}
        title={STOP_ALL.title}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button data-autofocus onClick={() => setConfirming(false)}>
              {STOP_ALL.cancel}
            </Button>
            <Button variant="primary" onClick={() => void confirmStopAll()}>
              {STOP_ALL.confirm}
            </Button>
          </>
        }
      >
        正在运行的任务会被取消，应用与扩展继续运行。已经完成的工作不会回滚。
      </Dialog>

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
        {confirmAction === null ? null : CONFIRM[confirmAction.action].body(confirmAction.plugin)}
      </Dialog>

      <Dialog
        open={discarding !== null}
        title={COPY.discardTitle}
        onClose={() => setDiscarding(null)}
        footer={
          <>
            <Button data-autofocus onClick={() => setDiscarding(null)}>
              {COPY.discardCancel}
            </Button>
            <Button
              variant="primary"
              data-testid="discard-confirm"
              onClick={() => {
                const action = discarding;
                setDiscarding(null);
                action?.();
              }}
            >
              {COPY.discardConfirm}
            </Button>
          </>
        }
      >
        {COPY.discardBody}
      </Dialog>

      <Toast items={toasts.items} onDismiss={toasts.dismiss} />
    </>
  );

  function renderBody(): JSX.Element {
    if (page !== null) {
      switch (view) {
        case 'start':
          return (
            <StartPage
              app={app}
              demo={demoState}
              models={models}
              notify={notify}
              goToView={goToView}
              onOpenPlugins={() => select('plugins')}
            />
          );
        case 'persona':
          return <PersonaPage app={app} notify={notify} />;
        case 'appearance':
          return <AppearancePage app={app} notify={notify} />;
        case 'conversation':
          return <ConversationPage app={app} demo={demoState} notify={notify} />;
        case 'voice':
          return (
            <VoicePage
              app={app}
              demo={demoState}
              notify={notify}
              onGoToStart={() => goToView('start')}
            />
          );
        case 'generic':
          return (
            <GenericPage
              page={page}
              app={app}
              onBack={() => select('plugins')}
              onDirtyChange={(dirty) => {
                dirtyRef.current = dirty;
              }}
            />
          );
      }
    }

    switch (current) {
      case 'permissions':
        /*
         * 安全快照单独一路：读失败只收起这一页，不牵连扩展页。
         * 写操作的结果未确认时才把两份一起收起。
         */
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
            onApplyChange={applySecurityChange}
            onUncertain={markUncertainAll}
            notify={notify}
          />
        );
      case 'about':
        return <AboutPage {...shared} />;
      default:
        return configuring === null ? (
          <PluginsPage
            {...shared}
            onOpenConfig={(plugin) => openConfig(plugin)}
            onOpenPermissions={() => select('permissions')}
            pending={pluginActions.pending}
            onAction={requestPluginAction}
            stopping={stopAll.busy}
            onRequestStopAll={() => {
              // 请求进行中重复点击不重复开框。
              if (!stopAll.busy) {
                setConfirming(true);
              }
            }}
          />
        ) : (
          configPanel(configuring.owner, closeConfig)
        );
    }
  }
}

/**
 * 这一栏要说的话：桌宠在不在跑决定能不能按，paused 决定按下去是暂停还是继续。
 *
 * 可用性取代理状态（Core 的离线演示脚本也在跑，也真的可暂停），
 * 不以"接了哪家模型"为条件；桌宠没启动时按不了，也要把原因写在字面上。
 */
export function runState(ready: boolean, paused: boolean): RunState {
  if (!ready) {
    return {
      status: '桌宠未启动',
      action: '暂停回应',
      hint: '桌宠未启动，现在没有可暂停的回应',
      enabled: false,
    };
  }
  return paused
    ? { status: '已暂停', action: '继续回应', hint: '回应已暂停：点这里继续', enabled: true }
    : { status: '运行中', action: '暂停回应', hint: '正在回应：点这里暂停', enabled: true };
}

export interface RunState {
  /** 状态那一行的词。 */
  status: string;
  /** 按钮上的动作词。 */
  action: string;
  /** 悬停与读屏用的完整一句。 */
  hint: string;
  enabled: boolean;
}

/**
 * 侧栏底部的回应开关，常驻。暂停与继续说的是宿主那条运行总线，
 * paused 读模型连接快照，不在这份界面里另记一次。
 */
function RunToggle({
  ready,
  paused,
  busy,
  onToggle,
}: {
  ready: boolean;
  paused: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}): JSX.Element {
  const state = runState(ready, paused);
  return (
    <div className="pb-run">
      <span
        className="pb-run__state"
        data-state={ready ? (paused ? 'paused' : 'running') : 'offline'}
      >
        {state.status}
      </span>
      <button
        type="button"
        className="pb-run__button"
        aria-pressed={ready ? paused : undefined}
        aria-label={state.hint}
        title={state.hint}
        disabled={!state.enabled || busy}
        data-testid="model-pause"
        onClick={() => onToggle(!paused)}
      >
        {/* 折叠到 72px 时只剩这枚图标：它在按下去之前就说清了下一步是暂停还是继续。 */}
        <svg className="pb-run__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          {ready && paused ? (
            <path d="M8 5.5 18 12 8 18.5Z" fill="currentColor" stroke="none" />
          ) : (
            <path d="M9.5 5.5v13M14.5 5.5v13" strokeLinecap="round" />
          )}
        </svg>
        <span className="pb-run__label">{state.action}</span>
      </button>
    </div>
  );
}

/**
 * 主题三态用原生 radio 组成的单选板（pb-choice）：三个选项互斥且都可见，
 * 比下拉少一次点击就能看清全部状态；选中那一档自己落成强调板。
 * 原生 radio 保留 Tab 进入、方向键切换与可见焦点，没有滑块轨道，也不需要第二份状态。
 */
function ThemePicker({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (next: Theme) => void;
}): JSX.Element {
  return (
    <div className="pb-modes">
      <span className="pb-modes__label" id="console-theme-label">
        {COPY.themeLabel}
      </span>
      <span
        className="pb-choice"
        role="radiogroup"
        aria-labelledby="console-theme-label"
        data-testid="theme-select"
      >
        {THEMES.map((candidate) => (
          <label key={candidate} className="pb-choice__option">
            <input
              type="radio"
              name="console-theme"
              value={candidate}
              aria-label={themeAriaLabel(candidate)}
              checked={candidate === theme}
              onChange={() => onChange(candidate)}
            />
            {/* 可见的两字标签留给窄侧栏，完整含义在 radio 的 aria-label 上。 */}
            <span className="pb-choice__text" aria-hidden="true">
              {themeLabel(candidate)}
            </span>
          </label>
        ))}
      </span>
    </div>
  );
}
