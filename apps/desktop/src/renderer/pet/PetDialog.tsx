/**
 * 可操作的桌宠气泡：内容全部来自宿主的 ApplicationDialog，界面不自己编问题、
 * 不自己加选项，也不把它降级成“点击后跳去设置台”的链接。
 *
 * 三条约束：
 * - 一次选择就是一次配置：提交走 ApplicationBridge.answer({id, step, choice, text})，
 *   结果由宿主回发的快照反映，本地不预先显示“已保存”。
 * - 掩码输入只跟着“能承载文本的那一个选项”离开；稍后/取消一类的选项永远不带值，
 *   提示词或 Key 不会跟着一个取消按钮被提交出去。
 * - 只用真实控件（button / input）：键盘可达、焦点环可见，指针落点同时是命中区，
 *   这样穿透窗口不需要为对话框改动原生几何。
 */
import type { ApplicationChoice, ApplicationDialog, PetState } from '@pet/contracts';
import { useEffect, useId, useRef, useState } from 'react';

import { isSubmitEnter } from './compose-rules.js';
import { PET_COPY } from './copy.js';
import { BUBBLE_EXIT_MS, useBubblePresence, useRevealedText } from './use-bubble-motion.js';

/** 提交计划：谁能带文本，谁只能提交选择。 */
export interface DialogSubmitPlan {
  /** 会连同输入内容一起提交的选项；没有输入框时为 null。 */
  readonly carrier: ApplicationChoice | null;
  /** 只提交选择、不带任何文本的选项。 */
  readonly plain: readonly ApplicationChoice[];
  /** 输入框可用：有输入框却没有能承载文本的选项时不可用。 */
  readonly inputUsable: boolean;
}

/** 纯函数：把 DTO 里的 choices/input 折算成提交计划，便于直接单测。 */
export function planDialogSubmit(
  dialog: Pick<ApplicationDialog, 'choices' | 'input'>,
): DialogSubmitPlan {
  if (dialog.input === undefined) {
    return { carrier: null, plain: dialog.choices, inputUsable: false };
  }
  const carrier = dialog.choices.find((choice) => choice.primary === true) ?? dialog.choices[0];
  if (carrier === undefined) return { carrier: null, plain: dialog.choices, inputUsable: false };
  return {
    carrier,
    plain: dialog.choices.filter((choice) => choice !== carrier),
    inputUsable: true,
  };
}

/** 焦点应该落在哪儿：有输入框先填输入，否则落在第一个选项上。 */
export function dialogFocusTarget(
  dialog: Pick<ApplicationDialog, 'choices' | 'input'>,
): 'input' | 'choice' | null {
  const plan = planDialogSubmit(dialog);
  if (plan.inputUsable) return 'input';
  return dialog.choices.length > 0 ? 'choice' : null;
}

export interface PetDialogProps {
  dialog: ApplicationDialog;
  state: PetState;
  /** 本地在途（等宿主回执）；宿主自己的 dialog.busy 也一起禁用控件。 */
  pending: boolean;
  onAnswer(choice: string, text?: string): void;
  onDismiss?(): void;
  reducedMotion?: boolean;
  speed?: number;
  onGeometryChange?(): void;
  /** 供 App 读取真实矩形算命中区；不参与视觉。 */
  register?: (element: HTMLDivElement | null) => void;
}

export function PetDialog({
  dialog,
  state,
  pending,
  onAnswer,
  onDismiss,
  register,
  reducedMotion = false,
  speed = 100,
  onGeometryChange,
}: PetDialogProps): React.JSX.Element {
  const titleId = useId();
  const errorId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const plan = planDialogSubmit(dialog);
  const disabled = dialog.busy || pending;
  // 换一步（id 或 step 变了）就丢掉上一步的输入；同一步失败重试时保留草稿。
  const fieldKey = dialog.id + ':' + dialog.step;
  const [text, setText] = useState('');
  const [closing, setClosing] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const { present } = useBubblePresence(!closing, reducedMotion);
  const shown = useRevealedText(dialog.text, !reducedMotion, speed, !closing);
  useEffect(() => onGeometryChange?.(), [closing, present, onGeometryChange]);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => dismiss.current?.(), reducedMotion ? 0 : BUBBLE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing, reducedMotion]);
  const [lastKey, setLastKey] = useState(fieldKey);
  if (lastKey !== fieldKey) {
    setLastKey(fieldKey);
    setText('');
    setClosing(false);
  }

  const attach = (element: HTMLDivElement | null): void => {
    rootRef.current = element;
    register?.(element);
  };

  // 只有本窗口已经有焦点时才移动焦点，避免气泡弹出把别的应用焦点抢走。
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    if (typeof document !== 'undefined' && !document.hasFocus()) return;
    const selector =
      dialogFocusTarget(dialog) === 'input' ? '.pet-dialog__input' : '.pet-dialog__choice';
    const target = root.querySelector<HTMLElement>(selector);
    target?.focus();
    // 只在换提示/换步骤时移动焦点：文本变化或宿主推回新快照都不该抢焦点，
    // 因此依赖里只放这两个字段。
  }, [dialog.id, dialog.step]);

  const submit = (choice: string): void => {
    if (disabled) return;
    // 掩码值只跟随能承载文本的选项；其余选项一律不带 text。
    if (choice === plan.carrier?.id) {
      const value = text.trim();
      onAnswer(choice, value === '' ? undefined : value);
      if (dialog.input?.kind === 'secret') setText('');
      return;
    }
    onAnswer(choice);
  };

  if (!present) return <></>;
  return (
    <div className="pet-dialog-wrap" data-closing={closing} inert={closing} aria-hidden={closing}>
      <div
        ref={attach}
        className={`pet-dialog pet-dialog--${state} pet-popover`}
        data-testid="pet-dialog"
        data-busy={disabled ? 'true' : 'false'}
        role="group"
        aria-labelledby={titleId}
        aria-busy={disabled}
        data-pet-surface
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !disabled && onDismiss) {
            event.stopPropagation();
            setClosing(true);
          }
        }}
      >
        <div className="pet-dialog__scroll">
          {onDismiss ? (
            <button
              type="button"
              className="pet-popover__close pet-dialog__dismiss"
              data-testid="pet-dialog-dismiss"
              aria-label="收起提示"
              disabled={disabled}
              onClick={() => setClosing(true)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="m5 5 6 6m0-6-6 6" />
              </svg>
            </button>
          ) : null}
          <p className="pet-dialog__title" id={titleId} data-testid="pet-dialog-title">
            {dialog.title}
          </p>
          <p
            className="pet-dialog__text"
            data-testid="pet-dialog-text"
            role="status"
            aria-live="polite"
            aria-label={dialog.text}
            aria-busy={shown !== dialog.text}
          >
            <span aria-hidden="true">{shown}</span>
          </p>

          {dialog.input !== undefined ? (
            <label className="pet-dialog__field">
              <span className="pet-dialog__label">{dialog.input.label}</span>
              <input
                className="pet-dialog__input"
                type={dialog.input.kind === 'secret' ? 'password' : 'text'}
                placeholder={dialog.input.placeholder ?? ''}
                value={text}
                disabled={!plan.inputUsable || disabled}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={dialog.error !== undefined}
                aria-describedby={dialog.error !== undefined ? errorId : undefined}
                data-testid={`pet-dialog-input-${dialog.input.kind}`}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  // 不用 form 提交：回车显式等价于点“承载文本的那个选项”；
                  // 输入法选词的回车不是提交，别把半句话或半个 Key 交出去。
                  if (!isSubmitEnter(event.nativeEvent) || plan.carrier === null) return;
                  event.preventDefault();
                  submit(plan.carrier.id);
                }}
              />
              {dialog.input.kind === 'secret' ? (
                <span className="pet-dialog__hint">{PET_COPY.dialog.secretHint}</span>
              ) : null}
            </label>
          ) : null}

          <div
            className="pet-dialog__choices"
            role="group"
            aria-label={PET_COPY.dialog.choicesLabel}
          >
            {dialog.choices.map((choice, index) => (
              <button
                key={choice.id}
                type="button"
                className="pet-dialog__choice"
                data-testid={`pet-dialog-choice-${choice.id}`}
                data-primary={choice.primary === true ? 'true' : 'false'}
                disabled={disabled}
                onClick={() => submit(choice.id)}
              >
                <span className="pet-dialog__index" aria-hidden="true">
                  {index + 1}
                </span>
                {choice.label}
              </button>
            ))}
          </div>

          {dialog.input !== undefined && !plan.inputUsable ? (
            <p className="pet-dialog__hint" role="status" data-testid="pet-dialog-unusable">
              {PET_COPY.dialog.noChoice}
            </p>
          ) : null}

          {dialog.error !== undefined ? (
            <p
              className="pet-dialog__error"
              role="alert"
              id={errorId}
              data-testid="pet-dialog-error"
            >
              {dialog.error}
            </p>
          ) : null}

          {disabled ? (
            <p className="pet-dialog__busy" role="status" data-testid="pet-dialog-busy">
              {PET_COPY.dialog.busy}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
