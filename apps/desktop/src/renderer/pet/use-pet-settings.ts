import type { PetPresentationTheme, Result } from '@pet/contracts';
import { useEffect, useState, type CSSProperties } from 'react';

interface SnapshotReader<T> {
  getSnapshot(): Promise<Result<T>>;
  onChanged(listener: () => void): () => void;
}

/**
 * 桌宠窗口的明暗与配色来自设置台那一个主题所有者（window.petPresentation）。
 *
 * 语音输入不属于这个组合：它读的是本机设备与模型，共享阶段不再挂这条通道。
 * 读不到就说读不到，不拿默认配色冒充已同步。
 */
export function usePetSettings() {
  const [theme, setTheme] = useState<PetPresentationTheme | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const bridge: SnapshotReader<{ theme: PetPresentationTheme | null }> | undefined =
      typeof window === 'undefined' ? undefined : window.petPresentation;
    if (!bridge) {
      setThemeError('桌宠配色同步暂不可用');
      return;
    }
    let sequence = 0;
    const read = (): void => {
      const current = ++sequence;
      void Promise.resolve()
        .then(() => bridge.getSnapshot())
        .then((reply) => {
          if (!active || current !== sequence) return;
          if (reply.ok) {
            setTheme(reply.value.theme);
            setThemeError(null);
          } else setThemeError('读取外观设置失败。');
        })
        .catch(() => {
          if (active && current === sequence) setThemeError('读取外观设置失败。');
        });
    };
    const detach = bridge.onChanged(read);
    read();
    return () => {
      active = false;
      detach();
    };
  }, []);
  return { theme, notice: themeError };
}

export function petPresentationStyle(
  theme: PetPresentationTheme | null,
  fontSize: number,
  glow: number,
): CSSProperties {
  const style: CSSProperties & Record<`--pet-${string}`, string> = {
    '--pet-bubble-font': `${(13 * fontSize) / 100}px`,
    '--pet-glow': `${glow * 0.18}px`,
  };
  if (theme) {
    const colors = theme.colors;
    Object.assign(style, {
      colorScheme: theme.appearance,
      '--pet-surface': colors.surface,
      '--pet-surface-strong': colors.surface,
      '--pet-surface-quiet': colors.surfaceQuiet,
      '--pet-field': colors.field,
      '--pet-ink': colors.ink,
      '--pet-ink-soft': colors.inkQuiet,
      '--pet-ink-muted': colors.inkQuiet,
      '--pet-border': colors.line,
      '--pet-control-line': colors.line,
      '--pet-accent': colors.primary,
      '--pet-accent-strong': colors.primary,
      '--pet-focus': colors.primary,
      '--pet-on-primary': colors.onPrimary,
      '--pet-accent-wash': colors.surfaceQuiet,
    });
  }
  return style;
}
