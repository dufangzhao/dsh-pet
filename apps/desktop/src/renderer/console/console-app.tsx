import type {
  ConsolePlugin,
  ConsolePluginAction,
  ConsoleSecurityChange,
  HostStatus,
} from '@pet/contracts';
import { useCallback, useRef, useState, type CSSProperties, type JSX } from 'react';

import { Button, Dialog, Toast, useToastStore } from '@pet/ui-kit';

import { ApprovalNotice } from './console-approvals.js';
import { ConsoleNav } from './console-nav.js';
import { COPY } from './copy.js';
import { DemoRecorder } from './pages/demo-console.js';
import { AboutPage } from './pages/about.js';
import { ModelsPage } from './pages/models.js';
import { DEFAULT_PAGE, type PageId } from './pages.js';
import { PermissionsPage } from './pages/permissions.js';
import { PetPage } from './pages/pet.js';
import { PluginConfigPanel } from './pages/plugin-config.js';
import { PluginsPage } from './pages/plugins.js';
import { StartPage } from './pages/start.js';
import { VoicePage } from './pages/voice.js';
import { ownerKey } from './labels.js';
import { actionLabel, usePluginActions } from './use-plugin-actions.js';
import { useDemo } from './use-demo.js';
import { useSecurity } from './use-security.js';
import { useConsoleSnapshot } from './use-snapshot.js';
import { useStopAll } from './use-stop-all.js';
import { useTheme } from './use-theme.js';
import { THEMES, themeAriaLabel, themeLabel, type Theme } from './theme.js';

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
 *
 * 卸载的后果按来源分开说：内置功能只是从当前与后续启动中移除，代码还在，
 * 能从权限页恢复；用户插件卸载会删掉代码包，不能撤销。同一句话套两种后果就是骗人。
 */
const CONFIRM: Readonly<
  Record<
    'disable' | 'uninstall',
    {
      title: (name: string) => string;
      body: (plugin: ConsolePlugin) => string;
      confirm: string;
    }
  >
> = {
  disable: {
    title: (name) => `停用 ${name}？`,
    body: () => '正在运行的任务会被取消，插件注册的入口会立即消失。配置、凭据和数据都保留在本机。',
    confirm: '确认停用',
  },
  uninstall: {
    title: (name) => `卸载 ${name}？`,
    body: (plugin) =>
      plugin.origin === 'builtin'
        ? `这是应用自带的功能。卸载结果会保存下来：它从当前和后续启动中移除，重启后也不会自己回来；应用代码仍在，之后可以在「权限与数据」里恢复。${KEPT_AFTER_UNINSTALL}`
        : `这会删除插件的代码包，不能撤销。${KEPT_AFTER_UNINSTALL}`,
    confirm: '确认卸载',
  },
};

const CANCEL = '取消';

/** 设置台外壳：导航、主题、真实快照与停止命令的唯一持有者。 */
export function ConsoleApp(): JSX.Element {
  // 页面只用 React 状态：宿主按完整 URL 校验请求来源，改 hash 会让后续请求被拒。
  const [page, setPage] = useState<PageId>(DEFAULT_PAGE);
  const [confirming, setConfirming] = useState(false);
  /** 正在编辑配置的插件；null 表示停在插件列表。 */
  const [configuring, setConfiguring] = useState<ConsolePlugin | null>(null);
  /** 表单里还有没保存的改动时，切页或返回列表前先问一次。 */
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
  /** 等待确认的插件动作；null 表示没有确认框。 */
  const [confirmAction, setConfirmAction] = useState<{
    plugin: ConsolePlugin;
    action: 'disable' | 'uninstall';
  } | null>(null);
  const dirtyRef = useRef(false);
  const toasts = useToastStore();
  const { theme, setTheme } = useTheme();
  const snapshotState = useConsoleSnapshot();
  const securityState = useSecurity();
  const stopAll = useStopAll();
  const pluginActions = usePluginActions({
    applySnapshot: snapshotState.applySnapshot,
    markUncertain: snapshotState.markUncertain,
  });
  const mainRef = useRef<HTMLElement>(null);

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

  const notify = useCallback(
    (message: string, tone: 'ok' | 'danger') => {
      toasts.push(message, tone);
    },
    [toasts],
  );

  const demoState = useDemo({ notify });

  /** 准备向导走同一条插件动作通道；启用不需要确认框。 */
  const enablePlugin = useCallback(
    (plugin: ConsolePlugin) => pluginActions.run(plugin, 'enable'),
    [pluginActions.run],
  );

  /**
   * 有未保存改动时先挂起目标动作，确认后才执行。
   * 目标动作存成函数而不是"待确认的页面"，这样返回列表和切页共用一套确认。
   */
  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) {
      setDiscarding(() => action);
      return;
    }
    action();
  }, []);

  const select = useCallback(
    (next: PageId) => {
      guard(() => {
        setConfiguring(null);
        setPage(next);
      });
    },
    [guard],
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

  const skipToContent = useCallback(() => {
    mainRef.current?.focus();
  }, []);

  /**
   * 执行一次插件动作，结果只报事实：达成说做了，没达成说为什么。
   * 快照由 hook 直接应用，这里不再补读。
   */
  const runPluginAction = useCallback(
    async (plugin: ConsolePlugin, action: ConsolePluginAction) => {
      const outcome = await pluginActions.run(plugin, action);
      if (outcome.ok) {
        toasts.push(`已${actionLabel(action)} ${plugin.name}。`, 'ok');
        return;
      }
      /*
       * 失败一律 danger（role=alert）：措辞只说事实、不声称已回滚，
       * 但颜色与播报不因此降级。
       * 未确认时页面已经由 markUncertain 收起旧数据，只有手动重新读取才恢复；
       * 这里不自动重试。
       */
      toasts.push(`${actionLabel(action)} ${plugin.name}：${outcome.error}`, 'danger');
    },
    [pluginActions, toasts],
  );

  /**
   * 行上的按钮先到这里。停用与卸载要确认，启用直接做；
   * 但无论哪条路径都要穿过 guard，未保存的配置不能因为一次插件操作被丢掉。
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

  const afterStopAll = useCallback(
    (status: HostStatus | null, error: string | null) => {
      if (status !== null) {
        toasts.push(STOP_ALL.accepted(status.pendingWork), 'ok');
        // stopAll 不改插件，宿主返回的 HostStatus 就是最新宿主状态，直接合并；
        // 不再补一次 getSnapshot：多一次往返，且它失败会掩盖这次成功。
        snapshotState.applyHostStatus(status);
      } else {
        toasts.push(error ?? '停止失败。', 'danger');
      }
    },
    [snapshotState, toasts],
  );

  const confirmStopAll = useCallback(async () => {
    setConfirming(false);
    const outcome = await stopAll.stop();
    afterStopAll(outcome.status, outcome.error);
  }, [afterStopAll, stopAll]);

  return (
    <div className="console-shell">
      {/* 跳转目标是页面内的 main，用按钮而不是锚点：改 URL 会破坏宿主来源校验。 */}
      <button type="button" className="console-skip" onClick={skipToContent}>
        {COPY.contentSkip}
      </button>

      <aside className="console-sidebar" aria-label="设置台">
        <p className="console-sidebar__brand">{COPY.appName}</p>
        <ConsoleNav current={page} onSelect={select} />
        <div className="console-sidebar__footer">
          <ThemePicker theme={theme} onChange={setTheme} />
        </div>
      </aside>

      {/* 没有全局工具条：每个操作都在使用它的那块数据旁边（见各页）。 */}
      <main className="console-main" id="console-main" ref={mainRef} tabIndex={-1}>
        {/* 待审批提示停在所有页面上；它只负责导航，答复永远在权限页逐项做。 */}
        {page === 'permissions' ? null : (
          <ApprovalNotice
            count={securityState.security?.pending.length ?? 0}
            onOpen={() => select('permissions')}
          />
        )}
        {/* 录音会话是全场的：在别的页审批也看得见，也能结束或取消。 */}
        {demoState.recording === null || page === 'start' || page === 'voice' ? null : (
          <div className="console-recording">
            <DemoRecorder demo={demoState} />
          </div>
        )}
        {renderPage()}
      </main>

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
        正在运行的任务会被取消，应用与插件继续运行。已经完成的工作不会回滚。
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
    </div>
  );

  function renderPage(): JSX.Element {
    const shared = {
      snapshot: snapshotState.snapshot,
      loading: snapshotState.loading,
      error: snapshotState.error,
      available: snapshotState.available,
      onRetry: snapshotState.refresh,
    };

    switch (page) {
      case 'start':
        return (
          <StartPage
            {...shared}
            demo={demoState}
            security={securityState.security}
            onRefreshSecurity={securityState.refresh}
            onApplyChange={applySecurityChange}
            onUncertain={markUncertainAll}
            notify={notify}
            onEnable={enablePlugin}
            onGoTo={select}
            stopping={stopAll.busy}
            onRequestStopAll={() => {
              // 请求进行中重复点击不重复开框。
              if (!stopAll.busy) {
                setConfirming(true);
              }
            }}
          />
        );
      case 'pet':
        return <PetPage />;
      case 'voice':
        return <VoicePage demo={demoState} notify={notify} onGoToModels={() => select('models')} />;
      case 'models':
        return <ModelsPage demo={demoState} notify={notify} onGoToVoice={() => select('voice')} />;
      case 'plugins':
        return configuring === null ? (
          <PluginsPage
            {...shared}
            onOpenConfig={(plugin) => openConfig(plugin)}
            onOpenPermissions={() => select('permissions')}
            pending={pluginActions.pending}
            onAction={requestPluginAction}
          />
        ) : (
          <PluginConfigPanel
            key={ownerKey(configuring.owner)}
            owner={configuring.owner}
            pluginName={configuring.name}
            onBack={closeConfig}
            onDirtyChange={(dirty) => {
              dirtyRef.current = dirty;
            }}
          />
        );
      case 'permissions':
        /*
         * 安全快照单独一路：读失败只收起这一页，不牵连插件页。
         * 写操作的结果未确认时才把两份一起收起。
         */
        return (
          <PermissionsPage
            security={securityState.security}
            loading={shared.loading || securityState.loading}
            error={shared.error ?? securityState.error}
            available={shared.available}
            onRetry={() => {
              snapshotState.refresh();
              securityState.refresh();
            }}
            onApplyChange={applySecurityChange}
            onUncertain={markUncertainAll}
            notify={notify}
          />
        );
      case 'about':
        return <AboutPage {...shared} />;
    }
  }
}

/**
 * 主题三态用原生 radio 组分段控件：三个选项互斥且都可见，
 * 比下拉少一次点击就能看清全部状态。滑块由 CSS 按选中项翻译定位。
 * 原生 radio 保留 Tab 进入、方向键切换、屏幕阅读器播报与可见焦点。
 */
function ThemePicker({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (next: Theme) => void;
}): JSX.Element {
  const activeIndex = THEMES.indexOf(theme);

  return (
    <div className="console-theme">
      <span className="console-theme__label" id="console-theme-label">
        {COPY.themeLabel}
      </span>
      <div
        className="console-segmented"
        role="radiogroup"
        aria-labelledby="console-theme-label"
        data-testid="theme-select"
        style={{ '--segment-index': activeIndex } as CSSProperties}
      >
        {/* 滑块只是视觉指示，选中状态由原生 radio 自己表达。 */}
        <span className="console-segmented__thumb" aria-hidden="true" />
        {THEMES.map((candidate) => (
          <label key={candidate} className="console-segmented__option">
            <input
              type="radio"
              name="console-theme"
              value={candidate}
              aria-label={themeAriaLabel(candidate)}
              checked={candidate === theme}
              onChange={() => onChange(candidate)}
            />
            <span className="console-segmented__text" aria-hidden="true">
              {themeLabel(candidate)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
