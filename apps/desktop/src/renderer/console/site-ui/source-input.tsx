/**
 * 输入栏与它的名称块：Uiverse.io by andrew-demchenk0 的 polite-stingray-67
 * （MIT，upstream/Inputs/…，SHA-256 见 source-manifest.json）。
 *
 * 原件只有一栏 <input>：白底、2px 描边、4px 4px 硬投影、5px 10px 内边距、15px/600 字、
 * 焦点换描边色。名称、补充与失败原因上游没有，是本站的延伸（见 .su-field 那一段），
 * 用原生 <label htmlFor> 与 aria-describedby 串起来，不把它们塞进可访问名称里。
 *
 * 原件用 placeholder 当名称（"Password"）——上游那一格是自成一页的示范，站里有整页文字；
 * 设置台里同一栏要和别的行对齐读，所以名称走上方的 <label>，placeholder 只留举例。
 */
import './source-controls.css';

import { useId, type InputHTMLAttributes, type JSX, type ReactNode } from 'react';

/** 交给控件的关联契约：一栏接 inputId 与 describedBy。 */
export interface SourceFieldControl {
  readonly inputId: string;
  readonly labelId: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

export interface SourceInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 失败原因已经写在名称块里时，这里只把那一格标成无效：aria-invalid 是浏览器与读屏用的那一句。 */
  invalid?: boolean;
}

export function SourceInput({
  invalid = false,
  className,
  ...rest
}: SourceInputProps): JSX.Element {
  return (
    <input
      {...rest}
      // invalid=false 不该把调用方自己传进来的原生 aria-invalid 一起抹掉
      {...(invalid ? { 'aria-invalid': true as const } : {})}
      className={'su-input' + (className ? ' ' + className : '')}
    />
  );
}

export interface SourceFieldProps {
  /** 这一栏叫什么：控件的可访问名称只有它。 */
  label: string;
  /** 一句补充（生效方式、代价）。会串进 aria-describedby。 */
  hint?: ReactNode;
  /** 失败原因：出现时控件标 aria-invalid，并用 role=alert 立即播报。 */
  error?: string;
  className?: string;
  /**
   * 函数＝名称那一句是 <label htmlFor>，指向调用方接了 inputId 的控件（一栏多个控件时用这一条）。
   * 节点＝整块就是一张 <label>，控件在里面由浏览器做隐式关联（一格一个控件的情形）。
   */
  children: ReactNode | ((control: SourceFieldControl) => ReactNode);
}

/**
 * 名称 + 一栏 + 补充/失败：上游这一件只给了中间那一栏，这一块是本站的延伸，
 * 用的仍是同一份材质（同色文字、同一条 2px 描边的焦点蓝做失败色之外的补充色不参与）。
 */
export function SourceField({
  label,
  hint,
  error,
  className,
  children,
}: SourceFieldProps): JSX.Element {
  const id = useId();
  const inputId = id + '-input';
  const labelId = id + '-name';
  const hintId = id + '-hint';
  const errorId = id + '-error';
  const describedBy =
    [hint === undefined ? '' : hintId, error === undefined ? '' : errorId]
      .filter(Boolean)
      .join(' ') || undefined;
  const holdsControl = typeof children === 'function';
  const control = holdsControl
    ? children({ inputId, labelId, describedBy, invalid: error !== undefined })
    : children;

  /* 节点模式里整块就是 label，名称那一句不能再是第二个 label。 */
  const Wrapper = holdsControl ? 'div' : 'label';

  return (
    <div className={'su-field' + (className ? ' ' + className : '')}>
      {holdsControl ? (
        <label className="su-field__label" id={labelId} htmlFor={inputId}>
          {label}
        </label>
      ) : (
        <span className="su-field__label" id={labelId}>
          {label}
        </span>
      )}
      <Wrapper className="su-field__slot">{control}</Wrapper>
      {hint === undefined ? null : (
        <p className="su-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="su-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
