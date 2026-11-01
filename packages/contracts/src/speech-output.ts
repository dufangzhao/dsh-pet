import type { JsonObject, JsonSchema } from './json.js';
import type { OwnerRef } from './ids.js';
import type { KernelError, Result } from './errors.js';
import { MEDIA_MAX_STREAM_BYTES } from './media.js';
import { LOCAL_ID_SCHEMA, OWNER_REF_SCHEMA } from './shared-schemas.js';
import { PLUGIN_ID_PATTERN, LOCAL_ID_PATTERN, BCP47_LANGUAGE_PATTERN } from './patterns.js';

export const SPEECH_OUTPUT_CAPABILITY = 'speech.output@1';
export const SPEECH_OUTPUT_PLUGIN_IDS = {
  tones: 'pet.builtin-speech',
  system: 'pet.system-tts',
} as const;
export const SPEECH_OUTPUT_MAX_TEXT = 4000;
export const SPEECH_OUTPUT_MAX_QUEUE = 4;
export const SPEECH_OUTPUT_SAMPLE_RATE = 24000;
export const SPEECH_OUTPUT_MAX_BYTES = MEDIA_MAX_STREAM_BYTES;
export const SPEECH_OUTPUT_IPC = {
  snapshot: 'pet:speech-output:snapshot',
  speak: 'pet:speech-output:speak',
  stop: 'pet:speech-output:stop',
  saveSettings: 'pet:speech-output:save-settings',
  playback: 'pet:speech-output:playback',
  changed: 'pet:speech-output:changed',
  audio: 'pet:speech-output:audio',
} as const;

/** Stable persisted selection. Runtime authority additionally binds the generation. */
export interface SpeechOutputProviderSelection extends JsonObject {
  pluginId: string;
  instanceId: string;
  providerId: string;
}
export interface SpeechOutputSettings {
  enabled: boolean;
  provider: SpeechOutputProviderSelection | null;
  language: string;
  voice: string | null;
  rate: number;
  volume: number;
}
export interface SpeechOutputSaveSettings {
  expectedRevision: number;
  enabled: boolean;
  provider: SpeechOutputProviderSelection | null;
  voice: string | null;
  rate: number;
  volume: number;
}
export interface SpeechOutputRequest {
  utteranceId: string;
  text: string;
  language: string;
  voice: string | null;
  rate: number;
}
export interface SpeechOutputMediaReference {
  streamId: string;
  taskId: string;
  owner: OwnerRef;
}
/** Raw interleaved signed 16-bit little-endian PCM; bytes travel over media only. */
export interface SpeechOutputAudioDescriptor {
  utteranceId: string;
  codec: 'pcm-s16le';
  sampleRate: number;
  channels: 1 | 2;
  frames: number;
  media: SpeechOutputMediaReference;
}
export type SpeechOutputFailureReason =
  | 'unsupported-platform'
  | 'voice-unavailable'
  | 'synthesis-failed'
  | 'audio-budget'
  | 'invalid-audio'
  | 'playback-failed';
export interface SpeechOutputProviderInfo {
  selection: SpeechOutputProviderSelection;
  owner: OwnerRef;
  name: string;
  kind: 'tones' | 'voice';
  active: boolean;
}
export interface SpeechOutputSnapshot {
  version: 1;
  owner: OwnerRef | null;
  revision: number;
  settings: SpeechOutputSettings;
  providers: readonly SpeechOutputProviderInfo[];
  phase: 'idle' | 'synthesizing' | 'playing' | 'error';
  queued: number;
  current: { utteranceId: string; text: string; taskId: string | null } | null;
  /** Text survives stop/disable/failure; the canonical conversation remains the history owner. */
  lastUtterance: { utteranceId: string; text: string } | null;
  error: KernelError | null;
  reason: SpeechOutputFailureReason | null;
}
interface SpeechOutputAudioIdentity {
  playbackId: string;
  utteranceId: string;
  taskId: string;
  owner: OwnerRef;
  provider: OwnerRef;
  sequence: number;
}
/** Host-bound events. Chunk bytes are the separate owned Uint8Array callback argument. */
export type SpeechOutputAudioEvent = SpeechOutputAudioIdentity &
  (
    | { kind: 'start'; descriptor: SpeechOutputAudioDescriptor; volume: number }
    | { kind: 'chunk'; byteLength: number }
    | { kind: 'end' }
    | { kind: 'stop' }
  );
export interface SpeechOutputPlaybackReceipt {
  playbackId: string;
  status: 'started' | 'ended' | 'failed';
}
export interface SpeechOutputBridge {
  readonly version: 1;
  getSnapshot(): Promise<Result<SpeechOutputSnapshot>>;
  speak(request: { text: string; utteranceId: string }): Promise<Result<null>>;
  stop(): Promise<Result<SpeechOutputSnapshot>>;
  saveSettings(request: SpeechOutputSaveSettings): Promise<Result<SpeechOutputSnapshot>>;
  reportPlayback(receipt: SpeechOutputPlaybackReceipt): Promise<Result<null>>;
  onChanged(listener: () => void): () => void;
  onAudio(listener: (event: SpeechOutputAudioEvent, payload?: Uint8Array) => void): () => void;
}

export const SPEECH_OUTPUT_REQUEST_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['utteranceId', 'text', 'language', 'voice', 'rate'],
  properties: {
    utteranceId: { type: 'string', minLength: 1, maxLength: 128 },
    text: { type: 'string', minLength: 1, maxLength: SPEECH_OUTPUT_MAX_TEXT },
    language: { type: 'string', minLength: 1, maxLength: 35, pattern: BCP47_LANGUAGE_PATTERN },
    voice: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 256 }] },
    rate: { type: 'integer', minimum: -10, maximum: 10 },
  },
};
export const SPEECH_OUTPUT_AUDIO_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['utteranceId', 'codec', 'sampleRate', 'channels', 'frames', 'media'],
  properties: {
    utteranceId: { type: 'string', minLength: 1, maxLength: 128 },
    codec: { const: 'pcm-s16le' },
    sampleRate: { type: 'integer', minimum: 8000, maximum: 96000 },
    channels: { enum: [1, 2] },
    frames: { type: 'integer', minimum: 1, maximum: SPEECH_OUTPUT_MAX_BYTES / 2 },
    media: {
      type: 'object',
      additionalProperties: false,
      required: ['streamId', 'taskId', 'owner'],
      properties: { streamId: LOCAL_ID_SCHEMA, taskId: LOCAL_ID_SCHEMA, owner: OWNER_REF_SCHEMA },
    },
  },
};

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const identifier = (v: unknown): v is string =>
  typeof v === 'string' && new RegExp(LOCAL_ID_PATTERN).test(v);
const pluginIdentifier = (v: unknown): v is string =>
  typeof v === 'string' && new RegExp(PLUGIN_ID_PATTERN).test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  [...v].length <= max &&
  [...v].every((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point >= 32 || point === 9 || point === 10 || point === 13;
  });
export function isSpeechOutputSelection(value: unknown): value is SpeechOutputProviderSelection {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['pluginId', 'instanceId', 'providerId']) &&
    pluginIdentifier(v['pluginId']) &&
    identifier(v['instanceId']) &&
    identifier(v['providerId'])
  );
}
export function isSpeechOutputRequest(value: unknown): value is SpeechOutputRequest {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['utteranceId', 'text', 'language', 'voice', 'rate']) &&
    text(v['utteranceId'], 128) &&
    text(v['text'], SPEECH_OUTPUT_MAX_TEXT) &&
    typeof v['language'] === 'string' &&
    new RegExp(BCP47_LANGUAGE_PATTERN).test(v['language']) &&
    (v['voice'] === null || text(v['voice'], 256)) &&
    Number.isInteger(v['rate']) &&
    (v['rate'] as number) >= -10 &&
    (v['rate'] as number) <= 10
  );
}
export function isSpeechOutputSaveSettings(value: unknown): value is SpeechOutputSaveSettings {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['expectedRevision', 'enabled', 'provider', 'voice', 'rate', 'volume']) &&
    Number.isSafeInteger(v['expectedRevision']) &&
    (v['expectedRevision'] as number) >= 0 &&
    typeof v['enabled'] === 'boolean' &&
    (v['provider'] === null || isSpeechOutputSelection(v['provider'])) &&
    (v['voice'] === null || text(v['voice'], 256)) &&
    Number.isInteger(v['rate']) &&
    (v['rate'] as number) >= -10 &&
    (v['rate'] as number) <= 10 &&
    Number.isInteger(v['volume']) &&
    (v['volume'] as number) >= 0 &&
    (v['volume'] as number) <= 100
  );
}
export function isSpeechOutputAudioDescriptor(
  value: unknown,
): value is SpeechOutputAudioDescriptor {
  const v = object(value),
    m = v && object(v['media']),
    o = m && object(m['owner']);
  return (
    !!v &&
    exact(v, ['utteranceId', 'codec', 'sampleRate', 'channels', 'frames', 'media']) &&
    text(v['utteranceId'], 128) &&
    v['codec'] === 'pcm-s16le' &&
    Number.isInteger(v['sampleRate']) &&
    (v['sampleRate'] as number) >= 8000 &&
    (v['sampleRate'] as number) <= 96000 &&
    (v['channels'] === 1 || v['channels'] === 2) &&
    Number.isSafeInteger(v['frames']) &&
    (v['frames'] as number) > 0 &&
    (v['frames'] as number) * (v['channels'] as number) * 2 <= SPEECH_OUTPUT_MAX_BYTES &&
    !!m &&
    exact(m, ['streamId', 'taskId', 'owner']) &&
    identifier(m['streamId']) &&
    identifier(m['taskId']) &&
    !!o &&
    exact(o, ['pluginId', 'instanceId', 'generation']) &&
    pluginIdentifier(o['pluginId']) &&
    identifier(o['instanceId']) &&
    Number.isSafeInteger(o['generation']) &&
    (o['generation'] as number) >= 1
  );
}
