import type { ConsolePlugin, ConsolePluginAction, HostStatus } from '@pet/contracts';
import { useCallback, useRef, useState, type CSSProperties, type JSX } from 'react';

import { Button, Dialog, Toast, useToastStore } from '@pet/ui-kit';

import { ConsoleNav } from './console-nav.js';
import { COPY } from './copy.js';
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
      : '已停止当前任务，宿主继续运行。',
} as const;

/**
 * 需要确认的动作。启用是可逆的日常操作，点一下就做；
 * 停用会取消任务并隐藏入口，卸载会删除代码包，两者都必须问一次。
 */
const CONFIRM: Readonly<
  Record<
    'disable' | 'uninstall',
    { title: (name: string) => string; body: string; confirm: string }
  >
> = {
  disable: {
    title: (name) => `停用 ${name}？`,
    body: '正在运行的任务会被取消，插件注册的入口会立即消失。配置、凭据和数据都保留在本机。',
    confirm: '确认停用',
  },
  uninstall: {
    title: (name) => `卸载 ${name}？`,
    body: '这会删除插件的代码包，不能撤销。配置、凭据和插件数据保留在本机。再次安装或启用时仍要重新确认信任，之前批准过的不会自动恢复。',
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
  const stopAll = useStopAll();
  const pluginActions = usePluginActions({
    applySnapshot: snapshotState.applySnapshot,
    markUncertain: snapshotState.markUncertain,
  });
  const mainRef = useRef<HTMLElement>(null);

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
        正在运行的任务会被取消，宿主和插件保持运行。已经完成的工作不会回滚。
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
        {confirmAction === null ? null : CONFIRM[confirmAction.action].body}
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
        return <VoicePage />;
      case 'models':
        return <ModelsPage />;
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
        return <PermissionsPage {...shared} />;
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
