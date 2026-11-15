/**
 * 悬停工具：只留文字聊天这一件服务里真有的动作。
 *
 * 语音输入与录音属于本机设备通道，共享组合里没有它；留一个按不动的麦克风
 * 只会让人以为这台机器缺了点什么。命中区仍按画出来的圆逐个计算。
 */
import type { Ref } from 'react';

export interface PetToolsProps {
  register: Ref<HTMLDivElement>;
  hover: readonly string[];
  chatOpen: boolean;
  /** 连接通道存在即可打开：真正的发送可用性由输入框自己判断。 */
  canChat: boolean;
  onChat(): void;
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
            title={props.canChat ? '文字聊天' : '这台机器没有连接服务的通道'}
            onClick={props.onChat}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h14v10H9l-4 4V5Z" />
              <path d="M8 9h8M8 12h5" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
