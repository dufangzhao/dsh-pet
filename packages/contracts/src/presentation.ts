import type { Result } from './errors.js';
export interface PetPresentationColors {
  surface: string;
  surfaceQuiet: string;
  ink: string;
  inkQuiet: string;
  line: string;
  field: string;
  primary: string;
  onPrimary: string;
}
export interface PetPresentationTheme {
  appearance: 'light' | 'dark';
  colors: PetPresentationColors;
}
export interface PetPresentationSnapshot {
  version: 1;
  theme: PetPresentationTheme | null;
}
export interface PetPresentationBridge {
  readonly version: 1;
  getSnapshot(): Promise<Result<PetPresentationSnapshot>>;
  publishTheme(theme: PetPresentationTheme): Promise<Result<PetPresentationSnapshot>>;
  onChanged(listener: () => void): () => void;
}
export const PRESENTATION_IPC = {
  snapshot: 'pet:presentation:snapshot',
  publish: 'pet:presentation:publish',
  changed: 'pet:presentation:changed',
} as const;
export function isPetPresentationTheme(value: unknown): value is PetPresentationTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const theme = value as Record<string, unknown>;
  if (
    Object.keys(theme).sort().join(',') !== 'appearance,colors' ||
    !['light', 'dark'].includes(theme['appearance'] as string)
  )
    return false;
  const colors = theme['colors'];
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return false;
  const row = colors as Record<string, unknown>;
  const keys = [
    'surface',
    'surfaceQuiet',
    'ink',
    'inkQuiet',
    'line',
    'field',
    'primary',
    'onPrimary',
  ];
  return (
    Object.keys(row).length === keys.length &&
    keys.every((key) => typeof row[key] === 'string' && /^#[0-9a-f]{6}$/i.test(row[key] as string))
  );
}
