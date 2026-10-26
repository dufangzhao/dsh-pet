/**
 * 主题偏好：light | dark | system。
 *
 * 只写 <html data-theme>，配色由 ui-kit 的 light-dark() 决定；
 * system 不写死结果，交给 CSS 的 prefers-color-scheme，系统切换时自动跟随。
 */
export const THEMES = ['light', 'dark', 'system'] as const;

export type Theme = (typeof THEMES)[number];

const THEME_LABELS: Readonly<Record<Theme, string>> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

const STORAGE_KEY = 'pet.console.theme';

export function themeLabel(theme: Theme): string {
  return THEME_LABELS[theme];
}

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** 读取失败的存储按未设置处理：localStorage 在受限环境会直接抛错。 */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

export function applyStoredTheme(): void {
  applyTheme(readStoredTheme());
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 存不下只影响下次启动的默认值，当前选择仍然生效。
  }
}
