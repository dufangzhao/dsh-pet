import type { PetState } from '@pet/contracts';
import { useEffect, useState } from 'react';

import { useBubblePresence, useRevealedText } from './use-bubble-motion.js';

export interface PetBubbleProps {
  state: PetState;
  text?: string | null;
  composer?: React.ReactNode;
  lifetimeMs?: number;
  reveal?: boolean;
  streaming?: boolean;
  speed?: number;
  reducedMotion?: boolean;
  register?: (element: HTMLDivElement | null) => void;
  onGeometryChange?(): void;
  onDismiss?(): void;
}

/** Content only comes from a host event; an idle pet has no fallback sentence. */
export function PetBubble({
  state,
  text,
  composer,
  lifetimeMs = 7000,
  reveal = false,
  streaming = false,
  speed = 100,
  reducedMotion = false,
  register,
  onGeometryChange,
  onDismiss,
}: PetBubbleProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const [expired, setExpired] = useState(false);
  const shown = useRevealedText(
    text ?? '',
    reveal && !reducedMotion,
    speed,
    !dismissed && !expired,
  );
  const typing = shown !== (text ?? '');
  const { present, closing } = useBubblePresence(
    !dismissed && !expired && Boolean(text || composer),
    reducedMotion,
  );

  useEffect(() => {
    setExpired(false);
    if (typing || streaming) return;
    const timer = setTimeout(() => setExpired(true), lifetimeMs);
    return () => clearTimeout(timer);
  }, [text, lifetimeMs, typing, streaming]);
  useEffect(() => onGeometryChange?.(), [closing, present, onGeometryChange]);

  if (!present) return null;
  return (
    <div className="pet-bubble-wrap" data-closing={closing} inert={closing} aria-hidden={closing}>
      <div
        ref={register}
        className={`pet-bubble pet-bubble--${state} pet-popover`}
        data-compose={composer ? 'true' : 'false'}
        data-testid="pet-bubble"
        data-pet-surface
      >
        {text ? (
          <div className="pet-bubble__header">
            <p
              className="pet-bubble__line"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-busy={typing || streaming}
              aria-label={text}
            >
              <span className="pet-bubble__dot" aria-hidden="true" />
              <span className="pet-bubble__text" aria-hidden="true">
                {shown}
                {typing ? <span className="pet-bubble__caret" /> : null}
              </span>
            </p>
            <button
              type="button"
              className="pet-popover__close"
              data-pet-hit
              aria-label="收起气泡"
              data-testid="pet-bubble-dismiss"
              onClick={() => {
                setDismissed(true);
                onDismiss?.();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="m5 5 6 6m0-6-6 6" />
              </svg>
            </button>
          </div>
        ) : null}
        {composer}
      </div>
    </div>
  );
}
