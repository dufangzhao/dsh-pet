import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react';

import { Button } from './button.js';

export interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  /** 底部操作区，通常是两个 Button。 */
  footer?: ReactNode;
  /** Escape、右上角关闭都走这里；关闭后的焦点恢复由 Dialog 负责。 */
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 对话框内实际可聚焦的元素，按 DOM 顺序；隐藏元素排除在外。 */
function focusables(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * 基于原生 <dialog> 的模态框：showModal() 提供顶层渲染、背后内容不可聚焦和 inert。
 * 这里补浏览器不代劳的四件事：初始焦点、Tab 在首尾回绕、Escape 交回调用方、
 * 关闭后把焦点还给触发元素。
 *
 * 回绕必须自己做：Chromium 在最后一个可聚焦元素之后按 Tab 会把 activeElement
 * 放回 body 再继续，焦点因此短暂离开对话框（实测 Tab#6 落在 BODY）。
 * 子元素加 data-autofocus 可指定初始焦点，通常给最安全的那个操作。
 */
export function Dialog({ open, title, children, footer, onClose }: DialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || !open) {
      return;
    }

    // 记录触发元素只做一次：StrictMode 会重放 effect，重复覆盖会丢失真正的来源。
    if (restoreRef.current === null && document.activeElement instanceof HTMLElement) {
      restoreRef.current = document.activeElement;
    }
    // 没有 data-autofocus 时由浏览器决定初始焦点（对话框自身），不猜。
    if (!dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus], [autofocus]')?.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables(dialog);
      const first = items[0];
      const last = items.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const outside = active === null || !dialog.contains(active);
      if (event.shiftKey ? outside || active === first : outside || active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (dialog.open) {
        dialog.close();
      }
      restoreRef.current?.focus();
      restoreRef.current = null;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="pk-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="pk-dialog__header">
        <h2 className="pk-dialog__title" id={titleId}>
          {title}
        </h2>
        <Button variant="quiet" size="small" aria-label="关闭对话框" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="M2 2l8 8M10 2l-8 8"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.5"
            />
          </svg>
        </Button>
      </div>
      <div className="pk-dialog__content">{children}</div>
      {footer === undefined ? null : <div className="pk-dialog__footer">{footer}</div>}
    </dialog>
  );
}
