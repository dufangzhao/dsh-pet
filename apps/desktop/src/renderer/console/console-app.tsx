import type { ConsolePlugin, HostStatus } from '@pet/contracts';
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

/** 设置台外壳：导航、主题、真实快照与停止命令的唯一持有者。 */
export function ConsoleApp(): JSX.Element {
  // 页面只用 React 状态：宿主按完整 URL 校验请求来源，改 hash 会让后续请求被拒。
  const [page, setPage] = useState<PageId>(DEFAULT_PAGE);
  const [confirming, setConfirming] = useState(false);
  /** 正在编辑配置的插件；null 表示停在插件列表。 */
  const [configuring, setConfiguring] = useState<ConsolePlugin | null>(null);
  /** 表单里还有没保存的改动时，切页或返回列表前先问一次。 */
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
  const dirtyRef = useRef(false);
  const toasts = useToastStore();
  const { theme, setTheme } = useTheme();
  const snapshotState = useConsoleSnapshot();
  const stopAll = useStopAll();
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
          <PluginsPage {...shared} onOpenConfig={(plugin) => openConfig(plugin)} />
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
