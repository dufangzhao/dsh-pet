import { useId, useState } from 'react';

import { PET_COPY } from './copy.js';

export interface PetMenuProps {
  name: string | null;
  canStop: boolean;
  stopping: boolean;
  onStop(): void;
  guideDisabled: boolean;
  guideBusy: boolean;
  onGuide(): void;
  quitDisabled: boolean;
  onQuit(): void;
  onClose?(): void;
  onResumeDialog?(): void;
  avatar?: React.ReactNode;
  paused?: boolean;
  pausePending?: boolean;
  onTogglePause?(): void;
  chatOpen?: boolean;
  chatDisabled?: boolean;
  onChat?(): void;
  voiceEnabled?: boolean;
  voicePending?: boolean;
  voiceDisabled?: boolean;
  talkKeyLabel?: string | null;
  onToggleVoice?(): void;
  appearance?: 'light' | 'dark';
  themePending?: boolean;
  onToggleTheme?(): void;
  soundEnabled?: boolean;
  soundPending?: boolean;
  onToggleSound?(): void;
  onHide?(): void;
  onAppearance?(): void;
}

type MenuIconName =
  | 'pause'
  | 'play'
  | 'settings'
  | 'power'
  | 'chat'
  | 'mic'
  | 'mic-off'
  | 'sun'
  | 'moon'
  | 'sound'
  | 'sound-off'
  | 'hide'
  | 'shirt'
  | 'close';

/** Independently drawn menu glyphs share one stroke and viewBox. */
function MenuIcon({ name }: { name: MenuIconName }): React.JSX.Element {
  const glyphs: Record<MenuIconName, React.ReactNode> = {
    pause: <path d="M9 6v12m6-12v12" />,
    play: <path d="m9 5 10 7-10 7Z" />,
    settings: (
      <>
        <path d="m10 3-1 3-3 1-2-1-2 3 2 2v3l-2 2 2 3 3-1 2 1 1 3h4l1-3 2-1 3 1 2-3-2-2v-3l2-2-2-3-2 1-3-1-1-3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    power: (
      <>
        <path d="M12 3v8m-5-6a8 8 0 1 0 10 0" />
      </>
    ),
    chat: (
      <path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3Z" />
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6" />
      </>
    ),
    'mic-off': (
      <>
        <path d="M9 8V6a3 3 0 0 1 6 0v5m-9 0v1a6 6 0 0 0 10 4m-4 2v3m-3 0h6M3 3l18 18" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M20 15.5A8.7 8.7 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z" />,
    sound: (
      <>
        <path d="M4 9h4l5-4v14l-5-4H4Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    'sound-off': (
      <>
        <path d="M4 9h4l5-4v14l-5-4H4Zm12 1 5 5m0-5-5 5" />
      </>
    ),
    hide: (
      <>
        <path d="M3 3l18 18M9 5.5A11 11 0 0 1 21 12a12 12 0 0 1-3 4m-3.5 2a11 11 0 0 1-12-6A14 14 0 0 1 6 8m4 2a3 3 0 0 0 4 4" />
      </>
    ),
    shirt: <path d="m8 3-5 3-2 5 5 2v8h12v-8l5-2-2-5-5-3a4 4 0 0 1-8 0Z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {glyphs[name]}
    </svg>
  );
}

function MenuPortrait(): React.JSX.Element {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="m9 13-2-9 10 6m14 3 2-9-10 6" fill="var(--pet-body-bottom)" />
      <ellipse cx="20" cy="22" rx="15" ry="14" fill="var(--pet-body-bottom)" />
      <ellipse cx="20" cy="23" rx="11" ry="10" fill="var(--pet-face)" />
      <g fill="var(--pet-character-ink)">
        <ellipse cx="16" cy="21" rx="1.5" ry="2" />
        <ellipse cx="24" cy="21" rx="1.5" ry="2" />
      </g>
      <path
        d="M17 28q3 3 6 0"
        fill="none"
        stroke="var(--pet-character-ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** All toggle state is projected by the parent; this menu never saves its own preferences. */
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
  onClose,
  onResumeDialog,
  avatar,
  paused,
  pausePending = false,
  onTogglePause,
  chatOpen,
  chatDisabled = false,
  onChat,
  voiceEnabled,
  voicePending = false,
  voiceDisabled = false,
  talkKeyLabel,
  onToggleVoice,
  appearance,
  themePending = false,
  onToggleTheme,
  soundEnabled,
  soundPending = false,
  onToggleSound,
  onHide,
  onAppearance,
}: PetMenuProps): React.JSX.Element {
  const launcher = typeof window === 'undefined' ? undefined : window.petSettings;
  const [opening, setOpening] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();

  async function openSettings(): Promise<void> {
    if (!launcher || opening) return;
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

  const pauseUnavailable = !onTogglePause || paused === undefined;
  const voiceUnavailable = !onToggleVoice || voiceEnabled === undefined || voiceDisabled;
  const themeUnavailable = !onToggleTheme || appearance === undefined;
  const soundUnavailable = !onToggleSound || soundEnabled === undefined;
  const voiceLabel = voiceEnabled ? '关闭语音输入' : '开启语音输入';
  const themeLabel = appearance === 'dark' ? '切换为浅色' : '切换为深色';
  const soundLabel = soundEnabled ? '关闭音效' : '开启音效';

  return (
    <section
      className="pet-menu"
      data-testid="pet-menu"
      aria-label={PET_COPY.menuLabel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onClose) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="pet-menu__header">
        <button
          type="button"
          className="pet-menu__avatar"
          data-testid="pet-menu-more"
          aria-label="更多桌宠操作"
          title="更多操作"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span aria-hidden="true" inert>
            {avatar ?? <MenuPortrait />}
          </span>
          <span className="pet-menu__more-mark" aria-hidden="true">
            ⌄
          </span>
        </button>
        {name !== null && name !== '' ? (
          <p className="pet-menu__name" data-testid="pet-name" title={name}>
            {name}
          </p>
        ) : (
          <span className="pet-menu__name" />
        )}
        <div className="pet-menu__header-actions">
          <button
            type="button"
            className="pet-menu__header-button pet-menu__pause"
            data-testid="pet-menu-pause"
            aria-label={paused ? '继续运行' : '暂停运行'}
            aria-pressed={paused}
            aria-busy={pausePending}
            disabled={pauseUnavailable || pausePending}
            data-active={paused === false}
            title={pauseUnavailable ? '暂停与继续暂不可用' : paused ? '继续运行' : '暂停运行'}
            onClick={onTogglePause}
          >
            <MenuIcon name={paused ? 'play' : 'pause'} />
          </button>
          <button
            type="button"
            className="pet-menu__header-button"
            data-testid="pet-settings"
            aria-label={opening ? PET_COPY.settingsOpening : PET_COPY.settings}
            onClick={() => void openSettings()}
            disabled={!launcher || opening}
            aria-busy={opening}
            title={launcher ? PET_COPY.settingsTitle : PET_COPY.settingsUnavailable}
          >
            <MenuIcon name="settings" />
          </button>
          <button
            type="button"
            className="pet-menu__header-button pet-menu__quit"
            data-testid="pet-quit"
            aria-label={PET_COPY.quit}
            onClick={onQuit}
            disabled={quitDisabled}
            title={PET_COPY.quitHint}
          >
            <MenuIcon name="power" />
          </button>
        </div>
      </header>
      <div className="pet-menu__grid" role="group" aria-label="桌宠快捷操作">
        <button
          type="button"
          className="pet-menu__tile"
          data-testid="pet-menu-chat"
          aria-label="打开聊天"
          aria-pressed={chatOpen}
          disabled={!onChat || chatDisabled}
          title={!onChat || chatDisabled ? '聊天暂不可用' : '打开聊天'}
          onClick={onChat}
        >
          <MenuIcon name="chat" />
        </button>
        <button
          type="button"
          className="pet-menu__tile"
          data-testid="pet-menu-voice"
          aria-label={voiceLabel}
          aria-pressed={voiceEnabled}
          aria-busy={voicePending}
          disabled={voiceUnavailable || voicePending}
          data-off={voiceEnabled === false}
          title={
            voiceUnavailable
              ? '语音输入暂不可用'
              : `${voiceLabel}${talkKeyLabel ? `（${talkKeyLabel}）` : ''}`
          }
          onClick={onToggleVoice}
        >
          <MenuIcon name={voiceEnabled === false ? 'mic-off' : 'mic'} />
          {voiceEnabled && talkKeyLabel ? (
            <span className="pet-menu__key" aria-hidden="true" title={talkKeyLabel}>
              {talkKeyLabel}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="pet-menu__tile"
          data-testid="pet-menu-theme"
          aria-label={themeLabel}
          aria-pressed={appearance === undefined ? undefined : appearance === 'dark'}
          aria-busy={themePending}
          disabled={themeUnavailable || themePending}
          title={themeUnavailable ? '主题切换暂不可用' : themeLabel}
          onClick={onToggleTheme}
        >
          <MenuIcon name={appearance === 'light' ? 'sun' : 'moon'} />
        </button>
        <button
          type="button"
          className="pet-menu__tile"
          data-testid="pet-menu-sound"
          aria-label={soundLabel}
          aria-pressed={soundEnabled}
          aria-busy={soundPending}
          disabled={soundUnavailable || soundPending}
          data-off={soundEnabled === false}
          title={soundUnavailable ? '音效暂不可用' : soundLabel}
          onClick={onToggleSound}
        >
          <MenuIcon name={soundEnabled === false ? 'sound-off' : 'sound'} />
        </button>
        <button
          type="button"
          className="pet-menu__tile"
          data-testid="pet-menu-hide"
          aria-label="隐藏桌宠"
          disabled={!onHide}
          title={onHide ? '隐藏桌宠' : '隐藏桌宠暂不可用'}
          onClick={onHide}
        >
          <MenuIcon name="hide" />
        </button>
        <button
          type="button"
          className="pet-menu__tile"
          data-testid="pet-menu-appearance"
          aria-label="更换装扮"
          disabled={!onAppearance}
          title={onAppearance ? '更换装扮' : '装扮入口暂不可用'}
          onClick={onAppearance}
        >
          <MenuIcon name="shirt" />
        </button>
      </div>
      <div className="pet-menu__more" id={moreId} hidden={!moreOpen}>
        {onResumeDialog ? (
          <button
            type="button"
            className="pet-menu__button"
            data-testid="pet-resume-dialog"
            onClick={onResumeDialog}
          >
            继续提示
          </button>
        ) : null}
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
          className="pet-menu__button"
          data-testid="pet-guide"
          onClick={onGuide}
          disabled={guideDisabled || guideBusy}
          title={guideDisabled ? PET_COPY.guideUnavailable : PET_COPY.guideTitle}
        >
          {guideBusy ? PET_COPY.guideBusy : PET_COPY.guide}
        </button>
        {onClose ? (
          <button
            type="button"
            className="pet-menu__button"
            data-testid="pet-menu-close"
            onClick={onClose}
          >
            收起菜单
          </button>
        ) : null}
      </div>
      {settingsError !== null ? (
        <p className="pet-menu__error" role="alert" data-testid="pet-settings-error">
          {settingsError}
        </p>
      ) : null}
    </section>
  );
}
