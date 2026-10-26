/** 七页导航的固定顺序，与设置台信息层级一致。 */
export const PAGES = [
  'start',
  'pet',
  'voice',
  'models',
  'plugins',
  'permissions',
  'about',
] as const;

export type PageId = (typeof PAGES)[number];

export const PAGE_TITLES: Readonly<Record<PageId, string>> = {
  start: '开始',
  pet: '桌宠',
  voice: '语音输入',
  models: '模型',
  plugins: '插件',
  permissions: '权限与数据',
  about: '关于',
};

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && (PAGES as readonly string[]).includes(value);
}

/** 测试与 QA 依赖这些稳定标识，改名会破坏验收脚本。 */
export const NAV_TEST_IDS: Readonly<Record<PageId, string>> = {
  start: 'nav-start',
  pet: 'nav-pet',
  voice: 'nav-voice',
  models: 'nav-models',
  plugins: 'nav-plugins',
  permissions: 'nav-permissions',
  about: 'nav-about',
};

/** 初始页固定为开始页；导航只走 React 状态，不碰 URL。 */
export const DEFAULT_PAGE: PageId = 'start';
