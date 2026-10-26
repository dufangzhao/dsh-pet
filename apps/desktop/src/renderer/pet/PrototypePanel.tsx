/**
 * 状态预演与桌面入口。按钮键盘可达、有可见焦点。
 * 预演只切换 M0 模拟状态；设置打开真实原生窗口。
 */
import type { PetState } from '@pet/contracts';
import { useState } from 'react';

import { PET_COPY, PET_STATE_ORDER, stateLabel } from './copy.js';

export interface PrototypePanelProps {
  state: PetState;
  onPreview: (state: PetState) => void;
  onQuit: () => void;
  quitDisabled: boolean;
}

export function PrototypePanel({
  state,
  onPreview,
  onQuit,
  quitDisabled,
}: PrototypePanelProps): React.JSX.Element {
  const launcher = typeof window === 'undefined' ? undefined : window.petSettings;
  const [opening, setOpening] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  async function openSettings(): Promise<void> {
    if (!launcher) return;
    setOpening(true);
    setSettingsError(null);
    try {
      const result = await launcher.open();
      if (!result.ok) setSettingsError('设置窗口打开失败。');
    } catch {
      setSettingsError('设置窗口打开失败。');
    } finally {
      setOpening(false);
    }
  }

  return (
    <section
      className="prototype-panel"
      data-testid="prototype-panel"
      aria-labelledby="prototype-panel-title"
    >
      {/*
        极小视口（CSS 视口 < 280px）里这一整块可以纵向滚动，退出按钮留在它外面。
        这样“空间不够时允许滚动”和“退出始终可达”同时成立，且退出不会浮在按钮
        上方挡住点击——sticky 吸底会盖住滚动内容，所以这里用滚动区 + 页脚。
      */}
      <div className="prototype-panel__body">
        <header className="prototype-panel__header">
          <h1 id="prototype-panel-title" className="prototype-panel__title">
            {PET_COPY.panelTitle}
          </h1>
          <p className="prototype-panel__notice">{PET_COPY.simulationNotice}</p>
        </header>

        <div
          className="prototype-panel__states"
          role="group"
          aria-label={PET_COPY.previewGroupLabel}
        >
          {PET_STATE_ORDER.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="prototype-panel__button"
              data-testid={`state-${candidate}`}
              data-active={candidate === state ? 'true' : 'false'}
              aria-pressed={candidate === state}
              onClick={() => onPreview(candidate)}
            >
              {stateLabel(candidate)}
            </button>
          ))}
        </div>

        <p className="prototype-panel__hint">{PET_COPY.panelHint}</p>
        {settingsError && (
          <p className="prototype-panel__notice" role="alert">
            {settingsError}
          </p>
        )}
      </div>

      <div className="prototype-panel__actions">
        <button
          type="button"
          className="prototype-panel__button"
          data-testid="pet-settings"
          onClick={() => void openSettings()}
          disabled={!launcher || opening}
          title={launcher ? '打开设置台' : '设置入口不可用'}
        >
          {opening ? '打开中…' : '设置'}
        </button>
        <button
          type="button"
          className="prototype-panel__quit"
          data-testid="pet-quit"
          onClick={onQuit}
          disabled={quitDisabled}
          title={PET_COPY.quitHint}
        >
          {PET_COPY.quitLabel}
        </button>
      </div>
    </section>
  );
}
