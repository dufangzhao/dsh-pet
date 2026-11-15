import type { DesktopCompanionTarget } from './desktop-companion.js';
import type { KernelError, Result } from './errors.js';
import type { OwnerRef } from './ids.js';
import type {
  SpeechAudioHeader,
  SpeechCatalog,
  SpeechCleanup,
  SpeechFormat,
  SpeechOutcome,
  SpeechProviderCommand,
  SpeechReason,
  SpeechRemoteBinding,
  SpeechSegmentKey,
  SpeechVerifiedTerminal,
  SpeechView,
} from './companion-speech.js';
import {
  isSpeechAudioHeader,
  isSpeechRemoteBinding,
  isSpeechSegmentKey,
  isSpeechFormat,
  isSpeechVerifiedTerminal,
  SPEECH_SEGMENT_MAX_FRAMES,
} from './companion-speech.js';
import { LOCAL_ID_PATTERN, PLUGIN_ID_PATTERN } from './patterns.js';

export const DESKTOP_SPEECH_MAX_STATE_BYTES = 24 * 1024;
export const DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES = 64 * 1024;
export const DESKTOP_SPEECH_IPC_MAX_IN_FLIGHT = 1;
export const DESKTOP_SPEECH_BLOCK_FRAMES = 2400;
export const DESKTOP_SPEECH_MAX_BLOCKS = 6;
export const DESKTOP_SPEECH_MAX_QUEUE = 4;
/** Source/task/media here are local Main authority; the remote binding is provenance. */
export interface DesktopSpeechPlaybackIdentity extends DesktopCompanionTarget, SpeechSegmentKey {
  readonly playbackId: string;
  readonly localOwner: OwnerRef;
  readonly localTaskId: string;
  readonly localStreamId: string;
  readonly remoteBinding: SpeechRemoteBinding;
}
export interface DesktopSpeechState {
  readonly version: 1;
  readonly revision: number;
  readonly connectionId: string | null;
  /** Selected remote binding of Main's active baseline; not a control authority or device receipt. */
  readonly appliedBinding: SpeechRemoteBinding | null;
  readonly source: 'ready' | 'disabled' | 'unavailable';
  readonly phase: 'idle' | 'baselining' | 'preparing' | 'streaming' | 'stopping' | 'terminal';
  readonly generating: boolean;
  readonly playing: boolean;
  readonly queued: number;
  readonly current: DesktopSpeechPlaybackIdentity | null;
  readonly messageId: string | null;
  readonly segmentCount: number;
  readonly completedSegments: number;
  readonly receivedFrames: number;
  /** Ended AudioBuffer blocks; no word-level or human-hearing claim. */
  readonly endedFrames: number;
  readonly outcome: SpeechOutcome;
  readonly localCleanup: SpeechCleanup;
  readonly remoteCleanup: SpeechCleanup;
  readonly error: KernelError | null;
  readonly reason: SpeechReason | null;
}
/** One ordered sequence per playback; PCM is the separate owned callback argument. */
export type DesktopSpeechAudioEvent = DesktopSpeechPlaybackIdentity & {
  readonly sequence: number;
} & (
    | { readonly kind: 'start'; readonly format: SpeechFormat; readonly volume: number }
    | { readonly kind: 'chunk'; readonly byteLength: number }
    | { readonly kind: 'end'; readonly terminal: SpeechVerifiedTerminal }
    | { readonly kind: 'stop' }
  );
/** A running resumed context is ready; it has not yet played any frames. */
export interface DesktopSpeechReady extends DesktopSpeechPlaybackIdentity {
  readonly sequence: number;
  /** Prepared PCM format; the actual AudioContext/device output rate may differ. */
  readonly format: SpeechFormat;
}
/** ACK only after this chunk's frames enter the bounded node window or have ended.
 * Schedule a <2400-frame tail immediately, even one frame; never wait for the next chunk/end.
 */
export interface DesktopSpeechConsume extends DesktopSpeechPlaybackIdentity {
  readonly sequence: number;
  readonly byteLength: number;
}
export interface DesktopSpeechPlayback extends DesktopSpeechPlaybackIdentity {
  readonly sequence: number;
  readonly status: 'started' | 'progress' | 'ended' | 'failed';
  readonly endedFrames: number;
}
/** Exact old frame may acknowledge cleanup, without regaining stream/network authority. */
export interface DesktopSpeechReleased extends DesktopSpeechPlaybackIdentity {
  readonly sequence: number;
  readonly cleanup: 'settled' | 'failed';
}
export interface DesktopSpeechBridge {
  readonly version: 1;
  getState(): Promise<Result<DesktopSpeechState>>;
  onChanged(listener: () => void): () => void;
  readSpeech(input: DesktopCompanionTarget): Promise<Result<SpeechView>>;
  saveTtsProvider(
    input: DesktopCompanionTarget & { readonly command: SpeechProviderCommand },
  ): Promise<Result<SpeechView>>;
  readTtsCatalog(
    input: DesktopCompanionTarget & SpeechRemoteBinding,
  ): Promise<Result<SpeechCatalog>>;
  stop(input: DesktopCompanionTarget): Promise<Result<DesktopSpeechState>>;
  playerReady(input: DesktopSpeechReady): Promise<Result<null>>;
  consume(input: DesktopSpeechConsume): Promise<Result<null>>;
  reportPlayback(input: DesktopSpeechPlayback): Promise<Result<null>>;
  reportReleased(input: DesktopSpeechReleased): Promise<Result<null>>;
  onAudio(listener: (event: DesktopSpeechAudioEvent, payload?: Uint8Array) => void): () => void;
}
export const DESKTOP_SPEECH_IPC = {
  getState: 'speech:desktop:v1:getState',
  changed: 'speech:desktop:v1:changed',
  readSpeech: 'speech:desktop:v1:readSpeech',
  saveTtsProvider: 'speech:desktop:v1:saveTtsProvider',
  readTtsCatalog: 'speech:desktop:v1:readTtsCatalog',
  stop: 'speech:desktop:v1:stop',
  playerReady: 'speech:desktop:v1:playerReady',
  consume: 'speech:desktop:v1:consume',
  reportPlayback: 'speech:desktop:v1:reportPlayback',
  reportReleased: 'speech:desktop:v1:reportReleased',
  audio: 'speech:desktop:v1:audio',
} as const;

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
function id(value: unknown): boolean {
  return typeof value === 'string' && new RegExp(LOCAL_ID_PATTERN).test(value);
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function owner(value: unknown): boolean {
  const v = object(value);
  return (
    !!v &&
    exact(v, ['pluginId', 'instanceId', 'generation']) &&
    typeof v['pluginId'] === 'string' &&
    new RegExp(PLUGIN_ID_PATTERN).test(v['pluginId']) &&
    id(v['instanceId']) &&
    integer(v['generation']) &&
    v['generation'] !== 0
  );
}
const identityKeys = [
  'connectionId',
  'utteranceId',
  'clientId',
  'agentId',
  'serviceEpoch',
  'utteranceBindingId',
  'segmentIndex',
  'requestId',
  'playbackId',
  'localOwner',
  'localTaskId',
  'localStreamId',
  'remoteBinding',
] as const;
function identity(v: Record<string, unknown>): boolean {
  return (
    id(v['connectionId']) &&
    id(v['playbackId']) &&
    id(v['localTaskId']) &&
    id(v['localStreamId']) &&
    owner(v['localOwner']) &&
    isSpeechRemoteBinding(v['remoteBinding']) &&
    isSpeechSegmentKey({
      utteranceId: v['utteranceId'],
      clientId: v['clientId'],
      agentId: v['agentId'],
      serviceEpoch: v['serviceEpoch'],
      utteranceBindingId: v['utteranceBindingId'],
      segmentIndex: v['segmentIndex'],
      requestId: v['requestId'],
    })
  );
}
export function isDesktopSpeechPlaybackIdentity(
  value: unknown,
): value is DesktopSpeechPlaybackIdentity {
  const v = object(value);
  return !!v && exact(v, identityKeys) && identity(v);
}
export function isDesktopSpeechAudioEvent(value: unknown): value is DesktopSpeechAudioEvent {
  const v = object(value);
  if (!v || !identity(v) || !integer(v['sequence'])) return false;
  const keys = [...identityKeys, 'sequence', 'kind'];
  switch (v['kind']) {
    case 'start':
      return (
        exact(v, [...keys, 'format', 'volume']) &&
        isSpeechFormat(v['format']) &&
        integer(v['volume'], 100)
      );
    case 'chunk':
      return (
        exact(v, [...keys, 'byteLength']) &&
        integer(v['byteLength'], DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES) &&
        typeof v['byteLength'] === 'number' &&
        v['byteLength'] > 0 &&
        v['byteLength'] % 2 === 0
      );
    case 'end':
      return exact(v, [...keys, 'terminal']) && isSpeechVerifiedTerminal(v['terminal']);
    case 'stop':
      return exact(v, keys);
    default:
      return false;
  }
}
export function isDesktopSpeechReady(value: unknown): value is DesktopSpeechReady {
  const v = object(value);
  return (
    !!v &&
    exact(v, [...identityKeys, 'sequence', 'format']) &&
    identity(v) &&
    integer(v['sequence']) &&
    isSpeechFormat(v['format'])
  );
}
export function isDesktopSpeechConsume(value: unknown): value is DesktopSpeechConsume {
  const v = object(value);
  return (
    !!v &&
    exact(v, [...identityKeys, 'sequence', 'byteLength']) &&
    identity(v) &&
    integer(v['sequence']) &&
    integer(v['byteLength'], DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES) &&
    typeof v['byteLength'] === 'number' &&
    v['byteLength'] > 0 &&
    v['byteLength'] % 2 === 0
  );
}
export function isDesktopSpeechPlayback(value: unknown): value is DesktopSpeechPlayback {
  const v = object(value);
  return (
    !!v &&
    exact(v, [...identityKeys, 'sequence', 'status', 'endedFrames']) &&
    identity(v) &&
    integer(v['sequence']) &&
    ['started', 'progress', 'ended', 'failed'].some((status) => status === v['status']) &&
    integer(v['endedFrames'], SPEECH_SEGMENT_MAX_FRAMES)
  );
}
export function isDesktopSpeechReleased(value: unknown): value is DesktopSpeechReleased {
  const v = object(value);
  return (
    !!v &&
    exact(v, [...identityKeys, 'sequence', 'cleanup']) &&
    identity(v) &&
    integer(v['sequence']) &&
    (v['cleanup'] === 'settled' || v['cleanup'] === 'failed')
  );
}
/** Check the binary header against the prepared identity before accepting any PCM. */
export function matchesDesktopSpeechAudioHeader(
  identity: DesktopSpeechPlaybackIdentity,
  value: unknown,
): value is SpeechAudioHeader {
  return (
    isSpeechAudioHeader(value) &&
    value.utteranceId === identity.utteranceId &&
    value.clientId === identity.clientId &&
    value.agentId === identity.agentId &&
    value.serviceEpoch === identity.serviceEpoch &&
    value.utteranceBindingId === identity.utteranceBindingId &&
    value.segmentIndex === identity.segmentIndex &&
    value.requestId === identity.requestId &&
    value.providerRef === identity.remoteBinding.providerRef &&
    value.bindingId === identity.remoteBinding.bindingId
  );
}
