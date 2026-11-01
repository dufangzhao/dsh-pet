import { useEffect, useState } from 'react';
import { isPetPresentationTheme, type PetPresentationTheme } from '@pet/contracts';
import { committedPalette, readThemeState, resolveAppearance, subscribeTheme } from './theme.js';
/** Projects the existing theme owner into the pet window; no second persistent copy. */
export function usePresentationTheme(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const bridge = window.petPresentation;
    if (!bridge) {
      setError('桌宠配色同步暂不可用');
      return;
    }
    const publish = () => {
      const palette = committedPalette();
      const candidate = {
        appearance: resolveAppearance(readThemeState().mode),
        colors: {
          surface: palette['bubble-bg'],
          surfaceQuiet: palette['sheet-2'],
          ink: palette['bubble-ink'],
          inkQuiet: palette['ink-soft'],
          line: palette['line-strong'],
          field: palette['sheet-2'],
          primary: palette['accent'],
          onPrimary: palette['on-accent'],
        },
      };
      if (!isPetPresentationTheme(candidate)) {
        setError('当前配色不完整，无法同步到桌宠');
        return;
      }
      void bridge.publishTheme(candidate as PetPresentationTheme).then((result) => {
        if (active) setError(result.ok ? null : '配色已保存，桌宠同步失败');
      });
    };
    publish();
    const off = subscribeTheme(publish);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', publish);
    return () => {
      active = false;
      off();
      media.removeEventListener('change', publish);
    };
  }, []);
  return error;
}
