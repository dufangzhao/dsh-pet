import type { KernelError, Result } from './errors.js';
import type { OwnerRef } from './ids.js';
import type { PermissionPreset } from './security.js';
import type { PluginLifecycleState } from './lifecycle.js';
export const DEMO_PLUGIN_IDS = {
  asr: 'pet.asr-local',
  voice: 'pet.voice-chat',
  demo: 'pet.chat',
  cloud: 'pet.llm-provider',
  avatar: 'pet.avatar-default',
} as const;
export const DEMO_IPC = {
  snapshot: 'demo:v1:snapshot',
  changed: 'demo:v1:changed',
  record: 'demo:v1:record',
  ready: 'demo:v1:ready',
  pcm: 'demo:v1:pcm',
  finish: 'demo:v1:finish',
  captureError: 'demo:v1:capture-error',
  cancel: 'demo:v1:cancel',
  send: 'demo:v1:send',
  clear: 'demo:v1:clear',
  key: 'demo:v1:key',
  removeKey: 'demo:v1:remove-key',
} as const;
export type DemoReplyMode = 'demo' | 'deepseek';
export type DemoPhase =
  | 'setup'
  | 'idle'
  | 'preparing'
  | 'arming'
  | 'recording'
  | 'recognizing'
  | 'thinking'
  | 'responding'
  | 'saving'
  | 'stopping'
  | 'error';
export interface DemoMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly mode: DemoReplyMode;
  readonly at: number;
}
export interface DemoPluginStatus {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string | null;
  readonly origin: 'builtin' | 'user' | null;
  readonly owner: OwnerRef | null;
  readonly digest: string | null;
  readonly state: PluginLifecycleState | 'missing';
  readonly trusted: boolean;
  readonly preset: PermissionPreset | null;
  readonly blocked: boolean;
}
export interface DemoModelStatus {
  readonly id: string;
  readonly name: string;
  readonly source: 'ModelScope';
  readonly cached: boolean;
  readonly streaming: boolean;
}
export interface DemoSettings {
  readonly asrOwner: OwnerRef | null;
  readonly asrRevision: number;
  readonly modelId: string | null;
  readonly voiceOwner: OwnerRef | null;
  readonly voiceRevision: number;
  readonly replyMode: DemoReplyMode | null;
  readonly autoSend: boolean;
  readonly readError: KernelError | null;
}
export interface DemoSnapshot {
  readonly version: 1;
  readonly phase: DemoPhase;
  readonly intentId: string | null;
  readonly settings: DemoSettings;
  readonly plugins: readonly DemoPluginStatus[];
  readonly models: readonly DemoModelStatus[];
  readonly preparedModelId: string | null;
  readonly canRecord: boolean;
  readonly canSend: boolean;
  readonly transcript: string;
  readonly partialTranscript: string;
  readonly partialReply: string;
  readonly messages: readonly DemoMessage[];
  readonly recordingStartedAt: number | null;
  readonly maxRecordingSeconds: number;
  readonly error: KernelError | null;
  readonly keyAvailable: boolean;
  readonly keyConfigured: boolean;
  readonly avatarEnabled: boolean;
}
export interface DemoCaptureTicket {
  readonly token: string;
  readonly sampleRate: 16000;
  readonly maxSamples: number;
  readonly chunkSamples: 1600;
}
export type CaptureErrorReason = 'denied' | 'missing' | 'format' | 'failed';
export interface DemoBridge {
  readonly version: 1;
  getSnapshot(): Promise<Result<DemoSnapshot>>;
  onChanged(listener: () => void): () => void;
  beginRecording(): Promise<Result<DemoCaptureTicket>>;
  captureReady(request: { token: string; sampleRate: number }): Promise<Result<null>>;
  pushAudio(
    header: { token: string; sequence: number },
    payload: Uint8Array,
  ): Promise<Result<null>>;
  finishRecording(request: { token: string; frames: number }): Promise<Result<null>>;
  reportCaptureError(request: { token: string; reason: CaptureErrorReason }): Promise<Result<null>>;
  cancel(): Promise<Result<DemoSnapshot>>;
  sendText(request: { text: string }): Promise<Result<null>>;
  clearHistory(): Promise<Result<DemoSnapshot>>;
  saveProviderKey(request: { value: string }): Promise<Result<DemoSnapshot>>;
  removeProviderKey(): Promise<Result<DemoSnapshot>>;
}
