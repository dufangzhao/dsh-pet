import type { JSX } from 'react';

import { Button } from './button.js';
import type { Tone } from './tone.js';

export interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

export interface ToastProps {
  items: readonly ToastItem[];
  onDismiss: (id: number) => void;
}

/**
 * 提示条视图：每条自己是一个 live region，插入即播报，不抢焦点。
 * 自动消失的计时放在 useToastStore 里，这里只管显示和关闭。
 */
export function Toast({ items, onDismiss }: ToastProps): JSX.Element {
  return (
    <div className="pk-toast-region">
      <ol className="pk-toast-region__list">
        {items.map((item) => (
          <li key={item.id} className={`pk-toast pk-toast--${item.tone}`}>
            <p className="pk-toast__text" role={item.tone === 'danger' ? 'alert' : 'status'}>
              {item.message}
            </p>
            <Button
              variant="quiet"
              size="small"
              aria-label={`关闭提示：${item.message}`}
              onClick={() => onDismiss(item.id)}
            >
              关闭
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}
