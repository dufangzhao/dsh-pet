import type { Ref } from 'react';

export interface PetToolsProps {
  register: Ref<HTMLDivElement>;
  hover: readonly string[];
  chatOpen: boolean;
  canChat: boolean;
  canRecord: boolean;
  recording: boolean;
  pending: boolean;
  talkKeyLabel: string | null;
  onChat(): void;
  onVoice(): void;
}

/** Original line icons in the compact 34px side stack. */
export function PetTools(props: PetToolsProps): React.JSX.Element {
  return (
    <div ref={props.register} className="pet-tools" data-testid="pet-tools" data-pet-surface>
      <div className="pet-tools__buttons">
        {props.hover.includes('chat') ? (
          <button
            type="button"
            className="pet-tool"
            data-pet-circle
            data-testid="pet-chat"
            aria-label="文字聊天"
            aria-expanded={props.chatOpen}
            aria-controls="pet-chat-surface"
            disabled={!props.canChat}
            onClick={props.onChat}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h14v10H9l-4 4V5Z" />
              <path d="M8 9h8M8 12h5" />
            </svg>
          </button>
        ) : null}
        {props.hover.includes('voice') ? (
          <div className="pet-tools__mic">
            <button
              type="button"
              className="pet-tool"
              data-pet-circle
              data-testid="pet-mic"
              aria-label={props.recording ? '结束录音并发送' : '开始语音输入'}
              aria-pressed={props.recording}
              disabled={props.pending || (!props.recording && !props.canRecord)}
              title={
                props.recording
                  ? '结束录音并发送'
                  : props.canRecord
                    ? '开始语音输入'
                    : '语音输入尚未就绪，请在设置中检查'
              }
              onClick={props.onVoice}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {props.recording ? (
                  <path d="M8 8h8v8H8Z" />
                ) : (
                  <>
                    <rect x="9" y="3" width="6" height="12" rx="3" />
                    <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
                  </>
                )}
              </svg>
            </button>
            {props.talkKeyLabel ? (
              <span className="pet-tools__key" data-testid="pet-talk-key">
                {props.talkKeyLabel.replace(/\s+/g, '')}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
