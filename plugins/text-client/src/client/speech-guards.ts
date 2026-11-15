import {
  isSpeechAudioHeader,
  isSpeechRemoteBinding,
  isSpeechSegmentKey,
  isSpeechTtsSettings,
  isSpeechUtteranceKey,
  isSpeechVerifiedTerminal,
  SPEECH_AUDIO_HEADER_MAX_BYTES,
  SPEECH_CATALOG_MAX_BYTES,
  SPEECH_CATALOG_MAX_CANDIDATES,
  SPEECH_CONTROL_MAX_BYTES,
  SPEECH_MAX_SEGMENTS,
  SPEECH_SEGMENT_MAX_FRAMES,
  SPEECH_SPLIT_VERSION,
  SPEECH_VIEW_MAX_BYTES,
  type SpeechAudioHeader,
  type SpeechCatalog,
  type SpeechSegmentKey,
  type SpeechSegmentReceipt,
  type SpeechSegmentTerminal,
  type SpeechUtteranceKey,
  type SpeechUtteranceReceipt,
  type SpeechUtteranceStatus,
  type SpeechView,
} from '@pet/contracts';
import { parseKernelError } from './guards.js';

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
const count = (v: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= minimum && v <= maximum;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const member = (v: unknown, allowed: readonly string[]): boolean =>
  typeof v === 'string' && allowed.includes(v);
const cleanup = (v: unknown): boolean => member(v, ['pending', 'settled', 'failed', 'unknown']);
const outcome = (v: unknown): boolean =>
  member(v, ['pending', 'completed', 'failed', 'cancelled', 'unknown']);
const source = (v: unknown): boolean => member(v, ['ready', 'disabled', 'unavailable']);
const fits = (v: unknown, bytes: number): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(v)).byteLength <= bytes;
  } catch {
    return false;
  }
};
const ref = (v: unknown): boolean =>
  isSpeechRemoteBinding({ providerRef: v, bindingId: 'binding' });
const reason = (v: unknown): boolean =>
  v === null ||
  member(v, [
    'feature-disabled',
    'provider-disabled',
    'source-unavailable',
    'model-unconfigured',
    'key-required',
    'unsupported-protocol',
    'cleanup-pending',
    'invalid-stream',
    'partial-output',
    'remote-unknown',
    'playback-failed',
    'quota-exceeded',
  ]);

export function sameSpeechUtterance(a: SpeechUtteranceKey, b: SpeechUtteranceKey): boolean {
  return (
    a.utteranceId === b.utteranceId &&
    a.clientId === b.clientId &&
    a.agentId === b.agentId &&
    a.serviceEpoch === b.serviceEpoch
  );
}
export function sameSpeechSegment(a: SpeechSegmentKey, b: SpeechSegmentKey): boolean {
  return (
    sameSpeechUtterance(a, b) &&
    a.utteranceBindingId === b.utteranceBindingId &&
    a.segmentIndex === b.segmentIndex &&
    a.requestId === b.requestId
  );
}
function key(value: Record<string, unknown>): SpeechUtteranceKey | null {
  const candidate = {
    utteranceId: value['utteranceId'],
    clientId: value['clientId'],
    agentId: value['agentId'],
    serviceEpoch: value['serviceEpoch'],
  };
  return isSpeechUtteranceKey(candidate) ? candidate : null;
}
function segmentKey(value: Record<string, unknown>): SpeechSegmentKey | null {
  const candidate = {
    utteranceId: value['utteranceId'],
    clientId: value['clientId'],
    agentId: value['agentId'],
    serviceEpoch: value['serviceEpoch'],
    utteranceBindingId: value['utteranceBindingId'],
    segmentIndex: value['segmentIndex'],
    requestId: value['requestId'],
  };
  return isSpeechSegmentKey(candidate) ? candidate : null;
}

export function parseSpeechView(value: unknown): SpeechView | null {
  if (
    !record(value) ||
    value['version'] !== 1 ||
    !record(value['feature']) ||
    !Array.isArray(value['providers']) ||
    value['providers'].length > 4 ||
    !fits(value, SPEECH_VIEW_MAX_BYTES)
  )
    return null;
  const f = value['feature'];
  if (
    !ref(f['providerRef']) ||
    !text(f['sourcePluginId'], 128) ||
    !id(f['instanceId']) ||
    !source(f['source']) ||
    !count(f['configRevision'])
  )
    return null;
  const refs = new Set<string>();
  for (const p of value['providers']) {
    if (!record(p) || !record(p['credential'])) return null;
    const c = p['credential'];
    if (
      !ref(p['providerRef']) ||
      typeof p['providerRef'] !== 'string' ||
      refs.has(p['providerRef']) ||
      !text(p['sourcePluginId'], 128) ||
      !id(p['instanceId']) ||
      !id(p['providerId']) ||
      p['providerRef'] !== `${String(p['sourcePluginId'])}/${p['providerId']}` ||
      !text(p['label'], 320) ||
      typeof p['synthetic'] !== 'boolean' ||
      !source(p['source']) ||
      !count(p['configRevision']) ||
      !isSpeechTtsSettings(p['settings']) ||
      !(p['bindingId'] === null || id(p['bindingId'])) ||
      !member(p['readiness'], ['unconfigured', 'configured', 'unavailable']) ||
      !reason(p['reason']) ||
      typeof c['available'] !== 'boolean' ||
      typeof c['writable'] !== 'boolean' ||
      !text(c['version'], 128) ||
      !member(c['source'], ['none', 'memory', 'environment', 'local-client-id'])
    )
      return null;
    refs.add(p['providerRef']);
  }
  return value as unknown as SpeechView;
}
export function parseSpeechCatalog(value: unknown): SpeechCatalog | null {
  if (
    !record(value) ||
    !ref(value['providerRef']) ||
    !id(value['bindingId']) ||
    !Array.isArray(value['candidates']) ||
    value['candidates'].length > SPEECH_CATALOG_MAX_CANDIDATES ||
    !fits(value, SPEECH_CATALOG_MAX_BYTES)
  )
    return null;
  const seen = new Set<string>();
  for (const c of value['candidates']) {
    if (
      !record(c) ||
      !text(c['modelRef'], 128) ||
      !c['modelRef'] ||
      seen.has(c['modelRef']) ||
      !text(c['label'], 320) ||
      c['role'] !== 'tts' ||
      !member(c['classification'], ['metadata', 'known-name', 'unknown']) ||
      typeof c['selectable'] !== 'boolean' ||
      (c['selectable']
        ? c['protocol'] !== 'mimo-native-pcm16-sse' || c['reason'] !== null
        : c['protocol'] !== null || c['reason'] !== 'unsupported-protocol')
    )
      return null;
    seen.add(c['modelRef']);
  }
  return value as unknown as SpeechCatalog;
}
export function parseSpeechUtteranceReceipt(value: unknown): SpeechUtteranceReceipt | null {
  if (
    !record(value) ||
    !key(value) ||
    !ref(value['providerRef']) ||
    !id(value['bindingId']) ||
    !text(value['messageId'], 128) ||
    !value['messageId'] ||
    !count(value['eventSequence'], 1) ||
    !id(value['utteranceBindingId']) ||
    !count(value['segmentCount'], 1, SPEECH_MAX_SEGMENTS) ||
    value['splitVersion'] !== SPEECH_SPLIT_VERSION
  )
    return null;
  return value as unknown as SpeechUtteranceReceipt;
}
export function parseSpeechSegmentReceipt(value: unknown): SpeechSegmentReceipt | null {
  return record(value) && segmentKey(value) && value['phase'] === 'awaiting-consumer'
    ? (value as unknown as SpeechSegmentReceipt)
    : null;
}
function terminal(value: unknown): SpeechSegmentTerminal | null {
  if (
    !record(value) ||
    value['outcome'] === 'pending' ||
    !outcome(value['outcome']) ||
    !(
      value['finishReason'] === null ||
      member(value['finishReason'], ['stop', 'length', 'content_filter', 'error', 'missing-stop'])
    ) ||
    !count(value['producedFrames'], 0, SPEECH_SEGMENT_MAX_FRAMES) ||
    value['producedBytes'] !== value['producedFrames'] * 2 ||
    !count(value['drainedFrames'], 0, value['producedFrames']) ||
    value['drainedBytes'] !== value['drainedFrames'] * 2 ||
    typeof value['nativeSettled'] !== 'boolean' ||
    !cleanup(value['transportCleanup']) ||
    !(value['error'] === null || parseKernelError(value['error']))
  )
    return null;
  if (value['outcome'] === 'completed' && !isSpeechVerifiedTerminal(value)) return null;
  return value as unknown as SpeechSegmentTerminal;
}
export function parseSpeechUtteranceStatus(value: unknown): SpeechUtteranceStatus | null {
  if (
    !record(value) ||
    !key(value) ||
    !fits(value, SPEECH_CONTROL_MAX_BYTES) ||
    !member(value['phase'], ['planned', 'streaming', 'stopping', 'terminal']) ||
    !outcome(value['outcome']) ||
    !cleanup(value['cleanup']) ||
    !count(value['attemptedThrough'], -1, SPEECH_MAX_SEGMENTS - 1) ||
    !count(value['deliveredThrough'], -1, value['attemptedThrough']) ||
    !(value['error'] === null || parseKernelError(value['error'])) ||
    !reason(value['reason']) ||
    !(value['completedAt'] === null || count(value['completedAt'], 0, 8.64e15))
  )
    return null;
  const receipt = value['receipt'] === null ? null : parseSpeechUtteranceReceipt(value['receipt']);
  if (
    value['receipt'] !== null &&
    (!receipt || !sameSpeechUtterance(receipt, value as unknown as SpeechUtteranceKey))
  )
    return null;
  const s = value['currentSegment'];
  if (s !== null) {
    if (
      !record(s) ||
      !segmentKey(s) ||
      !sameSpeechUtterance(
        s as unknown as SpeechSegmentKey,
        value as unknown as SpeechUtteranceKey,
      ) ||
      !member(s['phase'], ['awaiting-consumer', 'streaming', 'stopping', 'terminal']) ||
      !count(s['producedFrames'], 0, SPEECH_SEGMENT_MAX_FRAMES) ||
      !count(s['drainedFrames'], 0, s['producedFrames']) ||
      typeof s['nativeSettled'] !== 'boolean' ||
      !cleanup(s['transportCleanup']) ||
      !(s['terminal'] === null || terminal(s['terminal']))
    )
      return null;
    if (
      receipt &&
      (s['utteranceBindingId'] !== receipt.utteranceBindingId ||
        !count(s['segmentIndex'], 0, receipt.segmentCount - 1))
    )
      return null;
  }
  return value as unknown as SpeechUtteranceStatus;
}
export function parseSpeechAudioHeader(value: string): SpeechAudioHeader | null {
  if (new TextEncoder().encode(value).byteLength > SPEECH_AUDIO_HEADER_MAX_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isSpeechAudioHeader(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
