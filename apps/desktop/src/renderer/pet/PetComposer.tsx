import { useEffect, useRef, useState } from 'react';

import { canSubmitDraft, draftAfterSubmit, isSubmitEnter } from './compose-rules.js';
import { PET_COPY } from './copy.js';

export interface PetComposerProps {
  canSend: boolean;
  sending: boolean;
  onSend(text: string): Promise<boolean>;
  onClose?(): void;
}

export function PetComposer({
  canSend,
  sending,
  onSend,
  onClose,
}: PetComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement | null>(null);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const canSubmit = canSubmitDraft(text, { canSend, sending });

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async (): Promise<void> => {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    try {
      const accepted = await onSend(text.trim());
      setText((draft) => draftAfterSubmit(draft, accepted));
    } finally {
      inFlight.current = false;
      input.current?.focus();
    }
  };

  return (
    <section className="pet-composer" data-testid="pet-composer" data-pet-surface>
      <div className="pet-bubble__compose">
        <label className="pet-composer__field">
          <span className="pet-composer__label">{PET_COPY.sendLabel}</span>
          <textarea
            ref={input}
            className="pet-composer__input"
            rows={1}
            value={text}
            placeholder={PET_COPY.sendPlaceholder}
            readOnly={sending}
            autoComplete="off"
            spellCheck={false}
            data-testid="pet-composer-input"
            aria-description="Enter 发送，Shift + Enter 换行"
            onChange={(event) => setText(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (composing.current || !isSubmitEnter(event.nativeEvent)) return;
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
        {onClose ? (
          <button
            type="button"
            className="pet-icon-button"
            aria-label="收起输入框"
            data-testid="pet-composer-close"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
