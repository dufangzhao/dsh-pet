import type { PetPresentationTheme, Result, VoiceInputSettings } from '@pet/contracts';
import { useEffect, useState, type CSSProperties } from 'react';

interface SnapshotReader<T> {
  getSnapshot(): Promise<Result<T>>;
  onChanged(listener: () => void): () => void;
}

export function usePetSettings() {
  const [theme, setTheme] = useState<PetPresentationTheme | null>(null);
  const [voice, setVoice] = useState<VoiceInputSettings | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const watch = <T>(
      bridge: SnapshotReader<T> | undefined,
      apply: (snapshot: T) => void,
      failure: (text: string | null) => void,
      message: string,
    ): (() => void) | undefined => {
      if (!bridge) return undefined;
      let sequence = 0;
      const read = (): void => {
        const current = ++sequence;
        void Promise.resolve()
          .then(() => bridge.getSnapshot())
          .then((reply) => {
            if (!active || current !== sequence) return;
            if (reply.ok) {
              apply(reply.value);
              failure(null);
            } else failure(message);
          })
          .catch(() => {
            if (active && current === sequence) failure(message);
          });
      };
      const detach = bridge.onChanged(read);
      read();
      return detach;
    };
    const presentation = watch(
      window.petPresentation,
      (snapshot) => setTheme(snapshot.theme),
      setThemeError,
      '读取外观设置失败。',
    );
    const input = watch(
      window.petVoiceInput,
      (snapshot) => setVoice(snapshot.settings),
      setVoiceError,
      '读取语音输入设置失败。',
    );
    return () => {
      active = false;
      presentation?.();
      input?.();
    };
  }, []);
  return { theme, voice, notice: themeError ?? voiceError };
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
