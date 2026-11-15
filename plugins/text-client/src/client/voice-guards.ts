import {
  COMPANION_MAX_TEXT,
  VOICE_CATALOG_MAX_BYTES,
  VOICE_CATALOG_MAX_CANDIDATES,
  VOICE_MAX_SAMPLES,
  VOICE_RESULT_MAX_BYTES,
  VOICE_VIEW_MAX_BYTES,
  type VoiceAsrSettings,
  type VoiceCandidate,
  type VoiceCaptureResult,
  type VoiceCatalog,
  type VoiceProviderView,
  type VoiceTicket,
  type VoiceView,
} from '@pet/contracts';
import { parseKernelError } from './guards.js';

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const count = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown): v is number => count(v) && v <= 8.64e15;
const selector = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 256 && /^[a-z][a-z0-9.-]*\/[a-z][a-z0-9.-]*$/.test(v);
function member<const T extends string>(v: unknown, values: readonly T[]): T | null {
  return typeof v === 'string' && values.some((item) => item === v) ? (v as T) : null;
}
function fits(value: unknown, bytes: number): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= bytes;
  } catch {
    return false;
  }
}
export function parseVoiceSettings(value: unknown): VoiceAsrSettings | null {
  if (
    !record(value) ||
    !text(value['baseUrl'], 2048) ||
    !text(value['modelRef'], 128) ||
    value['protocol'] !== 'mimo-native'
  )
    return null;
  const authMode = member(value['authMode'], ['local-client-id', 'gateway-key']);
  return authMode === null
    ? null
    : {
        baseUrl: value['baseUrl'],
        modelRef: value['modelRef'],
        protocol: 'mimo-native',
        authMode,
      };
}
function provider(value: unknown): VoiceProviderView | null {
  if (!record(value) || !record(value['credential'])) return null;
  const c = value['credential'];
  const source = member(value['source'], ['ready', 'disabled', 'unavailable']);
  const readiness = member(value['readiness'], ['unconfigured', 'configured', 'unavailable']);
  const reason =
    value['reason'] === null
      ? null
      : member(value['reason'], [
          'feature-disabled',
          'provider-disabled',
          'source-unavailable',
          'model-unconfigured',
          'key-required',
          'unsupported-protocol',
          'cleanup-pending',
        ]);
  const credentialSource = member(c['source'], [
    'none',
    'memory',
    'environment',
    'local-client-id',
  ]);
  const settings = parseVoiceSettings(value['settings']);
  if (
    !selector(value['providerRef']) ||
    !text(value['label'], 320) ||
    typeof value['synthetic'] !== 'boolean' ||
    source === null ||
    readiness === null ||
    !count(value['configRevision']) ||
    settings === null ||
    !(value['bindingId'] === null || id(value['bindingId'])) ||
    typeof c['available'] !== 'boolean' ||
    typeof c['writable'] !== 'boolean' ||
    !text(c['version'], 256) ||
    credentialSource === null ||
    (value['reason'] !== null && reason === null)
  )
    return null;
  return {
    providerRef: value['providerRef'],
    label: value['label'],
    synthetic: value['synthetic'],
    source,
    configRevision: value['configRevision'],
    settings,
    bindingId: value['bindingId'],
    credential: {
      available: c['available'],
      writable: c['writable'],
      version: c['version'],
      source: credentialSource,
    },
    readiness,
    reason,
  };
}
export function parseVoiceView(value: unknown): VoiceView | null {
  if (
    !record(value) ||
    !record(value['feature']) ||
    value['version'] !== 1 ||
    !fits(value, VOICE_VIEW_MAX_BYTES)
  )
    return null;
  const f = value['feature'];
  const source = member(f['source'], ['ready', 'disabled', 'unavailable']);
  const finishMode = member(f['finishMode'], ['send', 'review']);
  if (
    source === null ||
    finishMode === null ||
    !selector(f['providerRef']) ||
    !count(f['configRevision']) ||
    !Array.isArray(value['providers']) ||
    value['providers'].length > 4
  )
    return null;
  const providers: VoiceProviderView[] = [];
  for (const item of value['providers']) {
    const parsed = provider(item);
    if (parsed === null || providers.some((old) => old.providerRef === parsed.providerRef))
      return null;
    providers.push(parsed);
  }
  return {
    version: 1,
    feature: {
      source,
      finishMode,
      providerRef: f['providerRef'],
      configRevision: f['configRevision'],
    },
    providers,
  };
}
export function parseVoiceCatalog(value: unknown): VoiceCatalog | null {
  if (
    !record(value) ||
    !selector(value['providerRef']) ||
    !id(value['bindingId']) ||
    !fits(value, VOICE_CATALOG_MAX_BYTES) ||
    !Array.isArray(value['candidates']) ||
    value['candidates'].length > VOICE_CATALOG_MAX_CANDIDATES
  )
    return null;
  const candidates: VoiceCandidate[] = [];
  for (const row of value['candidates']) {
    if (
      !record(row) ||
      !text(row['modelRef'], 128) ||
      !row['modelRef'] ||
      !text(row['label'], 320) ||
      row['role'] !== 'asr' ||
      typeof row['selectable'] !== 'boolean'
    )
      return null;
    const classification = member(row['classification'], ['metadata', 'known-name']);
    if (
      classification === null ||
      (row['protocol'] !== null && row['protocol'] !== 'mimo-native') ||
      (row['reason'] !== null && row['reason'] !== 'unsupported-protocol') ||
      (row['selectable']
        ? row['protocol'] !== 'mimo-native' || row['reason'] !== null
        : row['reason'] !== 'unsupported-protocol') ||
      candidates.some((old) => old.modelRef === row['modelRef'])
    )
      return null;
    candidates.push({
      modelRef: row['modelRef'],
      label: row['label'],
      role: 'asr',
      classification,
      protocol: row['protocol'],
      selectable: row['selectable'],
      reason: row['reason'],
    });
  }
  return { providerRef: value['providerRef'], bindingId: value['bindingId'], candidates };
}
export function parseVoiceTicket(value: unknown): VoiceTicket | null {
  if (
    !record(value) ||
    value['version'] !== 1 ||
    !id(value['captureId']) ||
    !id(value['clientId']) ||
    !id(value['agentId']) ||
    !id(value['serviceEpoch']) ||
    !id(value['bindingId']) ||
    value['encoding'] !== 'f32le' ||
    value['sampleRate'] !== 16000 ||
    value['channels'] !== 1 ||
    value['chunkSamples'] !== 1600 ||
    value['maxSamples'] !== VOICE_MAX_SAMPLES ||
    !time(value['expiresAt'])
  )
    return null;
  const finishMode = member(value['finishMode'], ['send', 'review']);
  return finishMode === null
    ? null
    : {
        version: 1,
        captureId: value['captureId'],
        clientId: value['clientId'],
        agentId: value['agentId'],
        serviceEpoch: value['serviceEpoch'],
        bindingId: value['bindingId'],
        encoding: 'f32le',
        sampleRate: 16000,
        channels: 1,
        chunkSamples: 1600,
        maxSamples: VOICE_MAX_SAMPLES,
        finishMode,
        expiresAt: value['expiresAt'],
      };
}
export function parseVoiceCaptureResult(value: unknown): VoiceCaptureResult | null {
  if (!record(value) || !fits(value, VOICE_RESULT_MAX_BYTES)) return null;
  const ticket = parseVoiceTicket(value['ticket']);
  const phase = member(value['phase'], [
    'awaiting-audio',
    'transcribing',
    'retiring',
    'final',
    'empty',
    'cancelled',
    'failed',
  ]);
  const cleanup = member(value['cleanup'], ['pending', 'settled']);
  if (
    ticket === null ||
    phase === null ||
    cleanup === null ||
    !count(value['samples']) ||
    value['samples'] > VOICE_MAX_SAMPLES ||
    !(value['completedAt'] === null || time(value['completedAt']))
  )
    return null;
  const error = value['error'] === null ? null : parseKernelError(value['error']);
  if (value['error'] !== null && error === null) return null;
  const raw = value['outcome'];
  let outcome: VoiceCaptureResult['outcome'] = null;
  if (
    record(raw) &&
    raw['kind'] === 'final' &&
    text(raw['text'], COMPANION_MAX_TEXT) &&
    raw['text'].trim()
  )
    outcome = { kind: 'final', text: raw['text'] };
  else if (record(raw) && raw['kind'] === 'no-speech') outcome = { kind: 'no-speech' };
  else if (raw !== null) return null;
  const terminal = ['final', 'empty', 'cancelled', 'failed'].includes(phase);
  if (
    terminal !== (cleanup === 'settled') ||
    terminal !== (value['completedAt'] !== null) ||
    (phase === 'final' ? outcome?.kind !== 'final' || error !== null : outcome?.kind === 'final') ||
    (phase === 'empty'
      ? outcome?.kind !== 'no-speech' || error !== null
      : outcome?.kind === 'no-speech') ||
    (phase === 'failed' && error === null)
  )
    return null;
  return {
    ticket,
    phase,
    samples: value['samples'],
    cleanup,
    outcome,
    error,
    completedAt: value['completedAt'],
  };
}
