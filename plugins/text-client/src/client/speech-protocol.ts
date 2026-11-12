import {
  SPEECH_AUDIO_HEADER,
  SPEECH_CATALOG_TIMEOUT_MS,
  SPEECH_FIRST_AUDIO_TIMEOUT_MS,
  SPEECH_PRODUCER_IDLE_TIMEOUT_MS,
  SPEECH_SEGMENT_MAX_BYTES,
  SPEECH_SEGMENT_TIMEOUT_MS,
  SPEECH_STATUS_TIMEOUT_MS,
  makeError,
  type Result,
  type SpeechAudioHeader,
  type SpeechBegin,
  type SpeechCatalog,
  type SpeechCredentialCommand,
  type SpeechProviderCommand,
  type SpeechRemoteBinding,
  type SpeechSegmentKey,
  type SpeechSegmentReceipt,
  type SpeechSegmentReserve,
  type SpeechUtteranceKey,
  type SpeechUtteranceReceipt,
  type SpeechUtteranceStatus,
  type SpeechView,
} from '@pet/contracts';
import type { ClientTransport } from './protocol.js';
import { requestJson, statusError } from './request.js';
import {
  parseSpeechAudioHeader,
  parseSpeechCatalog,
  parseSpeechSegmentReceipt,
  parseSpeechUtteranceReceipt,
  parseSpeechUtteranceStatus,
  parseSpeechView,
  sameSpeechSegment,
  sameSpeechUtterance,
} from './speech-guards.js';

const invalid = { ok: false, error: makeError('unavailable', false) } as const;
const pathFor = (id: string): string => `/api/speech/utterances/${encodeURIComponent(id)}`;
const query = (key: SpeechUtteranceKey): Record<string, string> => ({
  clientId: key.clientId,
  agentId: key.agentId,
  serviceEpoch: key.serviceEpoch,
});
const post = (value: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
  ...(signal ? { signal } : {}),
});
async function read<T>(
  t: ClientTransport,
  path: string,
  init: RequestInit,
  parse: (v: unknown) => T | null,
  timeout = SPEECH_STATUS_TIMEOUT_MS,
): Promise<Result<T>> {
  const result = await requestJson(t, path, init, timeout);
  if (!result.ok) return result;
  const value = parse(result.value);
  return value === null ? invalid : { ok: true, value };
}
export function getSpeech(t: ClientTransport, signal?: AbortSignal): Promise<Result<SpeechView>> {
  return read(t, '/api/speech', { method: 'GET', ...(signal ? { signal } : {}) }, parseSpeechView);
}
export async function getSpeechCatalog(
  t: ClientTransport,
  binding: SpeechRemoteBinding,
  signal?: AbortSignal,
): Promise<Result<SpeechCatalog>> {
  const result = await read(
    t,
    `/api/speech/catalog?${new URLSearchParams({ ...binding })}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
    parseSpeechCatalog,
    SPEECH_CATALOG_TIMEOUT_MS + 1000,
  );
  return result.ok &&
    (result.value.providerRef !== binding.providerRef ||
      result.value.bindingId !== binding.bindingId)
    ? invalid
    : result;
}
export function saveSpeechProvider(
  t: ClientTransport,
  command: SpeechProviderCommand,
  signal?: AbortSignal,
): Promise<Result<SpeechView>> {
  return read(t, '/api/speech/provider', post(command, signal), parseSpeechView);
}
export function writeSpeechCredential(
  t: ClientTransport,
  command: SpeechCredentialCommand,
  signal?: AbortSignal,
): Promise<Result<SpeechView>> {
  return read(t, '/api/speech/credential', post(command, signal), parseSpeechView);
}
export async function beginSpeechUtterance(
  t: ClientTransport,
  input: SpeechBegin,
  signal?: AbortSignal,
): Promise<Result<SpeechUtteranceReceipt>> {
  const result = await read(
    t,
    '/api/speech/utterances',
    post(input, signal),
    parseSpeechUtteranceReceipt,
  );
  return result.ok &&
    (!sameSpeechUtterance(result.value, input) ||
      result.value.providerRef !== input.providerRef ||
      result.value.bindingId !== input.bindingId ||
      result.value.messageId !== input.messageId ||
      result.value.eventSequence !== input.eventSequence)
    ? invalid
    : result;
}
export async function reserveSpeechSegment(
  t: ClientTransport,
  input: SpeechSegmentReserve,
  signal?: AbortSignal,
): Promise<Result<SpeechSegmentReceipt>> {
  const { utteranceId, ...body } = input;
  const result = await read(
    t,
    `${pathFor(utteranceId)}/segments`,
    post(body, signal),
    parseSpeechSegmentReceipt,
  );
  return result.ok && !sameSpeechSegment(result.value, input) ? invalid : result;
}
export async function getSpeechUtterance(
  t: ClientTransport,
  key: SpeechUtteranceKey,
  signal?: AbortSignal,
): Promise<Result<SpeechUtteranceStatus>> {
  const result = await read(
    t,
    `${pathFor(key.utteranceId)}?${new URLSearchParams(query(key))}`,
    { method: 'GET', ...(signal ? { signal } : {}) },
    parseSpeechUtteranceStatus,
  );
  return result.ok && !sameSpeechUtterance(result.value, key) ? invalid : result;
}
export async function cancelSpeechUtterance(
  t: ClientTransport,
  key: SpeechUtteranceKey,
  signal?: AbortSignal,
): Promise<Result<SpeechUtteranceStatus>> {
  const result = await read(
    t,
    `${pathFor(key.utteranceId)}/cancel`,
    post(query(key), signal),
    parseSpeechUtteranceStatus,
  );
  return result.ok && !sameSpeechUtterance(result.value, key) ? invalid : result;
}

export interface SpeechAudioRead {
  readonly header: SpeechAudioHeader;
  readonly receivedFrames: number;
  readonly receivedBytes: number;
}
/** Caller must await this entire operation inside its existing authorized token/source scope. */
export async function consumeSpeechAudio(
  t: ClientTransport,
  key: SpeechSegmentKey,
  binding: SpeechRemoteBinding,
  consume: (
    header: SpeechAudioHeader,
    audio: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ) => Promise<void>,
  signal?: AbortSignal,
): Promise<Result<SpeechAudioRead>> {
  const abort = new AbortController();
  const absolute = AbortSignal.timeout(SPEECH_SEGMENT_TIMEOUT_MS);
  const combined = signal
    ? AbortSignal.any([signal, abort.signal, absolute])
    : AbortSignal.any([abort.signal, absolute]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const arm = (ms: number): void => {
    clear();
    timer = setTimeout(() => abort.abort('timeout'), ms);
  };
  const firstDeadline = Date.now() + SPEECH_FIRST_AUDIO_TIMEOUT_MS;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  let receivedBytes = 0;
  let used = false;
  let bodyError: unknown;
  const perform = async (): Promise<Result<SpeechAudioRead>> => {
    try {
      arm(SPEECH_FIRST_AUDIO_TIMEOUT_MS);
      const response = await fetch(
        `${t.baseUrl}${pathFor(key.utteranceId)}/segments/${key.segmentIndex}/audio?${new URLSearchParams(
          {
            ...query(key),
            utteranceBindingId: key.utteranceBindingId,
            requestId: key.requestId,
          },
        )}`,
        {
          method: 'GET',
          signal: combined,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${t.token}`, Accept: 'application/octet-stream' },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, error: statusError(response.status) };
      }
      const rawHeader = response.headers.get(SPEECH_AUDIO_HEADER);
      const header = rawHeader === null ? null : parseSpeechAudioHeader(rawHeader);
      if (
        !response.body ||
        !/^application\/octet-stream(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
        !header ||
        !sameSpeechSegment(header, key) ||
        header.providerRef !== binding.providerRef ||
        header.bindingId !== binding.bindingId
      ) {
        await response.body?.cancel();
        return invalid;
      }
      reader = response.body.getReader();
      const activeReader = reader;
      let carry: number | undefined;
      let emitted = false;
      const audio: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          if (used) throw new Error('Speech audio has one consumer');
          used = true;
          try {
            for (;;) {
              combined.throwIfAborted();
              arm(
                emitted ? SPEECH_PRODUCER_IDLE_TIMEOUT_MS : Math.max(1, firstDeadline - Date.now()),
              );
              const next = await activeReader.read();
              clear();
              if (next.done) {
                if (carry !== undefined || !receivedBytes) throw new Error('Incomplete PCM');
                complete = true;
                return;
              }
              receivedBytes += next.value.byteLength;
              if (receivedBytes > SPEECH_SEGMENT_MAX_BYTES)
                throw new Error('Speech audio budget exceeded');
              const bytes = new Uint8Array(next.value.byteLength + Number(carry !== undefined));
              let at = 0;
              if (carry !== undefined) bytes[at++] = carry;
              bytes.set(next.value, at);
              const length = bytes.length - (bytes.length % 2);
              carry = length === bytes.length ? undefined : bytes[length];
              if (!length) continue;
              emitted = true;
              // The authorized consumer owns actual node/credit progress and its stall clock.
              // Time suspended at yield is intentional backpressure, not a reader timeout.
              yield bytes.subarray(0, length);
            }
          } finally {
            clear();
          }
        },
      };
      await consume(header, audio, combined);
      combined.throwIfAborted();
      if (!complete) return invalid;
      return { ok: true, value: { header, receivedFrames: receivedBytes / 2, receivedBytes } };
    } catch (error) {
      bodyError = error;
      return {
        ok: false,
        error: makeError(
          signal?.aborted
            ? 'cancelled'
            : absolute.aborted || abort.signal.aborted
              ? 'timeout'
              : 'network',
          false,
        ),
      };
    }
  };
  const result = await perform();
  clear();
  let cleanupFailed = false;
  try {
    if (reader) {
      try {
        await reader.cancel();
      } catch (error) {
        const cancelled = error instanceof Error && error.name === 'AbortError';
        cleanupFailed = error !== bodyError && !(combined.aborted && cancelled);
      }
      try {
        reader.releaseLock();
      } catch {
        cleanupFailed = true;
      }
    }
  } finally {
    abort.abort();
  }
  return cleanupFailed ? { ok: false, error: makeError('internal', false) } : result;
}
