import { useCallback, useEffect, useRef, useState } from 'react';

import type { ToastItem } from './toast.js';
import type { Tone } from './tone.js';

/** 提示条的自动消失时间；太长会堆积，太短读不完一句中文。 */
export const TOAST_DURATION_MS = 5000;

export interface ToastStore {
  items: ToastItem[];
  push: (message: string, tone?: Tone) => void;
  dismiss: (id: number) => void;
}

/** 一个页面持有 store，渲染一次 Toast 即可；没有 context，避免多一层间接。 */
export function useToastStore(): ToastStore {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: Tone = 'neutral') => {
      nextId.current += 1;
      const id = nextId.current;
      setItems((current) => [...current, { id, message, tone }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );
    },
    [dismiss],
  );

  // 页面卸载时清掉计时器，避免对已卸载组件 setState。
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  return { items, push, dismiss };
}
