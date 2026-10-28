/**
 * 设置台里的桌宠预览：只画这台机器正在显示的偏好值，不另存一份状态。
 *
 * 与桌面窗共用同一套思路（原创几何 + 四个颜色变量），但这是设置台自己的绘制：
 * 不引用 pet 窗口的文件，也不假装能命中桌面的真实点击区。
 * 状态只取宿主报上来的那一个；没报出来的表情不画。
 */
import type { ApplicationPreferences, ApplicationSnapshot } from '@pet/contracts';
import { useId, type CSSProperties, type JSX } from 'react';

import { StatusBadge } from '@pet/ui-kit';

import { agentState, figureLabel, paletteLabel, sizeLabel } from './labels.js';
import './pet-preview.css';

/**
 * 四个配色是「配色」这项设置本身，值只在这一处维护：
 * 预览的渐变和装扮页的小色块都读这一张表，不再各存一份。
 */
export const PET_PALETTES: Readonly<
  Record<
    ApplicationPreferences['palette'],
    { top: string; bottom: string; face: string; halo: string }
  >
> = {
  morning: { top: '#eef4ff', bottom: '#b9cdf2', face: '#f9fcff', halo: '#7fa8ff' },
  lavender: { top: '#f3f0ff', bottom: '#c8c0ef', face: '#fbfaff', halo: '#a99cf0' },
  pine: { top: '#eaf6ef', bottom: '#a8cfb8', face: '#f7fcf8', halo: '#6fae86' },
  orange: { top: '#fff3e6', bottom: '#f0c39a', face: '#fffaf3', halo: '#e09a5a' },
};

const EYE_RADIUS: Readonly<Record<ApplicationSnapshot['agent']['state'], number>> = {
  ready: 8,
  starting: 6,
  stopped: 5,
  error: 3,
};

export interface PetPreviewProps {
  /** 界面上正在显示的偏好值（含还没保存的草稿）：编辑什么就预览什么。 */
  values: ApplicationPreferences | null;
  /** 代理的真实状态与宿主给的一句话；null 表示还没读到。 */
  agent: ApplicationSnapshot['agent'] | null;
}

export function PetPreview({ values, agent }: PetPreviewProps): JSX.Element {
  const id = useId();
  const figure = values?.figure ?? 'minimal';
  const palette = values?.palette ?? 'morning';
  const size = values?.size ?? 'normal';
  const visible = values?.visible ?? true;
  const state = agent?.state ?? 'stopped';
  const colors = PET_PALETTES[palette];
  const eyeRadius = EYE_RADIUS[state];

  return (
    <section
      className="pet-preview"
      aria-label="桌宠预览"
      data-size={size}
      style={
        {
          '--pv-top': colors.top,
          '--pv-bottom': colors.bottom,
          '--pv-face': colors.face,
          '--pv-halo': colors.halo,
        } as CSSProperties
      }
    >
      <div className="pet-preview__stage">
        <svg
          className="pet-preview__figure"
          viewBox="0 0 160 160"
          role="img"
          aria-label={`预览：${figureLabel(figure)}形态，${paletteLabel(palette)}配色`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <radialGradient id={`${id}-body`} cx="50%" cy="38%" r="68%">
              <stop offset="0%" stopColor="var(--pv-top)" />
              <stop offset="100%" stopColor="var(--pv-bottom)" />
            </radialGradient>
          </defs>
          {figure === 'round' ? (
            <g className="pet-preview__ears">
              <path d="M44 44 L36 16 L66 34 Z" />
              <path d="M116 44 L124 16 L94 34 Z" />
            </g>
          ) : null}
          <ellipse
            cx="80"
            cy={figure === 'round' ? 80 : 84}
            rx={figure === 'round' ? 48 : 54}
            ry={figure === 'round' ? 48 : 42}
            fill={`url(#${id}-body)`}
          />
          <ellipse className="pet-preview__face" cx="80" cy="88" rx="36" ry="31" />
          <g className="pet-preview__eyes">
            <ellipse cx="66" cy="84" rx="5.5" ry={eyeRadius} />
            <ellipse cx="94" cy="84" rx="5.5" ry={eyeRadius} />
          </g>
          <path
            className="pet-preview__mouth"
            d={state === 'error' ? 'M72 106 Q80 102 88 106' : 'M72 104 Q80 110 88 104'}
          />
          <ellipse className="pet-preview__blush" cx="54" cy="96" rx="6" ry="3.5" />
          <ellipse className="pet-preview__blush" cx="106" cy="96" rx="6" ry="3.5" />
        </svg>
      </div>

      {values === null ? (
        <p className="pet-preview__note">
          还没读到这台机器的偏好；读取成功后，这里画的就是桌面上那一只。
        </p>
      ) : (
        <p className="pet-preview__caption">
          <span className="pet-preview__name">{values.petName}</span>
          <span className="pet-preview__facts">
            {`${figureLabel(figure)} · ${paletteLabel(palette)} · ${sizeLabel(size)}`}
          </span>
        </p>
      )}

      {/* 预览与桌面读同一份值：桌面没显示时这句话要说明，不假装它还在桌上。 */}
      {values !== null && !visible ? (
        <p className="pet-preview__note">现在没有在桌面上显示；改回显示后桌面就是这一只。</p>
      ) : null}

      {agent === null ? null : (
        <p className="pet-preview__state">
          <StatusBadge tone={agentState(state).tone}>{agentState(state).text}</StatusBadge>
          {agent.label === '' ? null : <span className="pet-preview__label">{agent.label}</span>}
        </p>
      )}
    </section>
  );
}
