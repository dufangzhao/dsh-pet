import type { HostStatus } from '@pet/contracts';
import { useCallback, useRef, useState, type JSX } from 'react';

import { Button, Dialog, Toast, useToastStore } from '@pet/ui-kit';

import { ConsoleNav } from './console-nav.js';
import { COPY } from './copy.js';
import { AboutPage } from './pages/about.js';
import { ModelsPage } from './pages/models.js';
import { DEFAULT_PAGE, type PageId } from './pages.js';
import { PermissionsPage } from './pages/permissions.js';
import { PetPage } from './pages/pet.js';
import { PluginsPage } from './pages/plugins.js';
import { StartPage } from './pages/start.js';
import { VoicePage } from './pages/voice.js';
import { useConsoleSnapshot } from './use-snapshot.js';
import { useStopAll } from './use-stop-all.js';
import { useTheme } from './use-theme.js';
import { THEMES, themeLabel, type Theme } from './theme.js';

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
  const toasts = useToastStore();
  const { theme, setTheme } = useTheme();
  const snapshotState = useConsoleSnapshot();
  const stopAll = useStopAll();
  const mainRef = useRef<HTMLElement>(null);

  const select = useCallback((next: PageId) => {
    setPage(next);
  }, []);

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

      <main className="console-main" id="console-main" ref={mainRef} tabIndex={-1}>
        <div className="console-toolbar">
          <div className="console-toolbar__actions">
            <Button
              size="small"
              data-testid="console-refresh"
              onClick={snapshotState.refresh}
              disabled={!snapshotState.available || snapshotState.loading}
            >
              {snapshotState.loading ? COPY.refreshing : COPY.refresh}
            </Button>
            {/*
              停止按钮在请求进行中保持可聚焦，只标记 aria-disabled：
              Dialog 关闭后会把焦点还给它，按钮一旦 disabled 就会聚焦失败并掉到 body。
              重复点击由 onClick 里的 busy 判断挡住。
            */}
            <Button
              size="small"
              variant="primary"
              data-testid="console-stop-all"
              aria-disabled={stopAll.busy}
              aria-busy={stopAll.busy}
              onClick={() => {
                if (!stopAll.busy) {
                  setConfirming(true);
                }
              }}
              disabled={!snapshotState.available || snapshotState.snapshot === null}
            >
              {stopAll.busy ? '正在停止…' : '停止全部任务'}
            </Button>
          </div>
        </div>

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
        return <StartPage {...shared} />;
      case 'pet':
        return <PetPage />;
      case 'voice':
        return <VoicePage />;
      case 'models':
        return <ModelsPage />;
      case 'plugins':
        return <PluginsPage {...shared} />;
      case 'permissions':
        return <PermissionsPage {...shared} />;
      case 'about':
        return <AboutPage {...shared} />;
    }
  }
}

/** 主题用原生 select：只有一个选择、选项互斥，比三个 toggle 更少概念。 */
function ThemePicker({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (next: Theme) => void;
}): JSX.Element {
  return (
    <div className="console-theme">
      <label className="console-theme__label" htmlFor="console-theme">
        {COPY.themeLabel}
      </label>
      <select
        id="console-theme"
        className="console-theme__select"
        data-testid="theme-select"
        value={theme}
        onChange={(event) => {
          const next = THEMES.find((candidate) => candidate === event.target.value);
          if (next !== undefined) {
            onChange(next);
          }
        }}
      >
        {THEMES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {themeLabel(candidate)}
          </option>
        ))}
      </select>
    </div>
  );
}
