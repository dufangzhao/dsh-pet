/** Browser-safe model connection state. Credentials are request-only, never part of views. */
import type { CompanionCommandReceipt } from './companion.js';
import type { KernelError } from './errors.js';
import type { JsonObject } from './json.js';

export interface ResponsesConnectionSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly authMode: 'local-client-id' | 'gateway-key';
}
export interface CompanionModelCredentialView {
  readonly required: boolean;
  readonly available: boolean;
  readonly source: 'none' | 'local-client-id' | 'not-required' | 'environment' | 'memory';
  readonly version: string;
  readonly writable: boolean;
}
export interface CompanionModelConnectorView {
  readonly id: string;
  readonly label: string;
  readonly synthetic: boolean;
  readonly configRevision: number;
  readonly settings: ResponsesConnectionSettings | null;
  readonly model: string | null;
  readonly credential: CompanionModelCredentialView;
}
export interface CompanionModelBindingView {
  readonly connectorId: string;
  readonly configRevision: number;
  readonly credentialVersion: string;
}
export interface CompanionModelCheckView {
  readonly state: 'unconfigured' | 'configured' | 'validating' | 'verified' | 'failed';
  readonly commandId: string | null;
  readonly binding: CompanionModelBindingView | null;
  readonly startedAt: number | null;
  readonly checkedAt: number | null;
  readonly elapsedMs: number | null;
  readonly evidence: 'network' | 'synthetic' | null;
  readonly error: KernelError | null;
}
export interface CompanionModelView {
  readonly profileRevision: number;
  readonly desired: { readonly mode: 'scripted' | 'model'; readonly connectorId: string };
  readonly applied: CompanionModelBindingView | null;
  readonly enabled: boolean;
  readonly connectors: readonly CompanionModelConnectorView[];
  readonly check: CompanionModelCheckView;
  readonly error: KernelError | null;
}
export interface CompanionModelSaveCommand {
  readonly commandId: string;
  readonly expectedProfileRevision: number;
  readonly connectorId: string;
  readonly expectedConfigRevision: number;
  readonly mode: 'scripted' | 'model';
  readonly config?: JsonObject;
}
export interface CompanionModelCredentialCommand {
  readonly connectorId: string;
  readonly expectedConfigRevision: number;
  readonly expectedCredentialVersion: string;
  readonly apiKey: string | null;
}
export interface CompanionModelTestCommand {
  readonly commandId: string;
  readonly connectorId: string;
  readonly expectedConfigRevision: number;
  readonly expectedCredentialVersion: string;
}
export interface CompanionModelCommandResult {
  readonly receipt: CompanionCommandReceipt;
  readonly view: CompanionModelView;
}
