import type {
  CompanionMessage,
  SpeechAudioHeader,
  SpeechBegin,
  SpeechCandidate,
  SpeechFormat,
  SpeechRemoteBinding,
  SpeechSegmentKey,
  SpeechSegmentReceipt,
  SpeechSegmentReserve,
  SpeechStreamStart,
  SpeechTtsSettings,
  SpeechUtteranceKey,
  SpeechUtteranceReceipt,
  SpeechUtteranceStatus,
  SpeechPresetVoice,
} from '@pet/contracts';
import type { MediaReadEndpoint, MediaWriteEndpoint } from '@pet/host-kernel';
import type { PluginContext, PluginDefinition } from '@pet/plugin-sdk';
import type { ServicePluginRegistration } from './plugin-host.js';

/** Host-private authority captured once for the whole canonical reply. */
export interface SpeechProviderBinding extends SpeechRemoteBinding {
  readonly sourcePluginId: string;
  readonly instanceId: string;
  readonly providerId: string;
  readonly sourceGeneration: number;
  readonly configRevision: number;
  readonly credentialVersion: string;
  readonly policyEpoch: number;
  readonly sourceFingerprint: string;
  readonly settings: SpeechTtsSettings;
  readonly format: SpeechFormat;
}
/** Canonical UTF-16 offsets, computed by the service, never caller-supplied text. */
export interface SpeechTextSegment {
  readonly start: number;
  readonly end: number;
}
export interface NativeSpeechInput {
  readonly key: SpeechSegmentKey;
  readonly modelRef: string;
  readonly voice: SpeechPresetVoice;
  readonly text: string;
  readonly format: SpeechFormat;
  readonly audio: MediaWriteEndpoint;
  /** Verified decoded PCM progress, reported before awaiting media consumption. */
  onProduced(frames: number): void;
}
/** Decoder success is generation only; its owner still joins native/media/transport work. */
export interface NativeSpeechResult {
  readonly finishReason: 'stop';
  readonly producedFrames: number;
  readonly producedBytes: number;
}
export interface NativeSpeechBinding {
  catalog(signal: AbortSignal): Promise<readonly SpeechCandidate[]>;
  synthesize(input: NativeSpeechInput, signal: AbortSignal): Promise<NativeSpeechResult>;
}
/** The service verifies SSE Content-Type; bytes remain a single-use streaming body. */
export interface AuthorizedSpeechStream {
  readonly body: AsyncIterable<Uint8Array>;
  readonly settled: Promise<void>;
  cancel(): void;
}
export interface AuthorizedMagpieSpeechTransport {
  catalog(signal: AbortSignal): Promise<unknown>;
  mimoSpeech(
    input: {
      readonly modelRef: string;
      readonly text: string;
      readonly voice: SpeechPresetVoice;
    },
    signal: AbortSignal,
  ): Promise<AuthorizedSpeechStream>;
  close(): Promise<void>;
}
export interface SpeechTtsPorts {
  authorizedMagpie(baseUrl: string): AuthorizedMagpieSpeechTransport;
  bind(binding: NativeSpeechBinding): () => Promise<void>;
}
export type SpeechTtsPortsFor = (context: PluginContext) => SpeechTtsPorts;
export interface SpeechTtsRegistration extends ServicePluginRegistration {
  readonly tts: {
    readonly providerId: string;
    readonly label: string;
    readonly synthetic: boolean;
    parseConfig(config: unknown): SpeechTtsSettings;
  };
}
export type SpeechTtsFactory = (portsFor: SpeechTtsPortsFor) => PluginDefinition;
/** Service-owned media only; a desktop bridge creates a distinct local task/media owner. */
export interface SpeechAudioConsumer {
  readonly header: SpeechAudioHeader;
  readonly audio: MediaReadEndpoint;
  readonly settled: Promise<void>;
  cancel(): void;
}
export interface SpeechOutputNative {
  begin(input: SpeechBegin): Promise<SpeechUtteranceReceipt>;
  reserve(input: SpeechSegmentReserve): Promise<SpeechSegmentReceipt>;
  /** Atomic one-consumer claim; the unique native POST starts only after this attach. */
  attach(input: SpeechSegmentKey, signal: AbortSignal): Promise<SpeechAudioConsumer>;
  status(key: SpeechUtteranceKey): Promise<SpeechUtteranceStatus>;
  cancel(key: SpeechUtteranceKey): Promise<SpeechUtteranceStatus>;
  close(): Promise<void>;
}
export interface SpeechSynthesisOperation {
  readonly start: SpeechStreamStart;
  readonly audio: MediaReadEndpoint;
  /** Live verified PCM count, independent of HTTP/media drain and final success. */
  readonly producedFrames: number;
  readonly result: Promise<NativeSpeechResult>;
  /** Actual handler/credential/native/media settlement, independent of logical result. */
  readonly settled: Promise<void>;
  cancel(): void;
}
/** Feature authority explicitly uses companion.speech.output@1, not speech.output@1. */
export interface SharedSpeechPorts {
  bind(feature: SpeechOutputNative): () => Promise<void>;
  /** Once the whole is terminal and actual cleanup settled; not generation or playback success. */
  settled(receipt: SpeechUtteranceReceipt): void;
  canonicalMessage(input: {
    readonly id: string;
    readonly eventSequence: number;
  }): Promise<CompanionMessage & { readonly role: 'assistant' }>;
  captureBinding(input: SpeechBegin): Promise<SpeechProviderBinding>;
  synthesize(
    input: {
      readonly key: SpeechSegmentKey;
      readonly binding: SpeechProviderBinding;
      readonly text: string;
    },
    signal: AbortSignal,
  ): Promise<SpeechSynthesisOperation>;
}
export type SharedSpeechPortsFor = (context: PluginContext) => SharedSpeechPorts;
