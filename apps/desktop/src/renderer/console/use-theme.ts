import { useCallback, useState } from 'react';

import { applyTheme, readStoredTheme, storeTheme, type Theme } from './theme.js';

/** 主题选择的唯一状态源；切换时同步写 DOM 与 localStorage。 */
export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    storeTheme(next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
