/**
 * 极简设置台的控件层：按钮、卡片、字段、开关、原生下拉与状态。
 *
 * 形状只有一套，取自 qa/minimal-settings-preview 与它的 style.css：白色 20px 圆角卡片、
 * 50px 字段、黑底主按钮、白底细边次按钮、10px 圆角，没有投影、箭头或展开圆。样式住在
 * 同目录的 foundation.css；这里只接浏览器本来就有的语义（原生 label、checkbox、select、
 * role=status/alert）与等待态，不再加第二层状态。
 */
import {
  createElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type JSX,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

/* -------------------------------------------------------------------- 按钮 */

/**
 * 四种轻重只有颜色差别：primary 是黑底那一格，secondary 就是原件的白底细边，
 * ghost 只留字，danger 换成危险色。没有图标位、没有按下的位移。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 正在等结果：禁用并按 aria-busy 播报；文字仍由调用方给，控件不编造进度。 */
  busy?: boolean;
  variant?: ButtonVariant;
  size?: 'small';
}

export function Button({
  busy = false,
  variant = 'secondary',
  size,
  type = 'button',
  disabled = false,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const names =
    'btn' +
    (variant === 'secondary' ? '' : ' btn--' + (variant === 'ghost' ? 'quiet' : variant)) +
    (size === undefined ? '' : ' btn--' + size) +
    (className === undefined ? '' : ' ' + className);
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      {...(busy ? { 'aria-busy': true as const } : {})}
      className={names}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- 卡片 */

export interface CardProps {
  title: string;
  children: ReactNode;
  /** 标题同一行右侧的真实状态或整块操作；没有就不占位。 */
  action?: ReactNode;
  className?: string;
  id?: string;
}

/** 一节内容：article.card + header.card__head + h2.card__title + div.card__body。 */
export function Card({ title, children, action, className, id }: CardProps): JSX.Element {
  return (
    <article
      {...(id === undefined ? {} : { id })}
      className={className === undefined ? 'card' : 'card ' + className}
    >
      <header className="card__head">
        <h2 className="card__title">{title}</h2>
        {action === undefined ? null : <div className="card__action">{action}</div>}
      </header>
      <div className="card__body">{children}</div>
    </article>
  );
}

/** 页面里的一节与卡片是同一种东西；名字分开只为读起来像页面。 */
export const Section = Card;

/* -------------------------------------------------------------------- 字段 */

/** 字段交给控件的关联契约：原生 label 的 for、错误播报的 id 与 invalid 标记。 */
export interface FieldControl {
  inputId: string;
  labelId: string;
  /** 有错误时是错误节点的 id；没有错误就是 undefined。 */
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  /**
   * 节点＝这一栏只有一件控件；函数＝拿到关联 id 自己放控件。
   * 原生 input/select/textarea 由这里套上 .inputForm，自带外壳的控件（例如 Select）原样放。
   */
  children: ReactNode | ((control: FieldControl) => ReactNode);
  /** 出现时控件标为 aria-invalid，并立即播报；不写通用提示句。 */
  error?: string;
  className?: string;
}

export function Field({ label, children, error, className }: FieldProps): JSX.Element {
  const base = useId();
  const inputId = base + '-input';
  const labelId = base + '-label';
  const errorId = base + '-error';
  const control: FieldControl = {
    inputId,
    labelId,
    describedBy: error === undefined ? undefined : errorId,
    invalid: error !== undefined,
  };
  const content = typeof children === 'function' ? children(control) : children;
  const native = nativeFieldOf(content);

  return (
    <div className={className === undefined ? 'field' : 'field ' + className}>
      <label className="field__label" id={labelId} htmlFor={inputId}>
        {label}
      </label>
      {native === null ? (
        content
      ) : (
        <div className="inputForm" {...(native === 'textarea' ? { 'data-multiline': true } : {})}>
          {content}
        </div>
      )}
      {error === undefined ? null : (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * 只有原生文本控件需要那一层 50px 的外壳：多行输入用 data-multiline 收起高度。
 * 自带外壳的控件（Select、model-inline 这类组合行）不再套第二层。
 */
function nativeFieldOf(node: ReactNode): 'input' | 'select' | 'textarea' | null {
  if (!isValidElement(node)) {
    return null;
  }
  if (node.type === 'input') {
    return 'input';
  }
  if (node.type === 'select') {
    return 'select';
  }
  return node.type === 'textarea' ? 'textarea' : null;
}

/* -------------------------------------------------------------------- 下拉 */

export interface SelectOption {
  value: string;
  label: string;
  /** 选项里的品牌或状态图形；装饰性，名称仍由 label 承担。 */
  icon?: ReactNode;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly SelectOption[];
}

/**
 * 原生可定制下拉：键盘、方向键、Escape、外部点击关闭与 change 事件全部由 select 自己处理，
 * 这一层只补 HTML 里那三个节点（触发器、selectedcontent、箭头）。没有 JS 列表，也没有第二份展开状态。
 */
export function Select({ options, className, ...rest }: SelectProps): JSX.Element {
  return (
    <div className="inputForm">
      <select {...rest} className={className === undefined ? 'select' : 'select ' + className}>
        <button type="button" className="select__trigger">
          {createElement('selectedcontent', { className: 'select__selected' })}
          <span className="select__arrow" aria-hidden="true" />
        </button>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.icon === undefined ? null : option.icon}
            <span className="opt__name">{option.label}</span>
          </option>
        ))}
      </select>
    </div>
  );
}

/* -------------------------------------------------------------------- 开关 */

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  'data-testid'?: string;
}

/** 原生 checkbox 换成开关的样子：整行是可点的 label，方向键与空格照旧。 */
export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
  id,
  className,
  'data-testid': testId,
}: SwitchProps): JSX.Element {
  return (
    <label className={className === undefined ? 'row' : 'row ' + className}>
      <span className="row__text">
        <span className="row__label">{label}</span>
      </span>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          {...(id === undefined ? {} : { id })}
          {...(testId === undefined ? {} : { 'data-testid': testId })}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i aria-hidden="true" />
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------- 状态 */

export type StatusTone = 'ok' | 'warn' | 'danger' | 'muted' | 'off';

export interface StatusProps {
  children: ReactNode;
  tone?: StatusTone;
}

/** 一句可读的状态：语气只上色，含义始终在文字里。 */
export function Status({ children, tone = 'muted' }: StatusProps): JSX.Element {
  return (
    <span className="status" data-tone={tone}>
      {children}
    </span>
  );
}
