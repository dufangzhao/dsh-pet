import {
  VOICE_CATALOG_TIMEOUT_MS,
  VOICE_MAX_PCM_BYTES,
  type DesktopVoiceBridge,
  VOICE_UPLOAD_TIMEOUT_MS,
  makeError,
  type Result,
  type VoiceBegin,
  type VoiceCaptureResult,
  type VoiceCatalog,
  type VoiceCredentialCommand,
  type VoiceProviderCommand,
  type VoiceResultKey,
  type VoiceSettingsCommand,
  type VoiceTicket,
  type VoiceView,
} from '@pet/contracts';
import type { ClientTransport } from './protocol.js';
import { requestJson } from './request.js';
import {
  parseVoiceCaptureResult,
  parseVoiceCatalog,
  parseVoiceTicket,
  parseVoiceView,
} from './voice-guards.js';

const INVALID = { ok: false, error: makeError('unavailable', false) } as const;
async function read<T>(
  transport: ClientTransport,
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T | null,
  timeout = 20_000,
): Promise<Result<T>> {
  const result = await requestJson(transport, path, init, timeout);
  if (!result.ok) return result;
  const value = parse(result.value);
  return value === null ? INVALID : { ok: true, value };
}
const post = (value: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
  ...(signal ? { signal } : {}),
});
const queryKey = (key: VoiceResultKey): string =>
  new URLSearchParams({
    clientId: key.clientId,
    agentId: key.agentId,
    serviceEpoch: key.serviceEpoch,
  }).toString();
const pathFor = (captureId: string): string =>
  `/api/voice/captures/${encodeURIComponent(captureId)}`;
const same = (ticket: VoiceTicket, key: VoiceResultKey): boolean =>
  ticket.captureId === key.captureId &&
  ticket.clientId === key.clientId &&
  ticket.agentId === key.agentId &&
  ticket.serviceEpoch === key.serviceEpoch;
export function getVoice(
  transport: ClientTransport,
  signal?: AbortSignal,
): Promise<Result<VoiceView>> {
  return read(
    transport,
    '/api/voice',
    { method: 'GET', ...(signal ? { signal } : {}) },
    parseVoiceView,
  );
}
export function saveVoiceSettings(
  transport: ClientTransport,
  command: VoiceSettingsCommand,
  signal?: AbortSignal,
): Promise<Result<VoiceView>> {
  return read(transport, '/api/voice/settings', post(command, signal), parseVoiceView);
}
export function saveAsrProvider(
  transport: ClientTransport,
  command: VoiceProviderCommand,
  signal?: AbortSignal,
): Promise<Result<VoiceView>> {
  return read(transport, '/api/voice/provider', post(command, signal), parseVoiceView);
}
export function writeVoiceCredential(
  transport: ClientTransport,
  command: VoiceCredentialCommand,
  signal?: AbortSignal,
): Promise<Result<VoiceView>> {
  return read(transport, '/api/voice/credential', post(command, signal), parseVoiceView);
}
export async function getVoiceCatalog(
  transport: ClientTransport,
  target: { providerRef: string; bindingId: string },
  signal?: AbortSignal,
): Promise<Result<VoiceCatalog>> {
  const result = await read(
    transport,
    `/api/voice/catalog?${new URLSearchParams(target)}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
    parseVoiceCatalog,
    VOICE_CATALOG_TIMEOUT_MS + 1000,
  );
  return result.ok &&
    (result.value.providerRef !== target.providerRef || result.value.bindingId !== target.bindingId)
    ? INVALID
    : result;
}
export async function beginVoiceCapture(
  transport: ClientTransport,
  input: VoiceBegin,
  signal?: AbortSignal,
): Promise<Result<VoiceTicket>> {
  const result = await read(
    transport,
    '/api/voice/captures',
    post(input, signal),
    parseVoiceTicket,
  );
  return result.ok &&
    (result.value.captureId !== input.captureId ||
      result.value.clientId !== input.clientId ||
      result.value.agentId !== input.agentId ||
      result.value.bindingId !== input.bindingId ||
      result.value.finishMode !== input.finishMode)
    ? INVALID
    : result;
}
export async function getVoiceCapture(
  transport: ClientTransport,
  key: VoiceResultKey,
  signal?: AbortSignal,
): Promise<Result<VoiceCaptureResult>> {
  const result = await read(
    transport,
    `${pathFor(key.captureId)}?${queryKey(key)}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
    parseVoiceCaptureResult,
  );
  return result.ok && !same(result.value.ticket, key) ? INVALID : result;
}
export async function cancelVoiceCapture(
  transport: ClientTransport,
  key: VoiceResultKey,
  signal?: AbortSignal,
): Promise<Result<VoiceCaptureResult>> {
  const { captureId, ...owner } = key;
  const result = await read(
    transport,
    `${pathFor(captureId)}/cancel`,
    post(owner, signal),
    parseVoiceCaptureResult,
    VOICE_UPLOAD_TIMEOUT_MS,
  );
  return result.ok && !same(result.value.ticket, key) ? INVALID : result;
}
export async function uploadVoiceCapture(
  transport: ClientTransport,
  ticket: VoiceTicket,
  samples: number,
  pcm: Uint8Array,
  signal?: AbortSignal,
): Promise<Result<VoiceCaptureResult>> {
  if (
    !Number.isSafeInteger(samples) ||
    samples < 0 ||
    samples > ticket.maxSamples ||
    !(pcm instanceof Uint8Array) ||
    pcm.byteLength !== samples * 4 ||
    pcm.byteLength > VOICE_MAX_PCM_BYTES
  )
    return { ok: false, error: makeError('invalid-input', false) };
  const owned = Uint8Array.from(pcm);
  const result = await read(
    transport,
    `${pathFor(ticket.captureId)}/audio`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Pet-Voice-Client': ticket.clientId,
        'X-Pet-Voice-Agent': ticket.agentId,
        'X-Pet-Voice-Epoch': ticket.serviceEpoch,
        'X-Pet-Voice-Samples': String(samples),
      },
      body: owned,
      ...(signal ? { signal } : {}),
    },
    parseVoiceCaptureResult,
    VOICE_UPLOAD_TIMEOUT_MS,
  );
  if (
    result.ok &&
    (!same(result.value.ticket, ticket) ||
      result.value.ticket.bindingId !== ticket.bindingId ||
      result.value.ticket.finishMode !== ticket.finishMode)
  )
    return INVALID;
  return result;
}

/** A real absence boundary for consumers before the runtime feature is connected. */
export const unavailableVoiceResult = <T>(): Result<T> => ({
  ok: false,
  error: makeError('not-ready', false),
});
export function unavailableVoiceView(): VoiceView {
  return {
    version: 1,
    feature: {
      source: 'unavailable',
      configRevision: 0,
      providerRef: 'pet.asr-magpie/magpie',
      finishMode: 'send',
    },
    providers: [],
  };
}
export function createUnavailableDesktopVoiceBridge(): DesktopVoiceBridge {
  const unavailable = async <T>(): Promise<Result<T>> => unavailableVoiceResult<T>();
  return Object.freeze({
    version: 1,
    getState: unavailable,
    onChanged: () => () => {},
    readVoice: unavailable,
    saveVoiceSettings: unavailable,
    saveAsrProvider: unavailable,
    readAsrCatalog: unavailable,
    begin: unavailable,
    readCaptureResult: unavailable,
    captureReady: unavailable,
    pushAudio: unavailable,
    finishCapture: unavailable,
    cancelCapture: unavailable,
    reportCaptureError: unavailable,
    reportCaptureReleased: unavailable,
  });
}
