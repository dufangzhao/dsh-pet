/**
 * 轻气泡：只读地显示宿主 Demo 给的真实文本（识别中、回复中、最近一条或明确错误）。
 * 没有真实数据时退回本状态的原型文案，并保留「模拟」标注。
 * 使用 role="status" + aria-live="polite"，变化可被读屏播报；样式里 pointer-events 关掉，
 * 气泡不参与命中与拖拽，也不改变窗口范围。
 */
import type { PetState } from '@pet/contracts';

import { PET_COPY } from './copy.js';

export interface PetBubbleProps {
  state: PetState;
  /** 宿主的真实文案；null 或缺省表示还没有可读内容，沿用模拟文案。 */
  text?: string | null;
}

export function PetBubble({ state, text }: PetBubbleProps): React.JSX.Element {
  return (
    <div className={`pet-bubble pet-bubble--${state}`} role="status" aria-live="polite">
      <span className="pet-bubble__dot" aria-hidden="true" />
      <p className="pet-bubble__text">{text ?? PET_COPY.stateBubbles[state]}</p>
    </div>
  );
}
