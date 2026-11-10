import type {
  PluginManifest,
  VoiceAsrSettings,
  VoiceBegin,
  VoiceCaptureResult,
  VoiceCandidate,
  VoiceFinal,
  VoiceResultKey,
  VoiceTicket,
} from '@pet/contracts';
import type { MediaReadEndpoint } from '@pet/host-kernel';
import type { PluginContext, PluginDefinition } from '@pet/plugin-sdk';
import type { ServicePluginRegistration } from './plugin-host.js';

export interface NativeAsrInput {
  readonly modelRef: string;
  readonly format: { readonly encoding: 'f32le'; readonly sampleRate: 16000; readonly channels: 1 };
  readonly samples: number;
  readonly audio: MediaReadEndpoint;
}
export interface NativeAsrBinding {
  catalog(signal: AbortSignal): Promise<readonly VoiceCandidate[]>;
  transcribe(input: NativeAsrInput, signal: AbortSignal): Promise<VoiceFinal>;
}
export interface AuthorizedMagpieAsrTransport {
  catalog(signal: AbortSignal): Promise<unknown>;
  mimoAsr(
    input: { readonly modelRef: string; readonly wav: Uint8Array },
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}
export interface VoiceAsrPorts {
  authorizedMagpie(baseUrl: string): AuthorizedMagpieAsrTransport;
  bind(binding: NativeAsrBinding): () => Promise<void>;
}
export type VoiceAsrPortsFor = (context: PluginContext) => VoiceAsrPorts;
export interface VoiceAsrRegistration extends ServicePluginRegistration {
  readonly asr: {
    readonly providerId: string;
    readonly label: string;
    readonly synthetic: boolean;
    parseConfig(config: unknown): VoiceAsrSettings;
  };
}
export type VoiceAsrFactory = (portsFor: VoiceAsrPortsFor) => PluginDefinition;
export interface VoiceInputNative {
  begin(input: VoiceBegin): Promise<VoiceTicket>;
  result(key: VoiceResultKey): Promise<VoiceCaptureResult>;
  upload(
    key: VoiceResultKey,
    samples: number,
    pcm: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<VoiceCaptureResult>;
  cancel(key: VoiceResultKey): Promise<VoiceCaptureResult>;
}
export interface SharedVoicePorts {
  bind(feature: VoiceInputNative): () => Promise<void>;
  recognize(
    providerRef: string,
    bindingId: string,
    samples: number,
    pcm: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<VoiceFinal>;
  currentAgent(): Promise<{ id: string; acceptsInput: boolean }>;
  validateBegin(input: VoiceBegin): Promise<void>;
}
export type SharedVoicePortsFor = (context: PluginContext) => SharedVoicePorts;
export interface VoiceInputRegistration {
  readonly manifest: PluginManifest;
  readonly directory: string;
  readonly definition: PluginDefinition;
}
