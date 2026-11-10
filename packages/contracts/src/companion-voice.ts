import type { AudioCaptureTicket } from './audio-capture.js';
import type { KernelError } from './errors.js';

export const VOICE_FEATURE_PLUGIN_ID = 'pet.shared-voice';
export const VOICE_ASR_PLUGIN_ID = 'pet.asr-magpie';
export const VOICE_CAPTURE_PLUGIN_ID = 'pet.audio-capture';
export const VOICE_ASR_PROVIDER = `${VOICE_ASR_PLUGIN_ID}/magpie`;
export const VOICE_INPUT_CAPABILITY = 'companion.voice.input@1';
export const VOICE_ASR_CAPABILITY = 'companion.voice.asr@1';
export const VOICE_CAPTURE_CAPABILITY = 'input.audio.capture@1';
export const VOICE_VIEW_MAX_BYTES = 16 * 1024;
export const VOICE_CATALOG_MAX_BYTES = 48 * 1024;
export const VOICE_RESULT_MAX_BYTES = 64 * 1024;
export const VOICE_CATALOG_MAX_CANDIDATES = 64;
export const VOICE_UPLOAD_TIMEOUT_MS = 60_000;
export const VOICE_OPERATION_TIMEOUT_MS = 55_000;
export const VOICE_ASR_TIMEOUT_MS = 40_000;
export const VOICE_UPLOAD_BODY_TIMEOUT_MS = 15_000;
export const VOICE_CATALOG_TIMEOUT_MS = 30_000;
export const VOICE_TICKET_TTL_MS = 120_000;
export const VOICE_RESULT_TTL_MS = 120_000;
export const VOICE_MAX_ACTIVE = 4;
export const VOICE_MAX_RETAINED = 32;
export const VOICE_MIMO_MAX_REQUEST_BYTES = 1024 * 1024;
export const VOICE_GATEWAY_CATALOG_MAX_BYTES = 1024 * 1024;
export const VOICE_GATEWAY_CATALOG_MAX_ROWS = 512;

export type VoiceFinishMode = 'send' | 'review';
export type VoiceFinal =
  { readonly kind: 'final'; readonly text: string } | { readonly kind: 'no-speech' };
export type VoiceSourceState = 'ready' | 'disabled' | 'unavailable';
export type VoiceReadiness = 'unconfigured' | 'configured' | 'unavailable';
export type VoiceReason =
  | 'feature-disabled'
  | 'provider-disabled'
  | 'source-unavailable'
  | 'model-unconfigured'
  | 'key-required'
  | 'unsupported-protocol'
  | 'cleanup-pending';
export interface VoiceFeatureConfig {
  readonly providerRef: string;
  readonly finishMode: VoiceFinishMode;
}
export interface VoiceAsrSettings {
  readonly baseUrl: string;
  readonly modelRef: string;
  readonly authMode: 'local-client-id' | 'gateway-key';
  readonly protocol: 'mimo-native';
}
export interface VoiceProviderView {
  readonly providerRef: string;
  readonly label: string;
  readonly synthetic: boolean;
  readonly source: VoiceSourceState;
  readonly configRevision: number;
  readonly settings: VoiceAsrSettings;
  readonly bindingId: string | null;
  readonly credential: {
    readonly available: boolean;
    readonly writable: boolean;
    readonly version: string;
    readonly source: 'none' | 'memory' | 'environment' | 'local-client-id';
  };
  readonly readiness: VoiceReadiness;
  readonly reason: VoiceReason | null;
}
export interface VoiceView {
  readonly version: 1;
  readonly feature: VoiceFeatureConfig & {
    readonly source: VoiceSourceState;
    readonly configRevision: number;
  };
  readonly providers: readonly VoiceProviderView[];
}
export interface VoiceCandidate {
  readonly modelRef: string;
  readonly label: string;
  readonly role: 'asr';
  readonly classification: 'metadata' | 'known-name';
  readonly protocol: 'mimo-native' | null;
  readonly selectable: boolean;
  readonly reason: 'unsupported-protocol' | null;
}
export interface VoiceCatalog {
  readonly providerRef: string;
  readonly bindingId: string;
  readonly candidates: readonly VoiceCandidate[];
}
export interface VoiceSettingsCommand extends VoiceFeatureConfig {
  readonly expectedRevision: number;
}
export interface VoiceProviderCommand {
  readonly providerRef: string;
  readonly expectedRevision: number;
  readonly settings: VoiceAsrSettings;
}
export interface VoiceCredentialCommand {
  readonly providerRef: string;
  readonly expectedRevision: number;
  readonly expectedCredentialVersion: string;
  readonly value: string | null;
}
export interface VoiceBegin {
  readonly captureId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly expectedFeatureRevision: number;
  readonly providerRef: string;
  readonly bindingId: string;
  readonly finishMode: VoiceFinishMode;
}
export type VoiceBeginSelection = Omit<VoiceBegin, 'clientId' | 'agentId'>;

export interface VoiceTicket extends AudioCaptureTicket {
  readonly version: 1;
  readonly captureId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly serviceEpoch: string;
  readonly bindingId: string;
  readonly finishMode: VoiceFinishMode;
  readonly expiresAt: number;
}
export interface VoiceResultKey {
  readonly captureId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly serviceEpoch: string;
}
export interface VoiceSubmitTarget {
  readonly clientId: string;
  readonly agentId: string;
}
export type VoiceCapturePhase =
  'awaiting-audio' | 'transcribing' | 'retiring' | 'final' | 'empty' | 'cancelled' | 'failed';
export interface VoiceCaptureResult {
  readonly ticket: VoiceTicket;
  readonly phase: VoiceCapturePhase;
  readonly samples: number;
  readonly cleanup: 'pending' | 'settled';
  readonly outcome: VoiceFinal | null;
  readonly error: KernelError | null;
  readonly completedAt: number | null;
}
