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
export interface SavedModelEndpoint {
  readonly id: string;
  readonly model: string;
  readonly keyConfigured: boolean;
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
  }): Promise<Result<ModelConnectionOutcome>>;
  testConnection(): Promise<Result<ModelConnectionOutcome>>;
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
  open: 'model-connection:v1:open',
} as const;
