import { useEffect, useId, useRef, useState } from 'react';

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
  const [expanded, setExpanded] = useState(false);
  const inputId = useId();
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
    <section
      className="pet-composer pet-popover"
      data-expanded={expanded ? 'true' : 'false'}
      data-testid="pet-composer"
      data-pet-surface
    >
      <div className="pet-bubble__compose">
        <label className="pet-composer__field" htmlFor={inputId}>
          <span className="pet-composer__label">{PET_COPY.sendLabel}</span>
          <textarea
            ref={input}
            id={inputId}
            className="pet-composer__input"
            rows={expanded ? 4 : 1}
            value={text}
            placeholder={PET_COPY.sendPlaceholder}
            readOnly={sending}
            autoComplete="off"
            spellCheck={false}
            data-testid="pet-composer-input"
            aria-description="Enter 发送，Shift + Enter 换行"
            onChange={(event) => {
              setText(event.target.value);
              if (event.target.value.includes('\n')) setExpanded(true);
            }}
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
          className="pet-composer__expand"
          data-testid="pet-composer-expand"
          aria-label={expanded ? PET_COPY.collapseInput : PET_COPY.expandInput}
          aria-expanded={expanded}
          aria-controls={inputId}
          title={expanded ? PET_COPY.collapseInput : PET_COPY.expandInput}
          onClick={() => {
            setExpanded((value) => !value);
            input.current?.focus();
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            {expanded ? (
              <path d="M3 8h5V3M12 17v-5h5M8 8 3 3m9 9 5 5" />
            ) : (
              <path d="M12 3h5v5M8 17H3v-5M17 3l-5 5M3 17l5-5" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className="pet-composer__send"
          data-testid="pet-composer-send"
          disabled={!canSubmit}
          aria-busy={sending}
          title={canSend ? PET_COPY.send : PET_COPY.sendBlocked}
          onClick={() => void submit()}
        >
          {sending ? PET_COPY.sending : PET_COPY.send}
        </button>
      </div>
      {onClose ? (
        <button
          type="button"
          className="pet-popover__close"
          aria-label={PET_COPY.closeInput}
          data-testid="pet-composer-close"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m5 5 6 6m0-6-6 6" />
          </svg>
        </button>
      ) : null}
    </section>
  );
}
