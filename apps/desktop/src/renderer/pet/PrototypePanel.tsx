/**
 * 少量状态模拟按钮 + 退出。按钮都是真实 <button>，键盘可达、有可见焦点。
 * 这些按钮只切换 M0 的模拟状态，不会触发录音、识别或网络请求。
 */
import type { PetState } from '@pet/contracts';

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
      </div>

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
    </section>
  );
}
