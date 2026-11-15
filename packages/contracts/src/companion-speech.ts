import type { KernelError } from './errors.js';
import type { OwnerRef } from './ids.js';
import { LOCAL_ID_PATTERN, PLUGIN_ID_PATTERN } from './patterns.js';

export const SPEECH_FEATURE_PLUGIN_ID = 'pet.speech-output';
/** Remote preparation/config owner; distinct from the optional local playback source. */
export const SPEECH_SERVICE_PLUGIN_ID = 'pet.shared-speech';
export const SPEECH_CONTROL_CAPABILITY = 'companion.speech.control@1';
export const SPEECH_TTS_PLUGIN_ID = 'pet.tts-magpie';
export const SPEECH_INSTANCE_ID = 'default';
export const SPEECH_TTS_PROVIDER_ID = 'magpie';
/** Provider reference is not a source plugin/instance identity. */
export const SPEECH_TTS_PROVIDER = `${SPEECH_TTS_PLUGIN_ID}/${SPEECH_TTS_PROVIDER_ID}`;
export const SPEECH_OUTPUT_STREAM_CAPABILITY = 'companion.speech.output@1';
export const SPEECH_CREDENTIAL_ID = 'tts-api-key';
export const SPEECH_CREDENTIAL_MAX_BYTES = 4096;
export const SPEECH_PROTOCOL = 'mimo-native-pcm16-sse';
export const SPEECH_FORMAT = { codec: 'pcm-s16le', sampleRate: 24000, channels: 1 } as const;
export const SPEECH_VIEW_MAX_BYTES = 16 * 1024;
export const SPEECH_CATALOG_MAX_BYTES = 48 * 1024;
export const SPEECH_CATALOG_MAX_CANDIDATES = 64;
export const SPEECH_AUDIO_HEADER_MAX_BYTES = 4 * 1024;
export const SPEECH_AUDIO_HEADER = 'x-pet-speech-audio';
export const SPEECH_CONTROL_MAX_BYTES = 64 * 1024;
export const SPEECH_NATIVE_REQUEST_MAX_BYTES = 64 * 1024;
export const SPEECH_GATEWAY_CATALOG_MAX_BYTES = 1024 * 1024;
export const SPEECH_GATEWAY_CATALOG_MAX_ROWS = 512;
export const SPEECH_CATALOG_TIMEOUT_MS = 30_000;
export const SPEECH_SPLIT_VERSION = 2;
export const SPEECH_SEGMENT_MAX_CODE_POINTS = 4000;
export const SPEECH_SEGMENT_MIN_CODE_POINTS = 2000;
export const SPEECH_MAX_SEGMENTS = 4;
export const SPEECH_MAX_ACTIVE = 4;
export const SPEECH_MAX_RETAINED = 32;
export const SPEECH_TERMINAL_TTL_MS = 120_000;
export const SPEECH_CANCEL_FENCE_TTL_MS = 120_000;
export const SPEECH_BODY_TIMEOUT_MS = 15_000;
export const SPEECH_PLAN_TIMEOUT_MS = 60_000;
export const SPEECH_ATTACH_TIMEOUT_MS = 30_000;
export const SPEECH_FIRST_AUDIO_TIMEOUT_MS = 30_000;
/** Paused upstream reads caused by backpressure do not consume this budget. */
export const SPEECH_PRODUCER_IDLE_TIMEOUT_MS = 30_000;
export const SPEECH_CONSUMER_STALL_TIMEOUT_MS = 15_000;
export const SPEECH_SEGMENT_TIMEOUT_MS = 60 * 60 * 1000;
export const SPEECH_STATUS_TIMEOUT_MS = 20_000;
export const SPEECH_TAIL_GRACE_MS = 15_000;
/** Added to the actual segment duration when waiting for the next segment. */
export const SPEECH_NEXT_SEGMENT_GRACE_MS = 75_000;
export const SPEECH_SSE_EVENT_MAX_BYTES = 1024 * 1024;
export const SPEECH_DECODED_CHUNK_MAX_BYTES = 512 * 1024;
/** Cumulative counter cap; never an allocation or resident media budget. */
export const SPEECH_SEGMENT_MAX_BYTES = 128 * 1024 * 1024;
export const SPEECH_SEGMENT_MAX_FRAMES = SPEECH_SEGMENT_MAX_BYTES / 2;
export const SPEECH_UTTERANCE_MAX_BYTES = SPEECH_MAX_SEGMENTS * SPEECH_SEGMENT_MAX_BYTES;
export const SPEECH_PRESET_VOICES = [
  'mimo_default',
  '冰糖',
  '茉莉',
  '苏打',
  '白桦',
  'Mia',
  'Chloe',
  'Milo',
  'Dean',
] as const;
export type SpeechPresetVoice = (typeof SPEECH_PRESET_VOICES)[number];
export type SpeechFormat = typeof SPEECH_FORMAT;
export type SpeechSourceState = 'ready' | 'disabled' | 'unavailable';
export type SpeechCleanup = 'pending' | 'settled' | 'failed' | 'unknown';
export type SpeechOutcome = 'pending' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export type SpeechReason =
  | 'feature-disabled'
  | 'provider-disabled'
  | 'source-unavailable'
  | 'model-unconfigured'
  | 'key-required'
  | 'unsupported-protocol'
  | 'cleanup-pending'
  | 'invalid-stream'
  | 'partial-output'
  | 'remote-unknown'
  | 'playback-failed'
  | 'quota-exceeded';
export interface SpeechTtsSettings {
  readonly baseUrl: string;
  readonly modelRef: string;
  readonly authMode: 'local-client-id' | 'gateway-key';
  readonly protocol: typeof SPEECH_PROTOCOL;
  readonly voice: SpeechPresetVoice;
}
export interface SpeechFeatureConfig {
  readonly providerRef: string;
}
export interface SpeechProviderView {
  readonly providerRef: string;
  readonly sourcePluginId: string;
  readonly instanceId: string;
  readonly providerId: string;
  readonly label: string;
  readonly synthetic: boolean;
  readonly source: SpeechSourceState;
  readonly configRevision: number;
  readonly settings: SpeechTtsSettings;
  readonly bindingId: string | null;
  readonly credential: {
    readonly available: boolean;
    readonly writable: boolean;
    readonly version: string;
    readonly source: 'none' | 'memory' | 'environment' | 'local-client-id';
  };
  readonly readiness: 'unconfigured' | 'configured' | 'unavailable';
  readonly reason: SpeechReason | null;
}
export interface SpeechView {
  readonly version: 1;
  readonly feature: SpeechFeatureConfig & {
    readonly sourcePluginId: string;
    readonly instanceId: string;
    readonly source: SpeechSourceState;
    readonly configRevision: number;
  };
  readonly providers: readonly SpeechProviderView[];
}
export interface SpeechCandidate {
  readonly modelRef: string;
  readonly label: string;
  readonly role: 'tts';
  readonly classification: 'metadata' | 'known-name' | 'unknown';
  readonly protocol: typeof SPEECH_PROTOCOL | null;
  readonly selectable: boolean;
  readonly reason: 'unsupported-protocol' | null;
}
export interface SpeechCatalog {
  readonly providerRef: string;
  readonly bindingId: string;
  readonly candidates: readonly SpeechCandidate[];
}
export interface SpeechProviderCommand {
  readonly providerRef: string;
  readonly expectedRevision: number;
  readonly settings: SpeechTtsSettings;
}
export interface SpeechCredentialCommand {
  readonly providerRef: string;
  readonly expectedRevision: number;
  readonly expectedCredentialVersion: string;
  readonly value: string | null;
}
/** Remote provenance only. It cannot authorize Main's local task/media. */
export interface SpeechRemoteBinding {
  readonly providerRef: string;
  readonly bindingId: string;
}
export interface SpeechUtteranceKey {
  readonly utteranceId: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly serviceEpoch: string;
}
/** Service reads canonical text and checks assistant role; callers cannot supply slices. */
export interface SpeechBegin extends SpeechUtteranceKey, SpeechRemoteBinding {
  readonly messageId: string;
  readonly eventSequence: number;
  readonly expectedFeatureRevision: number;
  readonly volume: number;
}
export interface SpeechUtteranceReceipt extends SpeechUtteranceKey, SpeechRemoteBinding {
  readonly messageId: string;
  readonly eventSequence: number;
  readonly utteranceBindingId: string;
  readonly segmentCount: number;
  readonly splitVersion: typeof SPEECH_SPLIT_VERSION;
}
export interface SpeechSegmentKey extends SpeechUtteranceKey {
  readonly utteranceBindingId: string;
  readonly segmentIndex: number;
  readonly requestId: string;
}
export type SpeechSegmentReserve = SpeechSegmentKey;
export interface SpeechSegmentReceipt extends SpeechSegmentKey {
  readonly phase: 'awaiting-consumer';
}
/** Fixed metadata header, with no estimated frame count or secret/URL. */
export interface SpeechAudioHeader extends SpeechSegmentKey, SpeechRemoteBinding {
  readonly version: 1;
  readonly format: SpeechFormat;
}
export interface SpeechMediaReference {
  readonly streamId: string;
  readonly taskId: string;
  readonly owner: OwnerRef;
}
/** Unknown-length start; media and task belong to the host creating this descriptor. */
export interface SpeechStreamStart extends SpeechAudioHeader {
  readonly media: SpeechMediaReference;
}
export type SpeechFinishReason = 'stop' | 'length' | 'content_filter' | 'error' | 'missing-stop';
export interface SpeechSegmentTerminal {
  readonly outcome: Exclude<SpeechOutcome, 'pending'>;
  readonly finishReason: SpeechFinishReason | null;
  readonly producedFrames: number;
  readonly producedBytes: number;
  /** Media read through to HTTP writer, independent of finish/status/device release. */
  readonly drainedFrames: number;
  readonly drainedBytes: number;
  readonly nativeSettled: boolean;
  /** Native/media reader cleanup; HTTP finish/close and device release are separate facts. */
  readonly transportCleanup: SpeechCleanup;
  readonly error: KernelError | null;
}
/** Only this verified terminal permits Main to send a successful player end. */
export interface SpeechVerifiedTerminal extends SpeechSegmentTerminal {
  readonly outcome: 'completed';
  readonly finishReason: 'stop';
  readonly nativeSettled: true;
  readonly transportCleanup: 'settled';
  readonly error: null;
}
export interface SpeechSegmentStatus extends SpeechSegmentKey {
  readonly phase: 'awaiting-consumer' | 'streaming' | 'stopping' | 'terminal';
  readonly producedFrames: number;
  readonly drainedFrames: number;
  readonly nativeSettled: boolean;
  /** Native/media reader cleanup; HTTP finish/close and device release are separate facts. */
  readonly transportCleanup: SpeechCleanup;
  readonly terminal: SpeechSegmentTerminal | null;
}
/** Service completion describes delivery, never device playback or human hearing. */
export interface SpeechUtteranceStatus extends SpeechUtteranceKey {
  readonly receipt: SpeechUtteranceReceipt | null;
  readonly phase: 'planned' | 'streaming' | 'stopping' | 'terminal';
  readonly outcome: SpeechOutcome;
  readonly cleanup: SpeechCleanup;
  /** Zero-based high-water marks; -1 means no segment attempted/delivered. */
  readonly attemptedThrough: number;
  readonly deliveredThrough: number;
  readonly currentSegment: SpeechSegmentStatus | null;
  readonly error: KernelError | null;
  readonly reason: SpeechReason | null;
  readonly completedAt: number | null;
}
/** Known logical identity is sufficient even if begin's receipt was lost. */
export type SpeechCancel = SpeechUtteranceKey;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function id(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(LOCAL_ID_PATTERN).test(value);
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function providerRef(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 2 && new RegExp(PLUGIN_ID_PATTERN).test(parts[0] ?? '') && id(parts[1]);
}
const utteranceKeys = ['utteranceId', 'clientId', 'agentId', 'serviceEpoch'] as const;
const segmentKeys = [...utteranceKeys, 'utteranceBindingId', 'segmentIndex', 'requestId'] as const;
function utterance(value: Record<string, unknown>): boolean {
  return utteranceKeys.every((key) => id(value[key]));
}
function segment(value: Record<string, unknown>): boolean {
  return (
    utterance(value) &&
    id(value['utteranceBindingId']) &&
    id(value['requestId']) &&
    integer(value['segmentIndex'], 0, SPEECH_MAX_SEGMENTS - 1)
  );
}
export function isSpeechFormat(value: unknown): value is SpeechFormat {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['codec', 'sampleRate', 'channels']) &&
    v['codec'] === SPEECH_FORMAT.codec &&
    v['sampleRate'] === SPEECH_FORMAT.sampleRate &&
    v['channels'] === SPEECH_FORMAT.channels
  );
}
/** Shape only: the provider's single pure projector owns URL/model eligibility policy. */
export function isSpeechTtsSettings(value: unknown): value is SpeechTtsSettings {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['baseUrl', 'modelRef', 'authMode', 'protocol', 'voice']) &&
    bounded(v['baseUrl'], 2048) &&
    typeof v['modelRef'] === 'string' &&
    v['modelRef'].length <= 128 &&
    (v['authMode'] === 'local-client-id' || v['authMode'] === 'gateway-key') &&
    v['protocol'] === SPEECH_PROTOCOL &&
    SPEECH_PRESET_VOICES.some((voice) => voice === v['voice'])
  );
}
export function isSpeechProviderCommand(value: unknown): value is SpeechProviderCommand {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['providerRef', 'expectedRevision', 'settings']) &&
    providerRef(v['providerRef']) &&
    integer(v['expectedRevision'], 0) &&
    isSpeechTtsSettings(v['settings'])
  );
}
export function isSpeechCredentialCommand(value: unknown): value is SpeechCredentialCommand {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['providerRef', 'expectedRevision', 'expectedCredentialVersion', 'value']) &&
    providerRef(v['providerRef']) &&
    integer(v['expectedRevision'], 0) &&
    bounded(v['expectedCredentialVersion'], 128) &&
    (v['value'] === null ||
      (bounded(v['value'], SPEECH_CREDENTIAL_MAX_BYTES) &&
        [...v['value']].every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ) &&
        new TextEncoder().encode(v['value']).byteLength <= SPEECH_CREDENTIAL_MAX_BYTES &&
        new TextDecoder().decode(new TextEncoder().encode(v['value'])) === v['value']))
  );
}
export function isSpeechRemoteBinding(value: unknown): value is SpeechRemoteBinding {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['providerRef', 'bindingId']) &&
    providerRef(v['providerRef']) &&
    id(v['bindingId'])
  );
}
export function isSpeechUtteranceKey(value: unknown): value is SpeechUtteranceKey {
  const v = object(value);
  return !!v && exact(v, utteranceKeys) && utterance(v);
}
export function isSpeechBegin(value: unknown): value is SpeechBegin {
  const v = object(value);
  return (
    !!v &&
    exact(v, [
      ...utteranceKeys,
      'providerRef',
      'bindingId',
      'messageId',
      'eventSequence',
      'expectedFeatureRevision',
      'volume',
    ]) &&
    utterance(v) &&
    providerRef(v['providerRef']) &&
    id(v['bindingId']) &&
    typeof v['messageId'] === 'string' &&
    /^(?![\s\S]*[\r\n])[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(v['messageId']) &&
    integer(v['eventSequence'], 1) &&
    integer(v['expectedFeatureRevision'], 0) &&
    integer(v['volume'], 0, 100)
  );
}
export function isSpeechSegmentKey(value: unknown): value is SpeechSegmentKey {
  const v = object(value);
  return !!v && exact(v, segmentKeys) && segment(v);
}
export function isSpeechAudioHeader(value: unknown): value is SpeechAudioHeader {
  const v = object(value);
  return (
    !!v &&
    exact(v, [...segmentKeys, 'providerRef', 'bindingId', 'version', 'format']) &&
    segment(v) &&
    providerRef(v['providerRef']) &&
    id(v['bindingId']) &&
    v['version'] === 1 &&
    isSpeechFormat(v['format'])
  );
}
export function isSpeechVerifiedTerminal(value: unknown): value is SpeechVerifiedTerminal {
  const v = object(value);
  return (
    !!v &&
    exact(v, [
      'outcome',
      'finishReason',
      'producedFrames',
      'producedBytes',
      'drainedFrames',
      'drainedBytes',
      'nativeSettled',
      'transportCleanup',
      'error',
    ]) &&
    v['outcome'] === 'completed' &&
    v['finishReason'] === 'stop' &&
    v['nativeSettled'] === true &&
    v['transportCleanup'] === 'settled' &&
    v['error'] === null &&
    integer(v['producedFrames'], 1, SPEECH_SEGMENT_MAX_FRAMES) &&
    typeof v['producedFrames'] === 'number' &&
    v['producedBytes'] === v['producedFrames'] * 2 &&
    v['drainedFrames'] === v['producedFrames'] &&
    v['drainedBytes'] === v['producedBytes']
  );
}
