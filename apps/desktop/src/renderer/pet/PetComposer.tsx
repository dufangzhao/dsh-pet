/**
 * 没有可操作提示时，气泡里的日常文字输入。
 *
 * 只做一件事：把这句话交给宿主既有的 DemoBridge.sendText，回到同一条日常互动记录里。
 * 不新建会话、不本地回显、不保存第二份消息列表；草稿只活在这一个输入框里，
 * 宿主真的接受了才清空，失败时原样留着让用户能直接重试。
 */
import { useState } from 'react';

import { canSubmitDraft, draftAfterSubmit, isSubmitEnter } from './compose-rules.js';
import { PET_COPY } from './copy.js';

export interface PetComposerProps {
  /** 宿主说现在能发（DemoSnapshot.canSend）。 */
  canSend: boolean;
  /** 本地在途：等宿主回执。 */
  sending: boolean;
  /** 返回宿主是否接受了这一句；界面据此决定清不清草稿。 */
  onSend(text: string): Promise<boolean>;
}

export function PetComposer({ canSend, sending, onSend }: PetComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  // 空白与纯空格都不给发；输入框本身始终可编辑（只有宿主不能发或在途时才禁用）。
  const canSubmit = canSubmitDraft(text, { canSend, sending });

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    const accepted = await onSend(text.trim());
    setText((draft) => draftAfterSubmit(draft, accepted));
  };

  return (
    <div className="pet-bubble__compose" data-testid="pet-composer">
      <label className="pet-composer__field">
        <span className="pet-composer__label">{PET_COPY.sendLabel}</span>
        <input
          className="pet-composer__input"
          type="text"
          value={text}
          placeholder={PET_COPY.sendPlaceholder}
          disabled={!canSend || sending}
          autoComplete="off"
          spellCheck={false}
          data-testid="pet-composer-input"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // 不用 form 提交：回车就是显式地点“发送”，但输入法选词的回车不是。
            if (!isSubmitEnter(event.nativeEvent)) return;
            event.preventDefault();
            void submit();
          }}
        />
      </label>
      <button
        type="button"
        className="pet-composer__send"
        data-testid="pet-composer-send"
        disabled={!canSubmit}
        title={canSend ? PET_COPY.send : PET_COPY.sendBlocked}
        onClick={() => void submit()}
      >
        {sending ? PET_COPY.sending : PET_COPY.send}
      </button>
    </div>
  );
}
