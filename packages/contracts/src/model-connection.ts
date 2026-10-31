import type { Result } from './errors.js';
export interface ModelService {
  readonly id: string;
  readonly label: string;
  readonly region: 'global' | 'cn' | 'intl';
  readonly service: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
  readonly keyHint: string;
  readonly keyUrl: string;
  readonly auth: 'api-key' | 'browser';
  readonly available: boolean;
  readonly unavailableReason?: string;
}
export const MODEL_REASONING_EFFORTS = ['default', 'low', 'medium', 'high'] as const;
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number];
export interface ModelConnectionDraft {
  readonly id: string;
  readonly model: string;
  readonly key?: string;
  readonly reasoningEffort?: ModelReasoningEffort;
}
export interface SavedModelEndpoint {
  readonly id: string;
  readonly model: string;
  readonly keyConfigured: boolean;
  readonly reasoningEffort?: ModelReasoningEffort;
}
export interface ModelConnectionSnapshot {
  readonly notice?: string;
  readonly revision: number;
  readonly services: readonly ModelService[];
  readonly endpoints: readonly SavedModelEndpoint[];
  readonly active: { readonly id: string; readonly model: string; readonly label: string } | null;
  readonly paused: boolean;
  readonly credentialStorageAvailable: boolean;
}
export interface ModelConnectionOutcome {
  readonly snapshot: ModelConnectionSnapshot;
  readonly test: {
    readonly ok: boolean;
    readonly elapsedMs: number | null;
    readonly model?: string;
    readonly reason?: string;
  };
}
export interface ModelDraftTestOutcome {
  readonly id: string;
  readonly model: string;
  readonly test: ModelConnectionOutcome['test'];
}
export interface ModelCatalogResult {
  readonly id: string;
  readonly models: readonly string[];
}
export interface ModelSignInStatus {
  readonly phase: 'idle' | 'waiting' | 'done' | 'failed';
  readonly signedIn: boolean;
  readonly reason: string | null;
}
export interface ModelConnectionBridge {
  startSignIn(): Promise<Result<ModelSignInStatus>>;
  getSignInState(): Promise<Result<ModelSignInStatus>>;
  cancelSignIn(): Promise<Result<ModelSignInStatus>>;
  getSnapshot(): Promise<Result<ModelConnectionSnapshot>>;
  setPaused(request: { readonly paused: boolean }): Promise<Result<ModelConnectionSnapshot>>;
  saveAndStart(request: {
    readonly id: string;
    readonly model: string;
    readonly expectedRevision: number;
    readonly key?: string;
    readonly reasoningEffort?: ModelReasoningEffort;
  }): Promise<Result<ModelConnectionOutcome>>;
  testConnection(): Promise<Result<ModelConnectionOutcome>>;
  testSelected(request: ModelConnectionDraft): Promise<Result<ModelDraftTestOutcome>>;
  getModels(request: {
    readonly id: string;
    readonly key?: string;
  }): Promise<Result<ModelCatalogResult>>;
  openServicePage(request: { readonly id: string }): Promise<Result<null>>;
}
export const MODEL_CONNECTION_IPC = {
  snapshot: 'model-connection:v1:snapshot',
  signIn: 'model-connection:v1:sign-in',
  signInState: 'model-connection:v1:sign-in-state',
  signInCancel: 'model-connection:v1:sign-in-cancel',
  run: 'model-connection:v1:run',
  save: 'model-connection:v1:save',
  test: 'model-connection:v1:test',
  models: 'model-connection:v1:models',
  testSelected: 'model-connection:v1:test-selected',
  open: 'model-connection:v1:open',
} as const;
