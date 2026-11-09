import type { CompanionApplication } from './companion-memory.js';

export interface CompanionProfileManagement {
  readonly application: CompanionApplication;
  readonly launchOverrides: { readonly name: boolean; readonly persona: boolean };
}
export interface CompanionProfileSaveCommand {
  readonly expectedProfileRevision: number;
  readonly name: string;
  readonly persona: string;
}
/** Canonical identity/persona projection; never the raw host Config. */
export interface CompanionProfileView {
  readonly agentId: string;
  readonly name: string;
  readonly persona: string;
  readonly revision: number;
  readonly management?: CompanionProfileManagement;
}
