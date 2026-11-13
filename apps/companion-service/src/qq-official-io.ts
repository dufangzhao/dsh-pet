import WebSocket from 'ws';
import {
  isQQSourceSettings,
  makeError,
  QQ_OFFICIAL_CREDENTIAL_ID,
  type QQOfficialSettings,
  type Result,
} from '@pet/contracts';
import { KernelFault, SecretRedactor } from '@pet/host-kernel';
import type { CompanionPluginHost, QQIoOutcome } from '@pet/companion-runtime';
import type {
  OfficialGateway,
  OfficialHttpResponse,
  OfficialIo,
} from '../../../plugins/qq-official/src/ports.js';
import {
  decodeOfficialTokenResponse,
  encodeOfficialHeartbeat,
  encodeOfficialIdentify,
  encodeOfficialMediaUpload,
  encodeOfficialMessage,
  encodeOfficialResume,
  encodeOfficialTokenRequest,
  type OfficialMessageRequest,
} from '../../../plugins/qq-official/src/wire.js';
import {
  createQqAuthority,
  isQqEgressPostflightFailure,
  type CapturedQqBinding,
} from './qq-native-types.js';
import { ownedQqSocket } from './qq-socket.js';
import { createOfficialMediaIo, type OfficialAttachmentTestHooks } from './qq-official-media-io.js';

const API = 'https://api.bot.qq.com';
const MAX_BYTES = 64 * 1024;
/** Injection is host-private and is intended solely for controlled protocol tests. */
export interface OfficialIoTestHooks {
  readonly fetch?: typeof fetch;
  readonly websocket?: (url: string) => WebSocket;
  readonly attachment?: OfficialAttachmentTestHooks;
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new KernelFault(result.error.code);
  return result.value;
}
async function readBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new KernelFault('quota-exceeded');
      chunks.push(next.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function validateRequest(
  request: OfficialMessageRequest,
  kind: 'send' | 'upload',
): OfficialMessageRequest {
  const match = /^\/v2\/(users|groups)\/([^/]+)\/(messages|files)$/u.exec(request.path);
  if (!match || match[3] !== (kind === 'send' ? 'messages' : 'files'))
    throw new KernelFault('invalid-input');
  let target: string;
  try {
    target = decodeURIComponent(match[2] ?? '');
  } catch {
    throw new KernelFault('invalid-input');
  }
  const scene = match[1] === 'users' ? 'c2c' : 'group';
  const parsed =
    kind === 'send'
      ? encodeOfficialMessage(scene, target, request.body)
      : encodeOfficialMediaUpload(scene, target, request.body);
  const value = unwrap(parsed);
  if (value.path !== request.path) throw new KernelFault('invalid-input');
  return value;
}

export function createAuthorizedOfficialIo(
  host: CompanionPluginHost,
  binding: CapturedQqBinding<QQOfficialSettings>,
  test: OfficialIoTestHooks = {},
): OfficialIo {
  if (
    !isQQSourceSettings(binding.settings) ||
    binding.settings.protocol !== 'official' ||
    !binding.settings.appId
  )
    throw new KernelFault('invalid-input');
  const settings = { ...binding.settings, scenes: [...binding.settings.scenes] };
  const authority = createQqAuthority(host, binding, QQ_OFFICIAL_CREDENTIAL_ID);
  const nativeFetch = test.fetch ?? fetch;
  const sockets = new Set<OfficialGateway>();
  let closing: Promise<void> | undefined;
  let closed = false;
  const request = async (url: string, init: RequestInit): Promise<OfficialHttpResponse> => {
    const deadline = AbortSignal.timeout(30000);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    try {
      const response = await nativeFetch(url, {
        ...init,
        signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      return { status: response.status, body: await readBody(response) };
    } catch (error) {
      if (deadline.aborted) throw new KernelFault('timeout');
      throw error;
    }
  };
  const accessToken = async (secret: string, signal: AbortSignal): Promise<string> => {
    const payload = unwrap(encodeOfficialTokenRequest(settings.appId, secret));
    const response = await request(`${API}/app/getAppAccessToken`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return unwrap(decodeOfficialTokenResponse(response.status, response.body)).access_token;
  };
  const safeText = (text: string, ...secrets: string[]): void => {
    const redactor = new SecretRedactor();
    for (const secret of secrets) redactor.add(secret);
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      /* Non-JSON is still checked as text. */
    }
    if (redactor.containsValue(parsed)) throw new KernelFault('permission-denied');
  };
  const media = createOfficialMediaIo({
    settings,
    fetch: nativeFetch,
    ...(test.attachment ? { attachmentTest: test.attachment } : {}),
    check: authority.check,
    fence: authority.fence,
    token: accessToken,
    safe: safeText,
    read: readBody,
    run: authority.run,
  });
  const http = async (
    kind: 'send' | 'upload',
    raw: OfficialMessageRequest,
    signal: AbortSignal,
  ): Promise<QQIoOutcome<OfficialHttpResponse>> => {
    let dispatched = false;
    let observed: OfficialHttpResponse | undefined;
    try {
      const parsed = validateRequest(raw, kind);
      const scene = parsed.path.startsWith('/v2/users/') ? 'private' : 'group';
      if (!settings.scenes.includes(scene)) throw new KernelFault('permission-denied');
      const value = await authority.run(signal, async (secret, live) => {
        const token = await accessToken(secret, live);
        await authority.check();
        if (live.aborted) throw new KernelFault('cancelled');
        safeText(JSON.stringify(parsed.body), secret, token);
        dispatched = true;
        const response = await request(`${API}${parsed.path}`, {
          method: 'POST',
          signal: live,
          headers: {
            Authorization: `QQBot ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Union-Appid': settings.appId,
          },
          body: JSON.stringify(parsed.body),
        });
        safeText(response.body, secret, token);
        observed = response;
        return response;
      });
      return { ok: true, value };
    } catch (error) {
      if (dispatched && observed && isQqEgressPostflightFailure(error)) {
        authority.fence();
        return { ok: true, value: observed };
      }
      return {
        ok: false,
        error:
          error instanceof KernelFault
            ? error.error
            : makeError(signal.aborted ? 'cancelled' : 'network'),
        dispatched,
      };
    }
  };
  return {
    media,
    openGateway(signal) {
      if (closed) return Promise.reject(new KernelFault('cancelled'));
      let resolveReady: (gateway: OfficialGateway) => void = () => {};
      let rejectReady: (error: unknown) => void = () => {};
      const ready = new Promise<OfficialGateway>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const work = authority.run(signal, async (secret, live) => {
        const token = await accessToken(secret, live);
        const response = await request(`${API}/gateway`, {
          method: 'GET',
          signal: live,
          headers: {
            Authorization: `QQBot ${token}`,
            Accept: 'application/json',
            'X-Union-Appid': settings.appId,
          },
        });
        if (response.status !== 200)
          throw new KernelFault(
            response.status === 401 || response.status === 403 ? 'auth-failed' : 'unavailable',
          );
        let gatewayUrl: URL;
        try {
          const payload = JSON.parse(response.body) as { url?: unknown };
          if (typeof payload.url !== 'string') throw new Error();
          gatewayUrl = new URL(payload.url);
        } catch {
          throw new KernelFault('invalid-input');
        }
        if (
          gatewayUrl.protocol !== 'wss:' ||
          gatewayUrl.username ||
          gatewayUrl.password ||
          !(gatewayUrl.hostname === 'qq.com' || gatewayUrl.hostname.endsWith('.qq.com'))
        )
          throw new KernelFault('permission-denied');
        await authority.check();
        if (live.aborted) throw new KernelFault('cancelled');
        const socket = test.websocket
          ? test.websocket(gatewayUrl.href)
          : new WebSocket(gatewayUrl.href, {
              perMessageDeflate: false,
              maxPayload: MAX_BYTES,
              handshakeTimeout: 30000,
            });
        await new Promise<void>((resolve, reject) => {
          const abort = (): void => {
            if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
          };
          const opened = (): void => {
            cleanup();
            resolve();
          };
          // A handshake error is logical; only close confirms the socket actually settled.
          const errored = (): void => {
            abort();
          };
          const finished = (): void => {
            cleanup();
            reject(new KernelFault(live.aborted ? 'cancelled' : 'network'));
          };
          const cleanup = (): void => {
            live.removeEventListener('abort', abort);
            socket.off('open', opened);
            socket.off('error', errored);
            socket.off('close', finished);
          };
          socket.once('open', opened);
          socket.on('error', errored);
          socket.once('close', finished);
          live.addEventListener('abort', abort, { once: true });
          if (live.aborted) abort();
        });
        const owned = ownedQqSocket(socket, live, authority.check);
        try {
          await authority.check();
          if (live.aborted) throw new KernelFault('cancelled');
        } catch (error) {
          await owned.close();
          throw error;
        }
        const frameStream: AsyncIterable<string> = {
          async *[Symbol.asyncIterator]() {
            for await (const frame of owned.frames) {
              safeText(frame, secret, token);
              yield frame;
            }
          },
        };
        const gateway: OfficialGateway = {
          id: owned.id,
          signal: owned.signal,
          frames: frameStream,
          settled: work.then(
            () => {},
            () => {},
          ),
          identify: (caller) =>
            owned.send(JSON.stringify(unwrap(encodeOfficialIdentify(token))), caller),
          resume: (input, caller) =>
            owned.send(
              JSON.stringify(unwrap(encodeOfficialResume(token, input.sessionId, input.sequence))),
              caller,
            ),
          heartbeat: (sequence, caller) =>
            owned.send(JSON.stringify(unwrap(encodeOfficialHeartbeat(sequence))), caller),
          close: () => owned.close(),
        };
        sockets.add(gateway);
        resolveReady(gateway);
        try {
          await owned.settled;
        } finally {
          sockets.delete(gateway);
          await owned.close();
        }
      });
      void work.catch(rejectReady);
      return ready;
    },
    send: (request, signal) => http('send', request, signal),
    upload: (request, signal) => http('upload', request, signal),
    close() {
      closing ??= (async () => {
        closed = true;
        await Promise.allSettled([...sockets].map((socket) => socket.close()));
        await authority.close();
        media.close();
      })();
      return closing;
    },
  };
}
