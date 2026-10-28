/**
 * 原创极简 SVG 角色：不是 Coopanion 的 Coo，也不使用任何外部素材。
 * 只用几何图形与本地 CSS 变量，五种状态共用同一骨架，便于后续迁入角色插件。
 *
 * 形态（figure）与配色（palette）来自同一份 ApplicationProfile：
 * 桌面窗与设置台读的是同一份快照，所以“预览即桌面”。两种形态都在这个骨架上
 * 换绘制参数，不复制第二份 SVG；命中区由 hit-regions.ts 按同样的形状计算。
 */
import type { PetState } from '@pet/contracts';

import type { PetExpression } from './expression.js';
import type { PetFigure } from './hit-regions.js';

export interface PetAvatarProps {
  state: PetState;
  /**
   * 短时表情，与状态正交：状态说的是它在做什么，表情说的是刚刚真的发生了什么。
   * 缺省 neutral——平时不画腮红，只有戳过之后才短暂出现。
   */
  expression?: PetExpression;
  /** 缺省 minimal：没有读到 profile 时沿用窗口原型自带形态。 */
  figure?: PetFigure;
  /** 只用于无障碍名称；界面不把它当成“宿主已经说了这个名字”的证据。 */
  name?: string | null;
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

interface FacePoint {
  readonly cx: number;
  readonly cy: number;
}

interface FigureGeometry {
  /** 躯干：简约是略扁的椭圆，圆头是正圆（与 hit-regions 的躯干一致）。 */
  readonly body: { cx: number; cy: number; rx: number; ry: number };
  readonly face: { cx: number; cy: number; rx: number; ry: number };
  readonly eyes: readonly [FacePoint, FacePoint];
  readonly brows: readonly [string, string];
  readonly mouth: string;
  readonly blush: readonly [FacePoint, FacePoint];
}

const GEOMETRY: Readonly<Record<PetFigure, FigureGeometry>> = {
  minimal: {
    body: { cx: 80, cy: 80, rx: 52, ry: 48 },
    face: { cx: 80, cy: 86, rx: 38, ry: 34 },
    eyes: [
      { cx: 64, cy: 82 },
      { cx: 96, cy: 82 },
    ],
    brows: ['M56 66 Q64 60 72 66', 'M88 66 Q96 60 104 66'],
    mouth: 'M72 104 Q80 110 88 104',
    blush: [
      { cx: 50, cy: 96 },
      { cx: 110, cy: 96 },
    ],
  },
  round: {
    body: { cx: 80, cy: 80, rx: 55, ry: 55 },
    face: { cx: 80, cy: 84, rx: 42, ry: 38 },
    eyes: [
      { cx: 62, cy: 80 },
      { cx: 98, cy: 80 },
    ],
    brows: ['M53 63 Q61 57 69 63', 'M91 63 Q99 57 107 63'],
    mouth: 'M70 102 Q80 111 90 102',
    blush: [
      { cx: 46, cy: 93 },
      { cx: 114, cy: 93 },
    ],
  },
};

export function PetAvatar({
  state,
  expression = 'neutral',
  figure = 'minimal',
  name = null,
  svgRef,
  onPointerDown,
  onLostPointerCapture,
}: PetAvatarProps): React.JSX.Element {
  const shape = GEOMETRY[figure];
  const [leftBrow, rightBrow] = shape.brows;
  const [leftEye, rightEye] = shape.eyes;
  const [leftBlush, rightBlush] = shape.blush;
  return (
    <svg
      ref={svgRef}
      className={`pet-avatar pet-avatar--${state} pet-avatar--${figure}`}
      viewBox="0 0 160 160"
      role="img"
      aria-label={name === null || name === '' ? '桌宠角色' : `桌宠 ${name}`}
      data-testid="pet-avatar"
      data-state={state}
      data-expression={expression}
      data-figure={figure}
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
        {/* 耳朵只属于简约形态；圆头形态没有额外绘制面，命中区同步少两块。 */}
        {figure === 'minimal' ? (
          <>
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
          </>
        ) : null}
        <ellipse
          cx={shape.body.cx}
          cy={shape.body.cy}
          rx={shape.body.rx}
          ry={shape.body.ry}
          fill="url(#pet-body-gradient)"
        />
        <ellipse
          className="pet-avatar__face"
          cx={shape.face.cx}
          cy={shape.face.cy}
          rx={shape.face.rx}
          ry={shape.face.ry}
          fill="var(--pet-face, #f7fbff)"
        />
        {/* 眼睛：思考时变成两条弧线，出错时收窄。 */}
        <g className="pet-avatar__eyes" aria-hidden="true">
          <ellipse className="pet-avatar__eye" cx={leftEye.cx} cy={leftEye.cy} rx="6" ry="8" />
          <ellipse className="pet-avatar__eye" cx={rightEye.cx} cy={rightEye.cy} rx="6" ry="8" />
        </g>
        <g className="pet-avatar__brows" aria-hidden="true">
          <path className="pet-avatar__brow pet-avatar__brow--left" d={leftBrow} />
          <path className="pet-avatar__brow pet-avatar__brow--right" d={rightBrow} />
        </g>
        {/* 嘴：回答时轻微开合，其余状态是一条安静的弧线。 */}
        <path className="pet-avatar__mouth" d={shape.mouth} fill="none" strokeLinecap="round" />
        {/*
          腮红只在真的戳过之后短暂出现：平时不画，免得把“脸红”画成一只永远红着的角色。
          出现与收回都由 expression.ts 的短时表情控制，这里只按当前表情决定画不画。
        */}
        {expression === 'blush' ? (
          <>
            <ellipse
              className="pet-avatar__blush"
              cx={leftBlush.cx}
              cy={leftBlush.cy}
              rx="7"
              ry="4"
            />
            <ellipse
              className="pet-avatar__blush"
              cx={rightBlush.cx}
              cy={rightBlush.cy}
              rx="7"
              ry="4"
            />
          </>
        ) : null}
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
