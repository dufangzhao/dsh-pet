import type { CompanionCommandReceipt, CompanionFact } from './companion.js';
import type { KernelError } from './errors.js';
import type { CompanionAudience } from './companion-origin.js';

export const COMPANION_MEMORY_MAX_FACTS = 32;
export const COMPANION_MEMORY_MAX_KEY_UNITS = 128;
export const COMPANION_MEMORY_MAX_VALUE_UNITS = 2048;
export const COMPANION_MEMORY_MAX_DATA_BYTES = 8192;
export const COMPANION_MEMORY_MAX_ORIGIN_BYTES = 8192;
export const COMPANION_MEMORY_MAX_INPUTS = 32;

export interface CompanionApplication {
  readonly appliedRevision: number | null;
  readonly error: KernelError | null;
}
export type CompanionFactOrigin =
  | { readonly kind: 'legacy-unknown' }
  | { readonly kind: 'owner-form' }
  | {
      readonly kind: 'user-input';
      readonly inputId: string;
      readonly evidence: { readonly start: number; readonly end: number };
    };
export interface CompanionMemoryStatus {
  readonly revision: number;
  readonly application: CompanionApplication;
  readonly usage: {
    readonly count: number;
    readonly dataBytes: number;
    readonly originBytes: number;
  };
}
export interface CompanionMemoryView extends CompanionMemoryStatus {
  readonly agentId: string;
  readonly facts: readonly CompanionFact[];
}
export interface CompanionMemoryUpsertCommand {
  /** Protected owner-management scope; omission preserves the legacy intent and JSON fingerprint. */
  readonly audience?: CompanionAudience;
  readonly commandId: string;
  readonly expectedMemoryRevision: number;
  readonly expectedFactRevision: number;
  readonly key: string;
  readonly value: string;
}
export interface CompanionMemoryForgetCommand {
  readonly audience?: CompanionAudience;
  readonly commandId: string;
  readonly expectedMemoryRevision: number;
  readonly expectedFactRevision: number;
  readonly key: string;
}
export interface CompanionMemoryMutationResult {
  readonly receipt: CompanionCommandReceipt;
  /** Unknown only for a read-only duplicate of a pre-v2 fact command. */
  readonly committedRevision: number | null;
  readonly view: CompanionMemoryView;
}
