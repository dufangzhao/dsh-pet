/**
 * 兼容入口：设置台的页面清单已移到 `console/nav.ts`。
 *
 * 保留这个文件只是为了不让旧引用失效；页面清单、图标与分组只有一个来源。
 */
export {
  CONSOLE_NAV_GROUPS,
  CONSOLE_VIEWS,
  CONSOLE_VIEW_SUMMARY,
  consoleNavItems,
  consoleViewLabel,
  isConsoleView,
  type ConsoleView,
} from '../console/nav.js';
