/**
 * 桌宠窗口的菜单：设置、重播引导、停止这一次、退出。四个动作都是真链接到宿主的。
 *
 * 这里没有状态预览、模拟说明或调试入口——那些是开发期的东西，不属于桌面日常。
 * 读到的 profile 里只有名字是给用户看的：它是同一份配置的可见回执。
 */
import { useState } from 'react';

import { PET_COPY } from './copy.js';

export interface PetMenuProps {
  /** 同一份 ApplicationProfile 里的名字；还没读到就不显示，不写默认名。 */
  name: string | null;
  canStop: boolean;
  stopping: boolean;
  onStop(): void;
  guideDisabled: boolean;
  guideBusy: boolean;
  onGuide(): void;
  quitDisabled: boolean;
  onQuit(): void;
}

export function PetMenu({
  name,
  canStop,
  stopping,
  onStop,
  guideDisabled,
  guideBusy,
  onGuide,
  quitDisabled,
  onQuit,
}: PetMenuProps): React.JSX.Element {
  const launcher = typeof window === 'undefined' ? undefined : window.petSettings;
  const [opening, setOpening] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  async function openSettings(): Promise<void> {
    if (!launcher) return;
    setOpening(true);
    setSettingsError(null);
    try {
      const result = await launcher.open();
      if (!result.ok) setSettingsError(PET_COPY.settingsFailed);
    } catch {
      setSettingsError(PET_COPY.settingsFailed);
    } finally {
      setOpening(false);
    }
  }

  return (
    <section className="pet-menu" data-testid="pet-menu" aria-label={PET_COPY.menuLabel}>
      {name !== null && name !== '' ? (
        <p className="pet-menu__name" data-testid="pet-name" title={PET_COPY.nameHint}>
          {name}
        </p>
      ) : null}

      <div className="pet-menu__actions">
        <button
          type="button"
          className="pet-menu__button"
          data-testid="pet-settings"
          onClick={() => void openSettings()}
          disabled={!launcher || opening}
          title={launcher ? PET_COPY.settingsTitle : PET_COPY.settingsUnavailable}
        >
          {opening ? PET_COPY.settingsOpening : PET_COPY.settings}
        </button>
        <button
          type="button"
          className="pet-menu__button"
          data-testid="pet-guide"
          onClick={onGuide}
          disabled={guideDisabled || guideBusy}
          title={guideDisabled ? PET_COPY.guideUnavailable : PET_COPY.guideTitle}
        >
          {guideBusy ? PET_COPY.guideBusy : PET_COPY.guide}
        </button>
        {canStop ? (
          <button
            type="button"
            className="pet-menu__button"
            data-testid="pet-stop"
            onClick={onStop}
            disabled={stopping}
            title={PET_COPY.stopTitle}
          >
            {stopping ? PET_COPY.stopping : PET_COPY.stop}
          </button>
        ) : null}
        <button
          type="button"
          className="pet-menu__quit"
          data-testid="pet-quit"
          onClick={onQuit}
          disabled={quitDisabled}
          title={PET_COPY.quitHint}
        >
          {PET_COPY.quit}
        </button>
      </div>

      {settingsError !== null ? (
        <p className="pet-menu__error" role="alert" data-testid="pet-settings-error">
          {settingsError}
        </p>
      ) : null}
    </section>
  );
}
