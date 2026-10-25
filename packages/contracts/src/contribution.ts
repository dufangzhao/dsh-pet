/**
 * Controlled UI contributions. Plugins can only reference a command they also
 * declared; there is no arbitrary script or DOM entry point.
 */

import type { LocalId } from './ids.js';
import type { JsonSchema } from './json.js';
import type { LocalizedText, RelativePath } from './manifest.js';
import { LOCAL_ID_PATTERN, RELATIVE_PATH_PATTERN } from './patterns.js';

export const CONTRIBUTION_KINDS = [
  'command',
  'shortcut-button',
  'hotkey',
  'settings',
  'panel',
] as const;

export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export const CONTRIBUTION_MAX_TITLE_LOCALES = 8;
export const CONTRIBUTION_MAX_HOTKEY_LENGTH = 64;

export interface ContributionBase {
  id: LocalId;
  kind: ContributionKind;
  title: LocalizedText;
}

export interface CommandContribution extends ContributionBase {
  kind: 'command';
  handler: LocalId;
}

export interface ShortcutButtonContribution extends ContributionBase {
  kind: 'shortcut-button';
  command: LocalId;
}

export interface HotkeyContribution extends ContributionBase {
  kind: 'hotkey';
  command: LocalId;
  defaultKey?: string;
}

export interface SettingsContribution extends ContributionBase {
  kind: 'settings';
  section: LocalId;
}

export interface PanelContribution extends ContributionBase {
  kind: 'panel';
  entry: RelativePath;
}

export type ContributionDeclaration =
  | CommandContribution
  | ShortcutButtonContribution
  | HotkeyContribution
  | SettingsContribution
  | PanelContribution;

const localizedTitleSchema: JsonSchema = {
  type: 'object',
  minProperties: 1,
  maxProperties: CONTRIBUTION_MAX_TITLE_LOCALES,
  additionalProperties: false,
  propertyNames: { type: 'string', pattern: '^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$' },
  patternProperties: {
    '^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$': { type: 'string', minLength: 1, maxLength: 128 },
  },
};

const localIdSchema: JsonSchema = { type: 'string', pattern: LOCAL_ID_PATTERN };

/**
 * Each variant requires its own discriminator plus its required fields; optional
 * fields (`hotkey.defaultKey`) stay optional but must still be declared.
 */
const variant = (
  kind: ContributionKind,
  properties: Record<string, JsonSchema>,
  required: readonly string[] = Object.keys(properties),
): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'title', ...required],
  properties: {
    id: localIdSchema,
    kind: { const: kind },
    title: localizedTitleSchema,
    ...properties,
  },
});

export const CONTRIBUTION_DECLARATION_SCHEMA: JsonSchema = {
  oneOf: [
    variant('command', { handler: localIdSchema }),
    variant('shortcut-button', { command: localIdSchema }),
    variant(
      'hotkey',
      {
        command: localIdSchema,
        defaultKey: { type: 'string', minLength: 1, maxLength: CONTRIBUTION_MAX_HOTKEY_LENGTH },
      },
      ['command'],
    ),
    variant('settings', { section: localIdSchema }),
    variant('panel', {
      entry: { type: 'string', minLength: 1, maxLength: 240, pattern: RELATIVE_PATH_PATTERN },
    }),
  ],
};
