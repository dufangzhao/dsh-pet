import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SPEECH_AUDIO_HEADER,
  SPEECH_AUDIO_HEADER_MAX_BYTES,
  SPEECH_BODY_TIMEOUT_MS,
  SPEECH_CONSUMER_STALL_TIMEOUT_MS,
  isSpeechAudioHeader,
  isSpeechSegmentKey,
  isSpeechUtteranceKey,
  makeError,
  type Result,
  type SpeechView,
} from '@pet/contracts';
import { exactKeys, KernelFault, record } from '@pet/host-kernel';
import { jsonPreflight } from '@pet/contracts/validation';
import type { SpeechController } from './speech-controller.js';

function query(url: URL, keys: readonly string[]): Record<string, string> {
  if ([...url.searchParams.keys()].sort().join(',') !== [...keys].sort().join(','))
    throw new KernelFault('invalid-input');
  return Object.fromEntries(url.searchParams);
}
function ingress(view: SpeechView, writable: boolean): SpeechView {
  return {
    ...view,
    providers: view.providers.map((p) => ({
      ...p,
      credential: { ...p.credential, writable: p.credential.writable && writable },
    })),
  };
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const safe = jsonPreflight(value);
  const result = safe.ok ? record(safe.value) : null;
  if (!result || !exactKeys(result, keys)) throw new KernelFault('invalid-input');
  return result;
}
/** The router owns binary response lifetime; its reader never escapes the authorized callback. */
export async function speechHttp(input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  writable: boolean;
  speech: SpeechController;
  body: (request: IncomingMessage) => Promise<unknown>;
  send: <T>(response: ServerResponse, status: number, result: Result<T>) => void;
}): Promise<boolean> {
  const { request, response, url, writable, speech, body, send } = input;
  if (!/^\/api\/speech(?:\/|$)/.test(url.pathname)) return false;
  const method = request.method ?? 'GET';
  const path = url.pathname;
  const json = async (): Promise<unknown> => {
    const timeout = setTimeout(() => {
      request.destroy();
    }, SPEECH_BODY_TIMEOUT_MS);
    timeout.unref();
    try {
      return await body(request);
    } finally {
      clearTimeout(timeout);
    }
  };
  if (method === 'GET' && path === '/api/speech') {
    query(url, []);
    send(response, 200, { ok: true, value: ingress(await speech.view(), writable) });
    return true;
  }
  if (method === 'GET' && path === '/api/speech/catalog') {
    const q = query(url, ['providerRef', 'bindingId']);
    if (!q['providerRef'] || !q['bindingId']) throw new KernelFault('invalid-input');
    const abort = new AbortController();
    const close = (): void => {
      if (!response.writableFinished) abort.abort();
    };
    response.once('close', close);
    try {
      send(response, 200, {
        ok: true,
        value: await speech.catalog(q['providerRef'], q['bindingId'], abort.signal),
      });
    } catch (error) {
      if (error instanceof KernelFault && ['invalid-input', 'conflict'].includes(error.error.code))
        throw error;
      send(response, 200, {
        ok: false,
        error: error instanceof KernelFault ? error.error : makeError('unavailable', false),
      });
    } finally {
      response.off('close', close);
    }
    return true;
  }
  const match =
    /^\/api\/speech\/utterances\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})(?:\/(cancel|segments)(?:\/(0|[1-9][0-9]*)\/(audio))?)?$/.exec(
      path,
    );
  if (match?.[1]) {
    const utteranceId = match[1];
    if (method === 'GET' && !match[2]) {
      const key = { ...query(url, ['clientId', 'agentId', 'serviceEpoch']), utteranceId };
      if (!isSpeechUtteranceKey(key)) throw new KernelFault('invalid-input');
      send(response, 200, { ok: true, value: await speech.status(key) });
      return true;
    }
    if (method === 'POST' && match[2] === 'cancel' && match[3] === undefined) {
      query(url, []);
      const key = { ...object(await json(), ['clientId', 'agentId', 'serviceEpoch']), utteranceId };
      if (!isSpeechUtteranceKey(key)) throw new KernelFault('invalid-input');
      send(response, 200, { ok: true, value: await speech.cancel(key) });
      return true;
    }
    if (method === 'POST' && match[2] === 'segments' && match[3] === undefined) {
      query(url, []);
      const key = {
        ...object(await json(), [
          'clientId',
          'agentId',
          'serviceEpoch',
          'utteranceBindingId',
          'segmentIndex',
          'requestId',
        ]),
        utteranceId,
      };
      if (!isSpeechSegmentKey(key)) throw new KernelFault('invalid-input');
      send(response, 201, { ok: true, value: await speech.reserve(key) });
      return true;
    }
    if (
      method === 'GET' &&
      match[2] === 'segments' &&
      match[3] !== undefined &&
      match[4] === 'audio'
    ) {
      if (request.headers.range) throw new KernelFault('invalid-input');
      const key = {
        ...query(url, ['clientId', 'agentId', 'serviceEpoch', 'utteranceBindingId', 'requestId']),
        utteranceId,
        segmentIndex: Number(match[3]),
      };
      if (!isSpeechSegmentKey(key)) throw new KernelFault('invalid-input');
      const abort = new AbortController();
      const close = (): void => {
        if (!response.writableFinished) abort.abort();
      };
      const failed = (): void => abort.abort();
      response.once('close', close);
      request.once('error', failed);
      try {
        await speech.audio(key, abort.signal, async (consumer, sourceSignal) => {
          const activeSignal = AbortSignal.any([abort.signal, sourceSignal]);
          if (!isSpeechAudioHeader(consumer.header)) throw new KernelFault('unavailable');
          const header = JSON.stringify(consumer.header);
          if (Buffer.byteLength(header) > SPEECH_AUDIO_HEADER_MAX_BYTES)
            throw new KernelFault('quota-exceeded');
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            [SPEECH_AUDIO_HEADER]: header,
          });
          response.flushHeaders();
          try {
            for await (const bytes of consumer.audio) {
              activeSignal.throwIfAborted();
              if (!response.write(bytes)) {
                const socket = response.socket;
                const oldTimeout = socket?.timeout ?? 0;
                const stalled = (): void => abort.abort();
                // Socket inactivity observes real I/O progress; elapsed time in a healthy write is not a stall.
                socket?.once('timeout', stalled);
                socket?.setTimeout(SPEECH_CONSUMER_STALL_TIMEOUT_MS);
                try {
                  await once(response, 'drain', { signal: activeSignal });
                } finally {
                  socket?.off('timeout', stalled);
                  socket?.setTimeout(oldTimeout);
                }
              }
            }
          } catch (error) {
            response.destroy();
            throw error;
          }
        });
        // SharedSpeechOutput has already published verified terminal before this EOF.
        response.end();
      } finally {
        response.off('close', close);
        request.off('error', failed);
      }
      return true;
    }
  }
  if (
    method === 'POST' &&
    ['/api/speech/provider', '/api/speech/credential', '/api/speech/utterances'].includes(path)
  ) {
    query(url, []);
    if (path === '/api/speech/credential' && !writable) throw new KernelFault('permission-denied');
    const value = await json();
    if (path === '/api/speech/utterances') {
      send(response, 201, { ok: true, value: await speech.begin(value) });
      return true;
    }
    const view =
      path === '/api/speech/provider'
        ? await speech.saveProvider(value)
        : await speech.credential(value);
    send(response, 200, { ok: true, value: ingress(view, writable) });
    return true;
  }
  throw new KernelFault('invalid-input');
}
