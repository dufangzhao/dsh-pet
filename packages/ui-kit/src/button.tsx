import type { ButtonHTMLAttributes, JSX } from 'react';

export type ButtonVariant = 'secondary' | 'primary' | 'quiet' | 'danger';
export type ButtonSize = 'default' | 'small';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

/** 原生 <button>，只补样式与默认 type="button"，不隐藏任何键盘/表单语义。 */
export function Button({
  variant = 'secondary',
  size = 'default',
  block = false,
  type = 'button',
  className,
  ...rest
}: ButtonProps): JSX.Element {
  const names = [
    'pk-button',
    variant === 'secondary' ? '' : `pk-button--${variant}`,
    size === 'small' ? 'pk-button--small' : '',
    block ? 'pk-button--block' : '',
    className ?? '',
  ];

  return <button {...rest} type={type} className={names.filter(Boolean).join(' ')} />;
}
