import { useCallback, useEffect, useState } from 'react';

import { readThemeState, storeTheme, subscribeTheme, type Theme } from './theme.js';

/**
 * 挡位的界面侧状态：读的是那条主题记录，不另存一份。
 *
 * 「界面配色」那一节改挡位时写的也是同一条记录，所以这里必须订阅它——
 * 否则编辑器换了明暗，侧栏那三个 radio 还停在旧 React 状态上。
 */
export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => readThemeState().mode);

  useEffect(() => subscribeTheme((state) => setThemeState(state.mode)), []);

  const setTheme = useCallback((next: Theme): void => {
    // 只改挡位：方案与自定义配色由 storeTheme 原样留着。
    storeTheme(next);
  }, []);

  return { theme, setTheme };
}
