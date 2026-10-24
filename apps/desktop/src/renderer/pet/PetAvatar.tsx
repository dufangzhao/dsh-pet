/**
 * 原创极简 SVG 角色：不是 Coopanion 的 Coo，也不使用任何外部素材。
 * 只用几何图形与本地 CSS 变量，五种状态共用同一骨架，便于后续迁入角色插件。
 */
import type { PetState } from '@pet/contracts';

export interface PetAvatarProps {
  state: PetState;
  /** 供 App 计算真实命中区与拖拽捕获；不参与视觉。 */
  svgRef?: React.Ref<SVGSVGElement>;
  /** 只在指针落到实际绘制形状上时才会被 App 接受。 */
  onPointerDown?: (event: React.PointerEvent<SVGSVGElement>) => void;
  /** 系统抢走指针捕获时结束拖拽，避免卡在拖拽态。 */
  onLostPointerCapture?: (event: React.PointerEvent<SVGSVGElement>) => void;
}

const LABEL_IDS: Record<PetState, string> = {
  idle: 'pet-eye-idle',
  listening: 'pet-eye-listening',
  thinking: 'pet-eye-thinking',
  replying: 'pet-eye-replying',
  error: 'pet-eye-error',
};

export function PetAvatar({
  state,
  svgRef,
  onPointerDown,
  onLostPointerCapture,
}: PetAvatarProps): React.JSX.Element {
  return (
    <svg
      ref={svgRef}
      className={`pet-avatar pet-avatar--${state}`}
      viewBox="0 0 160 160"
      role="img"
      aria-label="桌宠角色"
      data-testid="pet-avatar"
      data-state={state}
      data-label-id={LABEL_IDS[state]}
      onPointerDown={onPointerDown}
      onLostPointerCapture={onLostPointerCapture}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="pet-body-gradient" cx="50%" cy="38%" r="68%">
          <stop offset="0%" stopColor="var(--pet-body-top, #eaf2ff)" />
          <stop offset="100%" stopColor="var(--pet-body-bottom, #b9cdf2)" />
        </radialGradient>
        <linearGradient id="pet-halo-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--pet-halo, #8fb6ff)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--pet-halo, #8fb6ff)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 光环只在倾听时出现，用透明度过渡而不是改变布局。 */}
      <g className="pet-avatar__halo" aria-hidden="true">
        <ellipse cx="80" cy="150" rx="46" ry="9" fill="url(#pet-halo-gradient)" />
        <circle
          cx="80"
          cy="74"
          r="60"
          fill="none"
          stroke="var(--pet-halo, #8fb6ff)"
          strokeWidth="2"
        />
      </g>

      <g className="pet-avatar__body">
        <path
          className="pet-avatar__ear pet-avatar__ear--left"
          d="M44 44 L36 16 L66 34 Z"
          fill="var(--pet-body-bottom, #b9cdf2)"
        />
        <path
          className="pet-avatar__ear pet-avatar__ear--right"
          d="M116 44 L124 16 L94 34 Z"
          fill="var(--pet-body-bottom, #b9cdf2)"
        />
        <ellipse cx="80" cy="80" rx="52" ry="48" fill="url(#pet-body-gradient)" />
        <ellipse
          className="pet-avatar__face"
          cx="80"
          cy="86"
          rx="38"
          ry="34"
          fill="var(--pet-face, #f7fbff)"
        />
        {/* 眼睛：思考时变成两条弧线，出错时收窄。 */}
        <g className="pet-avatar__eyes" aria-hidden="true">
          <ellipse className="pet-avatar__eye" cx="64" cy="82" rx="6" ry="8" />
          <ellipse className="pet-avatar__eye" cx="96" cy="82" rx="6" ry="8" />
        </g>
        <g className="pet-avatar__brows" aria-hidden="true">
          <path className="pet-avatar__brow pet-avatar__brow--left" d="M56 66 Q64 60 72 66" />
          <path className="pet-avatar__brow pet-avatar__brow--right" d="M88 66 Q96 60 104 66" />
        </g>
        {/* 嘴：回答时轻微开合，其余状态是一条安静的弧线。 */}
        <path
          className="pet-avatar__mouth"
          d="M72 104 Q80 110 88 104"
          fill="none"
          strokeLinecap="round"
        />
        {/* 腮红，纯装饰。 */}
        <ellipse className="pet-avatar__blush" cx="50" cy="96" rx="7" ry="4" />
        <ellipse className="pet-avatar__blush" cx="110" cy="96" rx="7" ry="4" />
      </g>

      {/* 思考三点，只在 thinking 显示。 */}
      <g className="pet-avatar__dots" aria-hidden="true">
        <circle cx="118" cy="42" r="4" />
        <circle cx="130" cy="34" r="5" />
        <circle cx="144" cy="26" r="6" />
      </g>

      {/* 出错标记，只做出错时的视觉锚点，不播放音效。 */}
      <g className="pet-avatar__error-mark" aria-hidden="true">
        <circle cx="124" cy="44" r="11" />
        <path d="M124 38 V46" />
        <circle cx="124" cy="50.5" r="1.4" />
      </g>
    </svg>
  );
}
