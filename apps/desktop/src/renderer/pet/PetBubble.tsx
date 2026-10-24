/**
 * 轻气泡：只显示状态与模拟文案，不承载真实录音/对话内容。
 * 使用 role="status" + aria-live="polite"，状态变化可被读屏播报。
 */
import type { PetState } from '@pet/contracts';

import { PET_COPY } from './copy.js';

export interface PetBubbleProps {
  state: PetState;
}

export function PetBubble({ state }: PetBubbleProps): React.JSX.Element {
  return (
    <div className={`pet-bubble pet-bubble--${state}`} role="status" aria-live="polite">
      <span className="pet-bubble__dot" aria-hidden="true" />
      <p className="pet-bubble__text">{PET_COPY.stateBubbles[state]}</p>
    </div>
  );
}
