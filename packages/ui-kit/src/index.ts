/**
 * @pet/ui-kit：设置台与插件界面共用的基础组件。
 *
 * 组件只依赖 React 与自带 CSS，不引入额外 UI 库；样式令牌集中在 theme.css，
 * 页面通过 <html data-theme="light|dark|system"> 切换主题。
 */
import './theme.css';
import './components.css';

export { Button } from './button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './button.js';

export { Field } from './field.js';
export type { FieldControl, FieldProps } from './field.js';

export { List, ListItem } from './list.js';
export type { ListItemProps, ListProps } from './list.js';

export { Section } from './section.js';
export type { SectionProps } from './section.js';

export { StatusBadge } from './status-badge.js';
export type { StatusBadgeProps } from './status-badge.js';

export { EmptyState } from './empty-state.js';
export type { EmptyStateProps } from './empty-state.js';

export { Dialog } from './dialog.js';
export type { DialogProps } from './dialog.js';

export { Toast } from './toast.js';
export type { ToastItem, ToastProps } from './toast.js';

export { TOAST_DURATION_MS, useToastStore } from './toast-store.js';
export type { ToastStore } from './toast-store.js';

export type { Tone } from './tone.js';

export { UiKitDemo } from './ui-kit-demo.js';
