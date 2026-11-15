import type { IncomingMessage, ServerResponse } from 'node:http';
import { makeError, VOICE_MAX_SAMPLES, type Result, type VoiceView } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { voiceObject, voiceResultKey, type VoiceController } from './voice-controller.js';

const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
function query(url: URL, keys: readonly string[]): Record<string, string> {
  if ([...url.searchParams.keys()].sort().join(',') !== [...keys].sort().join(','))
    throw new KernelFault('invalid-input');
  return Object.fromEntries(url.searchParams);
}
function ingress(view: VoiceView, writable: boolean): VoiceView {
  return {
    ...view,
    providers: view.providers.map((provider) => ({
      ...provider,
      credential: { ...provider.credential, writable: provider.credential.writable && writable },
    })),
  };
}
function header(request: IncomingMessage, name: string): string {
  let count = 0;
  for (let at = 0; at < request.rawHeaders.length; at += 2)
    if (request.rawHeaders[at]?.toLowerCase() === name) count++;
  const value = request.headers[name];
  if (count !== 1 || typeof value !== 'string') throw new KernelFault('invalid-input');
  return value;
}
/** Owns an IncomingMessage iterator; cancellation destroys the actual pending body read. */
function pcm(request: IncomingMessage): AsyncIterable<Uint8Array> {
  const iterator = request[Symbol.asyncIterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const next = await iterator.next();
          if (next.done) return { done: true as const, value: undefined };
          const value: unknown = next.value;
          if (!(value instanceof Uint8Array)) throw new KernelFault('audio-format');
          return { done: false as const, value };
        },
        async return() {
          if (!request.complete) request.destroy();
          await iterator.return?.();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}
export async function voiceHttp(input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  writable: boolean;
  voice: VoiceController;
  body: (request: IncomingMessage) => Promise<unknown>;
  send: <T>(response: ServerResponse, status: number, result: Result<T>) => void;
}): Promise<boolean> {
  const { request, response, url, writable, voice, body, send } = input;
  if (!url.pathname.startsWith('/api/voice')) return false;
  const method = request.method ?? 'GET',
    path = url.pathname;
  if (method === 'GET' && path === '/api/voice') {
    query(url, []);
    send(response, 200, { ok: true, value: ingress(await voice.view(), writable) });
    return true;
  }
  if (method === 'GET' && path === '/api/voice/catalog') {
    const q = query(url, ['providerRef', 'bindingId']);
    if (!q['providerRef'] || !id(q['bindingId'])) throw new KernelFault('invalid-input');
    const abort = new AbortController(),
      closed = () => {
        if (!response.writableFinished) abort.abort();
      };
    response.once('close', closed);
    try {
      send(response, 200, {
        ok: true,
        value: await voice.catalog(q['providerRef'], q['bindingId'], abort.signal),
      });
    } catch (error) {
      if (error instanceof KernelFault && ['invalid-input', 'conflict'].includes(error.error.code))
        throw error;
      send(response, 200, {
        ok: false,
        error: error instanceof KernelFault ? error.error : makeError('internal', false),
      });
    } finally {
      response.off('close', closed);
    }
    return true;
  }
  const match =
    /^\/api\/voice\/captures\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(?:\/(audio|cancel))?$/.exec(path);
  if (match?.[1]) {
    const captureId = match[1];
    if (method === 'GET' && !match[2]) {
      const key = voiceResultKey({
        ...query(url, ['clientId', 'agentId', 'serviceEpoch']),
        captureId,
      });
      send(response, 200, { ok: true, value: await voice.result(key) });
      return true;
    }
    if (method === 'POST' && match[2] === 'cancel') {
      query(url, []);
      const record = voiceObject(await body(request), ['clientId', 'agentId', 'serviceEpoch']);
      send(response, 200, {
        ok: true,
        value: await voice.cancel(voiceResultKey({ ...record, captureId })),
      });
      return true;
    }
    if (method === 'POST' && match[2] === 'audio') {
      query(url, []);
      if (header(request, 'content-type') !== 'application/octet-stream')
        throw new KernelFault('invalid-input');
      const key = voiceResultKey({
        captureId,
        clientId: header(request, 'x-pet-voice-client'),
        agentId: header(request, 'x-pet-voice-agent'),
        serviceEpoch: header(request, 'x-pet-voice-epoch'),
      });
      const sampleHeader = header(request, 'x-pet-voice-samples');
      if (!/^(?:0|[1-9][0-9]{0,5})$/.test(sampleHeader) || Number(sampleHeader) > VOICE_MAX_SAMPLES)
        throw new KernelFault('invalid-input');
      const samples = Number(sampleHeader),
        length = request.headers['content-length'];
      if (
        length !== undefined &&
        (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) !== samples * 4)
      )
        throw new KernelFault('audio-format');
      const abort = new AbortController();
      const closed = () => {
        if (!response.writableFinished) abort.abort();
      };
      const failed = () => abort.abort();
      response.once('close', closed);
      request.once('aborted', failed);
      request.once('error', failed);
      try {
        send(response, 200, {
          ok: true,
          value: await voice.upload(key, samples, pcm(request), abort.signal),
        });
      } finally {
        response.off('close', closed);
        request.off('aborted', failed);
        request.off('error', failed);
      }
      return true;
    }
  }
  if (
    method === 'POST' &&
    [
      '/api/voice/settings',
      '/api/voice/provider',
      '/api/voice/credential',
      '/api/voice/captures',
    ].includes(path)
  ) {
    query(url, []);
    if (path === '/api/voice/credential' && !writable) throw new KernelFault('permission-denied');
    const value = await body(request);
    if (path === '/api/voice/captures') {
      send(response, 201, { ok: true, value: await voice.begin(value) });
      return true;
    }
    const view =
      path === '/api/voice/settings'
        ? await voice.saveSettings(value)
        : path === '/api/voice/provider'
          ? await voice.saveProvider(value)
          : await voice.credential(value);
    send(response, 200, { ok: true, value: ingress(view, writable) });
    return true;
  }
  throw new KernelFault('invalid-input');
}
