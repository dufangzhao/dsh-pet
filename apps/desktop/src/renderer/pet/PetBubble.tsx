import type { PetState } from '@pet/contracts';
import { useEffect, useState } from 'react';

export interface PetBubbleProps {
  state: PetState;
  text?: string | null;
  composer?: React.ReactNode;
  lifetimeMs?: number;
  register?: (element: HTMLDivElement | null) => void;
  onDismiss?(): void;
}

/** Content only comes from a host event; an idle pet has no fallback sentence. */
export function PetBubble({
  state,
  text,
  composer,
  lifetimeMs = 7000,
  register,
  onDismiss,
}: PetBubbleProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), lifetimeMs);
    return () => clearTimeout(timer);
  }, [text, lifetimeMs]);
  if (dismissed || expired || (!text && !composer)) return null;
  return (
    <div
      ref={register}
      className={`pet-bubble pet-bubble--${state}`}
      data-compose={composer ? 'true' : 'false'}
      data-testid="pet-bubble"
      data-pet-surface
    >
      {text ? (
        <div className="pet-bubble__header">
          <p className="pet-bubble__line" role="status" aria-live="polite">
            <span className="pet-bubble__dot" aria-hidden="true" />
            <span className="pet-bubble__text">{text}</span>
          </p>
          <button
            type="button"
            className="pet-icon-button"
            data-pet-hit
            aria-label="收起气泡"
            data-testid="pet-bubble-dismiss"
            onClick={() => {
              setDismissed(true);
              onDismiss?.();
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}
      {composer}
    </div>
  );
}
