import { useEffect, useState } from 'react';
import { isPetPresentationTheme, type PetAppearanceRequest } from '@pet/contracts';
import {
  committedPalette,
  readThemeState,
  resolveAppearance,
  subscribeTheme,
  writeThemeState,
} from './theme.js';
/** Projects the existing theme owner into the pet window; no second persistent copy. */
export function usePresentationTheme(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let applying = false;
    let publication = 0;
    const bridge = window.petPresentation;
    if (!bridge) {
      setError('桌宠配色同步暂不可用');
      return;
    }
    const publish = async (): Promise<boolean> => {
      const sequence = ++publication;
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
        if (active && sequence === publication) setError('当前配色不完整，无法同步到桌宠');
        return false;
      }
      const result = await bridge.publishTheme(candidate);
      const applied = result.ok && result.value.theme?.appearance === candidate.appearance;
      if (active && sequence === publication) setError(applied ? null : '配色已保存，桌宠同步失败');
      return applied;
    };
    const applyAppearance = async (request: PetAppearanceRequest): Promise<void> => {
      ++publication;
      applying = true;
      const saved = writeThemeState({ ...readThemeState(), mode: request.appearance });
      applying = false;
      let applied = false;
      if (saved.ok) applied = await publish();
      else if (active) setError('配色未能保存到本机');
      if (!active) return;
      const completed = await bridge.completeAppearance({ id: request.id, applied });
      if (active && !completed.ok) setError('桌宠配色切换未完成');
    };
    const offRequest = bridge.onAppearanceRequested((request) => {
      void applyAppearance(request);
    });
    const off = subscribeTheme(() => {
      if (!applying) void publish();
    });
    void publish();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemAppearance = () => void publish();
    media.addEventListener('change', onSystemAppearance);
    return () => {
      active = false;
      offRequest();
      off();
      media.removeEventListener('change', onSystemAppearance);
    };
  }, []);
  return error;
}
