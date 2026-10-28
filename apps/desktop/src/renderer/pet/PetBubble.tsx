/**
 * 轻气泡：只读地显示宿主 Demo 给的真实文本（识别中、回复中、最近一条或明确错误），
 * 没有真实数据时退回本状态的原型文案并保留「模拟」标注。
 *
 * 播报只覆盖文字那一行（role=status + aria-live=polite）：输入框和按钮是真实控件，
 * 不能被塞进实时区域里，否则用户每敲一个字读屏就跟着念一遍。
 * 文字本身不参与命中与拖拽（容器 pointer-events 关掉）；只有装配了真实控件时
 * （composer，或宿主的 ApplicationDialog 换成 PetDialog），那一块才要指针，
 * 由 App 把它的矩形加进命中集合。
 */
import type { PetState } from '@pet/contracts';

import { PET_COPY } from './copy.js';

export interface PetBubbleProps {
  state: PetState;
  /** 宿主的真实文案；null 或缺省表示还没有可读内容，沿用模拟文案。 */
  text?: string | null;
  /** 日常文字输入；只有宿主 Demo 活着时才装配。 */
  composer?: React.ReactNode;
  /** 供 App 读取真实矩形算命中区；不参与视觉。 */
  register?: (element: HTMLDivElement | null) => void;
}

export function PetBubble({ state, text, composer, register }: PetBubbleProps): React.JSX.Element {
  const hasComposer = composer !== undefined && composer !== null;
  return (
    <div
      ref={register}
      className={`pet-bubble pet-bubble--${state}`}
      data-compose={hasComposer ? 'true' : 'false'}
      data-testid="pet-bubble"
    >
      <p className="pet-bubble__line" role="status" aria-live="polite">
        <span className="pet-bubble__dot" aria-hidden="true" />
        <span className="pet-bubble__text">{text ?? PET_COPY.stateBubbles[state]}</span>
      </p>
      {composer}
    </div>
  );
}
