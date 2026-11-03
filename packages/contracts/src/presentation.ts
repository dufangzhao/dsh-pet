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
export type PetAppearance = 'light' | 'dark';
export interface PetAppearanceChange {
  appearance: PetAppearance;
}
export interface PetAppearanceRequest extends PetAppearanceChange {
  id: string;
}
export interface PetAppearanceCompletion {
  id: string;
  applied: boolean;
}
export interface PetPresentationTheme {
  appearance: PetAppearance;
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
  setAppearance(request: PetAppearanceChange): Promise<Result<PetPresentationSnapshot>>;
  onAppearanceRequested(listener: (request: PetAppearanceRequest) => void): () => void;
  completeAppearance(request: PetAppearanceCompletion): Promise<Result<null>>;
  onChanged(listener: () => void): () => void;
}
export const PRESENTATION_IPC = {
  snapshot: 'pet:presentation:snapshot',
  publish: 'pet:presentation:publish',
  setAppearance: 'pet:presentation:set-appearance',
  appearanceRequested: 'pet:presentation:appearance-requested',
  completeAppearance: 'pet:presentation:complete-appearance',
  changed: 'pet:presentation:changed',
} as const;
export function isPetAppearanceChange(value: unknown): value is PetAppearanceChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).join(',') === 'appearance' && isPetAppearance(row['appearance']);
}
export function isPetAppearanceRequest(value: unknown): value is PetAppearanceRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).sort().join(',') === 'appearance,id' &&
    isRequestId(row['id']) &&
    isPetAppearance(row['appearance'])
  );
}
export function isPetAppearanceCompletion(value: unknown): value is PetAppearanceCompletion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).sort().join(',') === 'applied,id' &&
    isRequestId(row['id']) &&
    typeof row['applied'] === 'boolean'
  );
}
function isPetAppearance(value: unknown): value is PetAppearance {
  return value === 'light' || value === 'dark';
}
function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
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
