/**
 * 选项组（三态/多选一）：Uiverse.io by andrew-demchenk0 的 stupid-seahorse-9
 * （MIT，upstream/Radio-buttons/…，sha256 d0b435d6…，
 * https://uiverse.io/andrew-demchenk0/stupid-seahorse-9）。
 *
 * 原件的记号照抄：250×36 一条、34px 端圆 + 2px 描边 + 4px 4px 硬投影、里面一格顶边左各 2px、
 * 50px 圆角、选中时整格填 --main-color 且字变成 --bg-color。
 * 两处必要适配：上游三格写死 80.5px，这里按选项数分宽（窄栏不溢出）；
 * 上游的文字只是 .btn 里的一句字、input 没有可访问名称，这里让原生 <label> 包住 input 与文字，
 * 单选组本身用 fieldset/legend 说一句这一组是什么。
 */
import './source-controls.css';

import type { JSX } from 'react';

export interface SourceRadioOption {
  readonly value: string;
  /** 这一格看得见的字（窄侧栏里可能只有两字）。 */
  readonly label: string;
  /** 读屏听到的完整名称；不给就用上面那一句。 */
  readonly ariaLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
}

export interface SourceRadioGroupProps {
  /** 这一组的名字：既是 legend，也是读屏听到的组名。 */
  label: string;
  name: string;
  value: string;
  options: readonly SourceRadioOption[];
  onChange: (next: string) => void;
  className?: string;
  'data-testid'?: string;
}

export function SourceRadioGroup({
  label,
  name,
  value,
  options,
  onChange,
  className,
  'data-testid': testId,
}: SourceRadioGroupProps): JSX.Element {
  return (
    <fieldset
      className={'su-choice-field' + (className ? ' ' + className : '')}
      data-testid={testId}
    >
      <legend className="su-choice-field__legend">{label}</legend>
      <div className="su-choice">
        {options.map((option) => (
          <label className="su-choice__option" key={option.value}>
            <input
              className="su-choice__input"
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              {...(option.ariaLabel === undefined ? {} : { 'aria-label': option.ariaLabel })}
              {...(option.disabled === true ? { disabled: true } : {})}
              onChange={() => onChange(option.value)}
            />
            {/* 有完整名称时，可见那两句字就只是给眼睛看的，不再当一次名字。 */}
            <span
              className="su-choice__btn"
              {...(option.ariaLabel === undefined ? {} : { 'aria-hidden': true })}
            >
              <span className="su-choice__span">{option.label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
