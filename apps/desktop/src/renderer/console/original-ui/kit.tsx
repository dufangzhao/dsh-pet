/**
 * 原创控件（pet bench）：七个真在用的东西，没有配置引擎。
 *
 * 每条都遵守同一件事：把原生 props 交给原生元素，只补三样——这套自己的板面结构、
 * 状态用 data-* 与文字一起表达、可访问名称只有名称那一句（补充与失败原因都在 label 之外，
 * 需要关联的用 aria-describedby 串，不靠把文字塞进标签）。
 * 没有 tone 之外的开关，没有渲染引擎，也没有把旧 ui-kit 的 JSX 包一层。
 *
 * 类名前缀 pb-（pet bench）。旧的 pk-button / pk-field / pk-input / pk-pill / pk-sheet
 * 与 console-segmented 不在这里，也不该出现在 Start 的呈现里。
 */
import './design-tokens.css';
import './kit.css';

import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type JSX,
  type ReactNode,
} from 'react';

/** 空值不进 class 串，作者传的 className 永远排在最后。 */
function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter((name): name is string => Boolean(name)).join(' ');
}

/* ------------------------------------------------------------------ Button */

export type ButtonVariant = 'primary' | 'neutral' | 'quiet' | 'danger';
export type ButtonSize = 'normal' | 'small';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 正在等结果：禁用、标 aria-busy，并显示板内等待记号。动作词由调用方写清楚。 */
  busy?: boolean;
  /** 文字左边的一枚记号（自家字形或厂商标记）。装饰性，读屏拿到的是文字。 */
  leading?: ReactNode;
}

/**
 * 板扣按钮：一层板面 + 一道板底搁置。按下去板面沉到搁置上（位移 2px），
 * 松手弹回——状态反馈靠这一下，不靠换色。
 *
 * primary 是本套唯一的实心强调板，一屏至多一颗（保存并开始）。
 */
export function Button({
  variant = 'neutral',
  size = 'normal',
  busy = false,
  leading,
  type = 'button',
  disabled = false,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      data-busy={busy ? 'true' : undefined}
      className={cx('pb-btn', 'pb-btn--' + variant, size === 'small' && 'pb-btn--sm', className)}
    >
      {busy ? <span className="pb-busy" aria-hidden="true" /> : null}
      {busy || leading === undefined ? null : (
        <span className="pb-lead" aria-hidden="true">
          {leading}
        </span>
      )}
      <span className="pb-btn__label">{children}</span>
    </button>
  );
}

/* ------------------------------------------------------------------- Field */

/**
 * 交给控件的关联契约。单个控件接 inputId 与 describedBy；
 * 控件组（单选、分段）用 labelledBy 指铭牌上的名称，describedBy 照样接。
 */
export interface FieldControl {
  inputId: string;
  /** 名称元素的 id，给控件组做 aria-labelledby。 */
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  /** 铭牌上的名称：控件的可访问名称只有它，补充与失败原因都不进名称。 */
  label: string;
  /** 板下的一句补充（生效方式、代价）。节点模式只做可见补充；函数模式会串进 describedBy。 */
  hint?: ReactNode;
  /** 失败原因：出现时控件标 aria-invalid，并用 role=alert 立即播报。 */
  error?: string | undefined;
  className?: string | undefined;
  /**
   * 节点＝整块板子是 <label>，控件画在里面，浏览器做隐式关联（一格一个控件的情形）。
   * 函数＝铭牌上的 <label htmlFor=inputId> 指向控件，调用方把 inputId、describedBy 接上去；
   * 一格多个控件（单选组、颜色 + 十六进制）用这一条。
   */
  children: ReactNode | ((control: FieldControl) => ReactNode);
}

/**
 * 抽屉标签字段：铭牌压在板子上沿，控件坐在板面里，补充与失败写在板底搁置下面——
 * 名称、控件、结果三段在同一块板上，不靠绝对定位。
 */
export function Field({ label, hint, error, className, children }: FieldProps): JSX.Element {
  const id = useId();
  const inputId = id + '-input';
  const labelId = id + '-name';
  const hintId = id + '-hint';
  const errorId = id + '-error';
  const holdsControl = typeof children === 'function';
  const describedBy =
    [hint === undefined ? '' : hintId, error === undefined ? '' : errorId]
      .filter(Boolean)
      .join(' ') || undefined;
  const control = holdsControl
    ? children({ inputId, labelId, describedBy, invalid: error !== undefined })
    : children;
  /* 节点模式里 name 只是文字：整块板子已经是 label，不能再嵌一个 label。 */
  const Plate = holdsControl ? 'div' : 'label';

  return (
    <div className={cx('pb-field', error !== undefined && 'pb-field--bad', className)}>
      <Plate className="pb-field__plate">
        <span className="pb-field__tag">
          {holdsControl ? (
            <label className="pb-field__name" id={labelId} htmlFor={inputId}>
              {label}
            </label>
          ) : (
            <span className="pb-field__name" id={labelId}>
              {label}
            </span>
          )}
        </span>
        <span className="pb-field__slot">{control}</span>
      </Plate>
      {hint === undefined ? null : (
        <p className="pb-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="pb-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Toggle */

/** 除 type / checked / onChange / className 之外，原生 checkbox 的 props 全部透传给真控件。 */
export interface ToggleProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'onChange' | 'className'
> {
  /** 开关的名称：控件的可访问名称只有它。 */
  label: ReactNode;
  /** 名称下面的一句补充；在 label 之外，不进可访问名称。 */
  hint?: ReactNode;
  /** 状态本身；落在原生 checkbox 的 checked 上，空格键与读屏都由浏览器负责。 */
  pressed: boolean;
  /** 只给结论（ true / false ），不用自己拆事件。 */
  onChange: (next: boolean) => void;
  className?: string;
}

/**
 * 插销板开关：一块方形板 + 一枚方销，板上的「开/关」只是给眼睛看的记号（aria-hidden）。
 * 名称用 <label htmlFor> 指到原生控件，补充在 label 之外，所以可访问名称只有名称那一句。
 * data-testid 一类的原生 props 直接落到 <input> 上，不做第二套命名。不是旧的那种胶囊滑动开关。
 */
export function Toggle({
  label,
  hint,
  pressed,
  onChange,
  className,
  ...inputProps
}: ToggleProps): JSX.Element {
  const id = useId();
  const inputId = inputProps.id ?? id + '-input';
  const hintId = id + '-hint';

  return (
    <span className={cx('pb-toggle', className)} data-pressed={pressed ? 'true' : 'false'}>
      {/* 名称单独是一个 label；补充是它的兄弟节点，用 aria-describedby 关联，
          所以读屏念到的可访问名称只有名称那一句。 */}
      <span className="pb-toggle__text">
        <label className="pb-toggle__name" htmlFor={inputId}>
          {label}
        </label>
        {hint === undefined ? null : (
          <span className="pb-toggle__hint" id={hintId}>
            {hint}
          </span>
        )}
      </span>
      <span className="pb-toggle__plate">
        {/* 原生控件铺满这块板：点击区、键盘与状态都在它身上。 */}
        <input
          {...inputProps}
          type="checkbox"
          role="switch"
          className="pb-toggle__input"
          id={inputId}
          checked={pressed}
          aria-describedby={hint === undefined ? undefined : hintId}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span className="pb-toggle__word" aria-hidden="true">
          {pressed ? '开' : '关'}
        </span>
        <span className="pb-toggle__knob" aria-hidden="true" />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ Status */

export type StatusTone = 'neutral' | 'on' | 'off' | 'ok' | 'warn' | 'danger';

export interface StatusProps {
  tone?: StatusTone;
  className?: string;
  children: ReactNode;
}

/**
 * 状态牌：右上角切掉一格，里面一盏灯 + 一句话。文字永远在场，灯只是辅助，
 * 所以色盲截图与小屏放大下含义不丢。取代旧的 pk-pill / StatusBadge 呈现。
 */
export function Status({ tone = 'neutral', className, children }: StatusProps): JSX.Element {
  return (
    <span className={cx('pb-status', className)} data-tone={tone}>
      <span className="pb-status__lamp" aria-hidden="true" />
      <span className="pb-status__text">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ Notice */

export type NoticeTone = 'neutral' | 'ok' | 'warn' | 'danger';

export interface NoticeProps {
  tone?: NoticeTone;
  /** 结果回执要立刻播报（默认是）；只是说明性的一段时关掉。 */
  live?: boolean;
  /** 一句后续动作，例如「重新读取」。 */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

const NOTICE_MARK: Readonly<Record<NoticeTone, ReactNode>> = {
  neutral: <path d="M7 3.4 3.6 9.2h2.3L5.4 12.6 9 6.8H6.7Z" />,
  ok: <path d="m3 7.2 2.6 2.6L11 4.4" />,
  warn: <path d="M7 2.2v5.2M7 9.6h.01" />,
  danger: <path d="M3.4 3.4 10.6 10.6M10.6 3.4 3.4 10.6" />,
};

/**
 * 回执与失败的一行：左边一道色规 + 一枚记号，正文说清发生了什么、下一步做什么。
 * danger 用 role=alert，其余 role=status——失败要打断，进度不必。
 */
export function Notice({
  tone = 'neutral',
  live = true,
  action,
  className,
  children,
}: NoticeProps): JSX.Element {
  return (
    <div
      className={cx('pb-notice', className)}
      data-tone={tone}
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <svg
        className="pb-notice__mark"
        viewBox="0 0 14 14"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {NOTICE_MARK[tone]}
      </svg>
      <div className="pb-notice__body">{children}</div>
      {action === undefined ? null : <div className="pb-notice__action">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------- Tile */

export interface TileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** 井格里的厂商图形。给不出来就空着，名称本来就在文字里。 */
  leading?: ReactNode;
  /** 名称右边的一句状态：未接入、国际平台、已存有 Key。 */
  note?: ReactNode;
}

/**
 * 抽屉式选择瓦片：方形井格 + 名称 + 一句状态 + 右下角那一枚方销，取代旧胶囊芯片行。
 *
 * 默认当成「按下/松开」的切换按钮；一组里必须单选时，调用方直接传原生
 * role="radio" 与 aria-checked——props 全透传，不再包一层。
 */
export function Tile({
  selected = false,
  leading,
  note,
  type = 'button',
  disabled = false,
  className,
  children,
  ...rest
}: TileProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-pressed={selected ? true : undefined}
      data-selected={selected ? 'true' : 'false'}
      className={cx('pb-tile', className)}
    >
      {leading === undefined ? null : (
        <span className="pb-tile__well" aria-hidden="true">
          {leading}
        </span>
      )}
      <span className="pb-tile__name">{children}</span>
      {note === undefined ? null : <span className="pb-tile__note">{note}</span>}
      <span className="pb-tile__pin" aria-hidden="true" />
    </button>
  );
}

/* -------------------------------------------------------------- Disclosure */

export interface DisclosureProps {
  label: ReactNode;
  hint?: ReactNode;
  /** 受控展开。React 的 details 只认 open，所以 defaultOpen 走同一条路：写初值，之后由浏览器自己开合。 */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** 第一次画出来就是展开的。 */
  defaultOpen?: boolean | undefined;
  className?: string;
  children: ReactNode;
}

/**
 * 抽屉段：原生 details/summary，名称一行、补充一句、右边一枚折角箭头。
 * 展开只让箭头转一次并淡入内容；减少动态时直接开合。
 */
export function Disclosure({
  label,
  hint,
  open,
  onOpenChange,
  defaultOpen = false,
  className,
  children,
}: DisclosureProps): JSX.Element {
  return (
    <details
      className={cx('pb-fold', className)}
      open={open ?? (defaultOpen ? true : undefined)}
      onToggle={(event) => {
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary className="pb-fold__summary">
        <span className="pb-fold__label">{label}</span>
        {hint === undefined ? null : <span className="pb-fold__hint">{hint}</span>}
        <span className="pb-fold__chevron" aria-hidden="true" />
      </summary>
      <div className="pb-fold__body">{children}</div>
    </details>
  );
}
