/**
 * 开关：Uiverse.io by andrew-demchenk0 的 empty-penguin-100
 * (MIT, upstream/Toggle-switches/…，SHA-256 见 source-manifest.json)。
 *
 * 原件的那一套一个没动：70×36 一格、100px 圆轨、30px 圆钮、钮上是「off/on」这一句字、
 * checked 时整轨 translateX(-32px) 而钮 translateX(32px)（于是钮在原地，轨从它底下走开），
 * 0.3s 过渡，未开时轨色是 --input-out-of-focus。
 *
 * 两处必要的适配，都记在 adoption-map.md：
 *   1) 上游把 checkbox 藏起来、名称也不写；这里让 <label> 包住原生 checkbox 与名称文字，
 *      可访问名称由那一句文字承担，焦点环用原件自己的 --input-focus。
 *   2) 钮上的字改成中文（content 的默认值仍是原件的 off/on），并保留原位置、原字号、原行高。
 * 原件那个没有样式的 .card-side 节点（只有 Forms 那件给它写过规则）不带进来。
 */
import './source-controls.css';

import { useId, type CSSProperties, type JSX } from 'react';

export interface SourceSwitchProps {
  /** 这一格叫什么，同时是可访问名称。 */
  label: string;
  /** 名称下面那句补充。 */
  hint?: string;
  pressed: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  /** 钮上那两句字：默认中文，去掉它们就是原件的 off/on。 */
  onText?: string;
  offText?: string;
  name?: string;
  className?: string;
  'data-testid'?: string;
}

export function SourceSwitch({
  label,
  hint,
  pressed,
  disabled = false,
  onChange,
  onText = '开',
  offText = '关',
  name,
  className,
  'data-testid': testId,
}: SourceSwitchProps): JSX.Element {
  /* 整块是 <label>，读屏本来会把名称与补充一起当名字念；所以名称与补充各自挂 id，
     控件用 aria-labelledby 只指那一句名称，补充用 aria-describedby。 */
  const id = useId();
  const nameId = id + '-name';
  const hintId = id + '-hint';
  /* 只在中文以外的情形下写这两个自定义属性：默认值就在 CSS 里，值等于原件的字面量。 */
  const knob: CSSProperties =
    onText === 'on' && offText === 'off'
      ? {}
      : ({
          '--su-switch-on-text': '"' + onText + '"',
          '--su-switch-off-text': '"' + offText + '"',
        } as CSSProperties);

  return (
    <label
      className={'su-switch-row' + (className ? ' ' + className : '')}
      style={knob}
      data-state={pressed ? 'on' : 'off'}
    >
      <span className="su-switch">
        <input
          className="su-toggle"
          type="checkbox"
          name={name}
          checked={pressed}
          disabled={disabled}
          aria-labelledby={nameId}
          {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
          data-testid={testId}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="su-slider" aria-hidden="true" />
      </span>
      <span className="su-switch__name" id={nameId}>
        {label}
      </span>
      {hint === undefined ? null : (
        <span className="su-switch__hint" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  );
}
