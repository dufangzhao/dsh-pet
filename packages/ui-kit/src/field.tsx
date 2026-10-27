import { useId, type JSX, type ReactNode } from 'react';

export interface FieldControl {
  inputId: string;
  /** 描述与错误共用的 id 串；没有内容时为 undefined。 */
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  /** 标签右侧的一句补充（例如生效方式），不进可访问名称。 */
  hint?: ReactNode;
  description?: string | undefined;
  error?: string | undefined;
  /** 传入控件本身；Field 只负责 label、描述、错误的关联。 */
  children: (control: FieldControl) => ReactNode;
}

/**
 * 表单字段外壳：label 用 htmlFor 指向控件 id，描述与错误通过 aria-describedby 串起来，
 * 有错误时把控件标成 aria-invalid 并用 role="alert" 立即播报。
 *
 * hint 是标签之外的独立文本，所以 label 的可访问名称始终只有 label 本身。
 */
export function Field({ label, hint, description, error, children }: FieldProps): JSX.Element {
  const id = useId();
  const inputId = `${id}-input`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const describedBy =
    [description === undefined ? '' : descriptionId, error === undefined ? '' : errorId]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="pk-field">
      <span className="pk-field__head">
        <label className="pk-field__label" htmlFor={inputId}>
          {label}
        </label>
        {hint === undefined ? null : <span className="pk-field__hint">{hint}</span>}
      </span>
      {description === undefined ? null : (
        <p className="pk-field__description" id={descriptionId}>
          {description}
        </p>
      )}
      {children({ inputId, describedBy, invalid: error !== undefined })}
      {error === undefined ? null : (
        <p className="pk-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
