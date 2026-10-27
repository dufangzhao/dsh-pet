import type { JsonObject } from './json.js';
import type { ConfigApplyMode } from './manifest.js';

export interface ConfigField {
  readonly pointer: string;
  readonly type: string;
  readonly apply: ConfigApplyMode;
}
export interface ConfigDefinition {
  readonly version: number;
  readonly schema: JsonObject;
  readonly defaults: JsonObject;
  readonly fields: readonly ConfigField[];
}
export interface ConfigSnapshot {
  readonly pluginId: string;
  readonly instanceId: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly data: JsonObject;
}
export interface ConfigInspection {
  readonly definition: ConfigDefinition;
  /** Only a genuinely absent record is null. Reading never creates defaults. */
  readonly snapshot: ConfigSnapshot | null;
}
export interface ConfigSave {
  readonly snapshot: ConfigSnapshot;
  /** Required application action; saving does not activate or reload a plugin. */
  readonly changeMode: ConfigApplyMode | null;
}
