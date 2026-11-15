import { Readable } from 'node:stream';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { finished } from 'node:stream/promises';
import {
  COMPANION_MATERIAL_FILE_MAX_BYTES,
  MEDIA_MAX_CHUNK_BYTES,
  makeError,
  type QQOfficialSettings,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { QQIoOutcome, QQMediaRead } from '@pet/companion-runtime';
import type { OfficialMediaIo, OfficialHttpResponse } from '@pet/qq-official';
import { isQqEgressPostflightFailure } from './qq-native-types.js';
import { decodeOfficialHttpReceipt } from '@pet/qq-official';
import {
  decodeOfficialPrepared,
  isOfficialPartFinished,
  officialMediaPath,
  officialPrepareBody,
  OFFICIAL_INLINE_MEDIA_MAX_BYTES,
  validOfficialMediaMetadata,
  type OfficialMediaMetadata,
  type OfficialMediaRoute,
} from '@pet/qq-official/media-wire';

export interface AttachmentAddress {
  readonly address: string;
  readonly family: 4 | 6;
}
export interface OpenedAttachment {
  readonly response: IncomingMessage;
  readonly closed: Promise<void>;
  abort(): void;
}
/** Test-only hooks; the captured URL is still validated before either hook runs. */
export interface OfficialAttachmentTestHooks {
  lookup(hostname: string): Promise<readonly AttachmentAddress[]>;
  open(url: URL, address: AttachmentAddress, signal: AbortSignal): Promise<OpenedAttachment>;
}
export interface CapturedOfficialAttachment extends OfficialMediaRoute {
  readonly url: string;
  readonly maximumBytes: number;
}
/** Host-bound material grant check; never provided by a model or HTTP caller. */
export type OfficialAttachmentCheck = () => Promise<void>;
const API = 'https://api.bot.qq.com';
interface Part {
  readonly url: string;
  readonly size: number;
  putAttempted: boolean;
  putConfirmed: boolean;
  finishAttempted: boolean;
  finishConfirmed: boolean;
}
interface Upload {
  readonly route: string;
  readonly metadata: OfficialMediaMetadata;
  readonly blockSize: number;
  readonly parts: Map<number, Part>;
  commitAttempted: boolean;
}
export interface OfficialMediaHostPorts {
  readonly settings: QQOfficialSettings;
  readonly fetch: typeof fetch;
  readonly attachmentTest?: OfficialAttachmentTestHooks;
  check(): Promise<void>;
  checkOperation(signal: AbortSignal): Promise<number | null>;
  assertOperation(signal: AbortSignal, deadline: number | null): void;
  fence(): void;
  token(secret: string, signal: AbortSignal): Promise<string>;
  safe(text: string, ...secrets: string[]): void;
  read(response: Response): Promise<string>;
  run<T>(
    signal: AbortSignal,
    operation: (secret: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
}
const routeKey = (route: OfficialMediaRoute): string =>
  JSON.stringify([route.scene, route.targetId]);
const excluded = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  excluded.addSubnet(address, prefix, 'ipv4');
excluded.addSubnet('2001::', 23, 'ipv6');
excluded.addSubnet('2001:db8::', 32, 'ipv6');
excluded.addSubnet('2002::', 16, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
function publicAddress(value: AttachmentAddress): boolean {
  if (isIP(value.address) !== value.family) return false;
  if (value.family === 4) return !excluded.check(value.address, 'ipv4');
  return globalV6.check(value.address, 'ipv6') && !excluded.check(value.address, 'ipv6');
}
function officialCdn(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new KernelFault('invalid-input');
  }
  const host = url.hostname.toLowerCase();
  const trusted = ['qq.com', 'qq.com.cn', 'qpic.cn', 'gtimg.cn'].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (
    url.protocol !== 'https:' ||
    !trusted ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new KernelFault('permission-denied');
  return url;
}
async function resolveAttachment(hostname: string): Promise<readonly AttachmentAddress[]> {
  const values = await dnsLookup(hostname, { all: true, verbatim: true });
  return values.filter(
    (value): value is AttachmentAddress => value.family === 4 || value.family === 6,
  );
}
async function openAttachment(
  url: URL,
  address: AttachmentAddress,
  signal: AbortSignal,
): Promise<OpenedAttachment> {
  return new Promise<OpenedAttachment>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'GET',
      agent: false,
      signal,
      family: address.family,
      headers: { Accept: '*/*' },
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    });
    let closeRequest: () => void = () => {};
    let closeSocket: () => void = () => {};
    let socketSeen = false;
    let responseSeen = false;
    const requestClosed = new Promise<void>((done) => {
      closeRequest = done;
    });
    const socketClosed = new Promise<void>((done) => {
      closeSocket = done;
    });
    req.once('socket', (socket) => {
      socketSeen = true;
      if (socket.destroyed) closeSocket();
      else socket.once('close', () => closeSocket());
    });
    req.once('close', () => {
      closeRequest();
      if (!socketSeen) closeSocket();
      if (!responseSeen)
        void closed.then(() => reject(new KernelFault(signal.aborted ? 'cancelled' : 'network')));
    });
    const closed = Promise.all([requestClosed, socketClosed]).then(() => {});
    req.once('error', () => {
      void closed.then(() => reject(new KernelFault(signal.aborted ? 'cancelled' : 'network')));
    });
    req.once('response', (response) => {
      responseSeen = true;
      resolve({
        response,
        closed,
        abort: () => {
          response.destroy();
          req.destroy();
        },
      });
    });
    req.end();
  });
}
const outcomeError = (
  error: unknown,
  signal: AbortSignal,
  dispatched: boolean,
): QQIoOutcome<never> => ({
  ok: false,
  error:
    error instanceof KernelFault
      ? error.error
      : makeError(signal.aborted ? 'cancelled' : 'network'),
  dispatched,
});

/** Each iterator is single-use and drained or cancelled before the native request settles. */
async function* exactBytes(
  body: AsyncIterable<Uint8Array>,
  size: number,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of body) {
    if (signal.aborted) throw new KernelFault('cancelled');
    if (!(chunk instanceof Uint8Array) || !chunk.byteLength) throw new KernelFault('invalid-input');
    total += chunk.byteLength;
    if (total > size) throw new KernelFault('quota-exceeded');
    yield chunk;
  }
  if (total !== size) throw new KernelFault('invalid-input');
}
async function* inlineBody(
  metadata: OfficialMediaMetadata,
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const header = JSON.stringify({
    file_type: metadata.file_type,
    file_name: metadata.file_name,
    srv_send_msg: false,
  });
  yield Buffer.from(`${header.slice(0, -1)},"file_data":"`);
  let remainder = Buffer.alloc(0);
  for await (const chunk of exactBytes(body, metadata.sizeBytes, signal)) {
    const data = Buffer.concat([remainder, Buffer.from(chunk)]);
    const length = data.length - (data.length % 3);
    if (length) yield Buffer.from(data.subarray(0, length).toString('base64'));
    remainder = Buffer.from(data.subarray(length));
  }
  if (remainder.length) yield Buffer.from(remainder.toString('base64'));
  yield Buffer.from('"}');
}

export function createOfficialMediaIo(ports: OfficialMediaHostPorts): OfficialMediaIo & {
  close(): void;
  readAttachment(
    input: CapturedOfficialAttachment,
    signal: AbortSignal,
    check: OfficialAttachmentCheck,
  ): Promise<QQMediaRead>;
} {
  const uploads = new Map<string, Upload>();
  const uploadKey = (route: OfficialMediaRoute, id: string): string =>
    JSON.stringify([routeKey(route), id]);
  const allowed = (metadata: OfficialMediaMetadata): void => {
    if (
      !validOfficialMediaMetadata(metadata) ||
      !ports.settings.scenes.includes(metadata.scene === 'c2c' ? 'private' : 'group')
    )
      throw new KernelFault('invalid-input');
  };
  const authHeaders = (token: string): Record<string, string> => ({
    Authorization: `QQBot ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Union-Appid': ports.settings.appId,
  });
  const request = async (
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    dispatch: () => void,
  ): Promise<OfficialHttpResponse> => {
    const deadline = AbortSignal.timeout(30000);
    const live = AbortSignal.any([signal, deadline]);
    if (live.aborted) throw new KernelFault('cancelled');
    const operationDeadline = await ports.checkOperation(live);
    await ports.check();
    if (live.aborted) throw new KernelFault('cancelled');
    ports.assertOperation(live, operationDeadline);
    dispatch();
    const response = await ports.fetch(url, {
      ...init,
      signal: live,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    return { status: response.status, body: await ports.read(response) };
  };
  const streamRequest = async (
    method: 'POST' | 'PUT',
    url: string,
    headers: Record<string, string>,
    body: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
    dispatch: () => void,
  ): Promise<OfficialHttpResponse> => {
    const deadline = AbortSignal.timeout(30000);
    const live = AbortSignal.any([signal, deadline]);
    const stream = Readable.from(body, { objectMode: false, highWaterMark: 64 * 1024 });
    const settled = finished(stream, { cleanup: true });
    void settled.catch(() => {});
    const abort = (): void => {
      stream.destroy(new KernelFault(deadline.aborted ? 'timeout' : 'cancelled'));
    };
    live.addEventListener('abort', abort, { once: true });
    try {
      if (live.aborted) throw new KernelFault('cancelled');
      const operationDeadline = await ports.checkOperation(live);
      await ports.check();
      if (live.aborted) throw new KernelFault('cancelled');
      ports.assertOperation(live, operationDeadline);
      dispatch();
      const response = await ports.fetch(url, {
        method,
        headers,
        body: stream as unknown as NonNullable<RequestInit['body']>,
        signal: live,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      const text = await ports.read(response);
      await settled;
      return { status: response.status, body: text };
    } finally {
      live.removeEventListener('abort', abort);
      if (!stream.destroyed) stream.destroy();
      await settled.catch(() => {});
    }
  };
  const find = (route: OfficialMediaRoute, id: string): Upload => {
    const upload = uploads.get(uploadKey(route, id));
    if (!upload || upload.route !== routeKey(route)) throw new KernelFault('permission-denied');
    return upload;
  };
  const execute = async <T>(
    signal: AbortSignal,
    operation: (secret: string, live: AbortSignal, dispatch: () => void) => Promise<T>,
  ): Promise<QQIoOutcome<T>> => {
    let dispatched = false;
    let observed: { value: T } | undefined;
    try {
      const value = await ports.run(signal, async (secret, live) => {
        const result = await operation(secret, live, () => {
          dispatched = true;
        });
        observed = { value: result };
        return result;
      });
      return { ok: true, value };
    } catch (error) {
      if (dispatched && observed && isQqEgressPostflightFailure(error)) {
        ports.fence();
        return { ok: true, value: observed.value };
      }
      return outcomeError(error, signal, dispatched);
    }
  };
  return {
    readAttachment(input, caller, grantCheck) {
      if (!input || typeof input !== 'object')
        return Promise.reject(new KernelFault('invalid-input'));
      if (
        typeof grantCheck !== 'function' ||
        !Number.isSafeInteger(input.maximumBytes) ||
        input.maximumBytes < 1 ||
        input.maximumBytes > COMPANION_MATERIAL_FILE_MAX_BYTES
      )
        return Promise.reject(new KernelFault('invalid-input'));
      let url: URL;
      try {
        url = officialCdn(input.url);
        officialMediaPath(input, 'files');
        if (!ports.settings.scenes.includes(input.scene === 'c2c' ? 'private' : 'group'))
          throw new KernelFault('permission-denied');
      } catch (error) {
        return Promise.reject(
          error instanceof KernelFault ? error : new KernelFault('invalid-input'),
        );
      }
      let resolveReady: (read: QQMediaRead) => void = () => {};
      let rejectReady: (error: unknown) => void = () => {};
      const ready = new Promise<QQMediaRead>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const work = ports.run(caller, async (secret, sourceSignal) => {
        ports.safe(input.url, secret);
        const abort = new AbortController();
        const deadline = AbortSignal.timeout(30000);
        const signal = AbortSignal.any([sourceSignal, abort.signal, deadline]);
        const check = async (): Promise<void> => {
          if (signal.aborted) throw new KernelFault(deadline.aborted ? 'timeout' : 'cancelled');
          await ports.check();
          try {
            if (typeof grantCheck === 'function') await grantCheck();
          } catch {
            throw new KernelFault('permission-denied');
          }
          if (signal.aborted) throw new KernelFault('cancelled');
        };
        await check();
        const addresses = await (ports.attachmentTest?.lookup(url.hostname) ??
          resolveAttachment(url.hostname));
        if (!addresses.length || addresses.some((address) => !publicAddress(address)))
          throw new KernelFault('permission-denied');
        const selected = addresses[0];
        if (!selected) throw new KernelFault('unavailable');
        const operationDeadline = await ports.checkOperation(signal);
        await check();
        ports.assertOperation(signal, operationDeadline);
        const opened = await (ports.attachmentTest?.open(url, selected, signal) ??
          openAttachment(url, selected, signal));
        const response = opened.response;
        if (response.statusCode !== 200) {
          opened.abort();
          await opened.closed;
          throw new KernelFault(
            response.statusCode === 401 || response.statusCode === 403
              ? 'auth-failed'
              : 'unavailable',
          );
        }
        const declared = response.headers['content-length'];
        if (
          declared !== undefined &&
          (!/^(0|[1-9]\d*)$/u.test(declared) || Number(declared) > input.maximumBytes)
        ) {
          opened.abort();
          await opened.closed;
          throw new KernelFault('quota-exceeded');
        }
        const iterator = response[Symbol.asyncIterator]();
        let pending: Promise<IteratorResult<unknown>> | undefined;
        let releasing: Promise<void> | undefined;
        let failure: KernelFault | undefined;
        let done: () => void = () => {};
        const completed = new Promise<void>((resolve) => {
          done = resolve;
        });
        const release = (): Promise<void> =>
          (releasing ??= Promise.resolve().then(async () => {
            let cleanupError: unknown;
            abort.abort();
            try {
              opened.abort();
            } catch (error) {
              cleanupError = error;
            }
            await pending?.catch(() => {});
            try {
              await iterator.return?.();
            } catch {
              /* The socket may already be aborted. */
            }
            try {
              await opened.closed;
            } catch (error) {
              cleanupError ??= error;
            } finally {
              done();
            }
            if (cleanupError !== undefined) throw new KernelFault('unavailable');
          }));
        const onAbort = (): void => {
          void release().catch(() => {});
        };
        signal.addEventListener('abort', onAbort, { once: true });
        let consumed = false;
        let bytes = 0;
        const settled = work.then(() => {});
        void settled.catch(() => {});
        resolveReady({
          body: {
            [Symbol.asyncIterator]() {
              if (consumed) throw new KernelFault('conflict');
              consumed = true;
              return {
                async next() {
                  try {
                    await check();
                    pending = iterator.next();
                    const next = await pending;
                    pending = undefined;
                    await check();
                    if (next.done) {
                      await release();
                      return { done: true as const, value: undefined };
                    }
                    if (!(next.value instanceof Uint8Array)) throw new KernelFault('invalid-input');
                    if (!next.value.byteLength || next.value.byteLength > MEDIA_MAX_CHUNK_BYTES)
                      throw new KernelFault('quota-exceeded');
                    bytes += next.value.byteLength;
                    if (bytes > input.maximumBytes) throw new KernelFault('quota-exceeded');
                    return { done: false as const, value: new Uint8Array(next.value) };
                  } catch (error) {
                    failure =
                      error instanceof KernelFault
                        ? error
                        : new KernelFault(signal.aborted ? 'cancelled' : 'network');
                    await release();
                    throw failure;
                  }
                },
                async return() {
                  await release();
                  return { done: true as const, value: undefined };
                },
              };
            },
          },
          settled,
          cancel: () => {
            void release().catch(() => {});
          },
        });
        if (signal.aborted) onAbort();
        try {
          await completed;
          if (failure) throw failure;
        } finally {
          signal.removeEventListener('abort', onAbort);
          await release();
        }
      });
      void work.catch((error: unknown) =>
        rejectReady(error instanceof KernelFault ? error : new KernelFault('network')),
      );
      return ready;
    },
    close() {
      uploads.clear();
    },
    inline(input, body, signal) {
      return execute(signal, async (secret, live, dispatch) => {
        const { srv_send_msg, ...metadata } = input;
        allowed(metadata);
        if (srv_send_msg !== false || metadata.sizeBytes > OFFICIAL_INLINE_MEDIA_MAX_BYTES)
          throw new KernelFault('invalid-input');
        const token = await ports.token(secret, live);
        await ports.check();
        if (live.aborted) throw new KernelFault('cancelled');
        ports.safe(JSON.stringify(metadata), secret, token);
        const payload = inlineBody(metadata, body, live);
        const url = `${API}${officialMediaPath(metadata, 'files')}`;
        const response = await streamRequest(
          'POST',
          url,
          authHeaders(token),
          payload,
          live,
          dispatch,
        );
        ports.safe(response.body, secret, token);
        return response;
      });
    },
    prepare(metadata, hashes, signal) {
      return execute(signal, async (secret, live, dispatch) => {
        allowed(metadata);
        if (metadata.sizeBytes === 0) throw new KernelFault('invalid-input');
        const encoded = officialPrepareBody(metadata, hashes);
        if (!encoded.ok) throw new KernelFault(encoded.error.code);
        const token = await ports.token(secret, live);
        await ports.check();
        if (live.aborted) throw new KernelFault('cancelled');
        ports.safe(JSON.stringify({ metadata, hashes }), secret, token);
        const response = await request(
          `${API}${officialMediaPath(metadata, 'upload_prepare')}`,
          { method: 'POST', headers: authHeaders(token), body: JSON.stringify(encoded.value) },
          live,
          dispatch,
        );
        ports.safe(response.body, secret, token);
        const decoded = decodeOfficialPrepared(response, metadata.sizeBytes);
        if (!decoded.ok) {
          const receipt = decodeOfficialHttpReceipt(response.status, response.body, 'media-upload');
          return receipt.kind === 'rejected' || receipt.kind === 'unknown'
            ? receipt
            : {
                kind: 'unknown' as const,
                httpStatus: response.status,
                reason: 'invalid-response' as const,
              };
        }
        const key = uploadKey(metadata, decoded.value.upload_id);
        if (uploads.has(key) || uploads.size >= 16) throw new KernelFault('conflict');
        uploads.set(key, {
          route: routeKey(metadata),
          metadata: structuredClone(metadata),
          blockSize: decoded.value.block_size,
          parts: new Map(
            decoded.value.parts.map((part) => [
              part.index,
              {
                url: part.presigned_url,
                size: part.byteLength,
                putAttempted: false,
                putConfirmed: false,
                finishAttempted: false,
                finishConfirmed: false,
              },
            ]),
          ),
          commitAttempted: false,
        });
        // Presigned URLs stay in this host closure; the driver receives only part geometry.
        return {
          kind: 'prepared' as const,
          plan: {
            upload_id: decoded.value.upload_id,
            block_size: decoded.value.block_size,
            parts: decoded.value.parts.map((part) => ({
              index: part.index,
              offset: part.offset,
              byteLength: part.byteLength,
            })),
          },
        };
      });
    },
    putPart(input, body, signal) {
      return execute(signal, async (secret, live, dispatch) => {
        const upload = find(input, input.upload_id);
        const part = upload.parts.get(input.part_index);
        if (!part || part.putAttempted || input.byteLength !== part.size)
          throw new KernelFault('conflict');
        await ports.check();
        if (live.aborted) throw new KernelFault('cancelled');
        // Provider-issued presigned target only: never attach QQ authorization or follow redirects.
        const response = await streamRequest(
          'PUT',
          part.url,
          { 'Content-Length': String(part.size), 'Content-Type': 'application/octet-stream' },
          exactBytes(body, part.size, live),
          live,
          () => {
            if (part.putAttempted) throw new KernelFault('conflict');
            part.putAttempted = true;
            dispatch();
          },
        );
        ports.safe(response.body, secret);
        if ([200, 201, 204].includes(response.status)) part.putConfirmed = true;
        return { status: response.status, body: '' };
      }).then((result) => {
        if (
          (!result.ok && result.dispatched) ||
          (result.ok && ![200, 201, 204].includes(result.value.status))
        )
          uploads.delete(uploadKey(input, input.upload_id));
        return result;
      });
    },
    finishPart(input, signal) {
      return execute(signal, async (secret, live, dispatch) => {
        const upload = find(input, input.upload_id);
        const part = upload.parts.get(input.part_index);
        if (
          !part ||
          !part.putConfirmed ||
          part.finishAttempted ||
          input.block_size !== String(part.size) ||
          !/^[a-f0-9]{32}$/u.test(input.md5)
        )
          throw new KernelFault('conflict');
        const token = await ports.token(secret, live);
        await ports.check();
        if (live.aborted) throw new KernelFault('cancelled');
        ports.safe(JSON.stringify(input), secret, token);
        const response = await request(
          `${API}${officialMediaPath(input, 'upload_part_finish')}`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              upload_id: input.upload_id,
              part_index: input.part_index,
              block_size: input.block_size,
              md5: input.md5,
            }),
          },
          live,
          () => {
            if (part.finishAttempted) throw new KernelFault('conflict');
            part.finishAttempted = true;
            dispatch();
          },
        );
        ports.safe(response.body, secret, token);
        if (isOfficialPartFinished(response)) part.finishConfirmed = true;
        return response;
      }).then((result) => {
        if (
          (!result.ok && result.dispatched) ||
          (result.ok && !isOfficialPartFinished(result.value))
        )
          uploads.delete(uploadKey(input, input.upload_id));
        return result;
      });
    },
    commit(input, signal) {
      return execute(signal, async (secret, live, dispatch) => {
        const { upload_id, srv_send_msg, ...metadata } = input;
        allowed(metadata);
        const upload = find(metadata, upload_id);
        if (
          srv_send_msg !== false ||
          upload.commitAttempted ||
          !isDeepStrictEqual(upload.metadata, metadata) ||
          [...upload.parts.values()].some((part) => !part.finishConfirmed)
        )
          throw new KernelFault('conflict');
        const token = await ports.token(secret, live);
        await ports.check();
        if (live.aborted) throw new KernelFault('cancelled');
        ports.safe(JSON.stringify(input), secret, token);
        const response = await request(
          `${API}${officialMediaPath(metadata, 'files')}`,
          {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({
              file_type: metadata.file_type,
              file_name: metadata.file_name,
              upload_id,
              srv_send_msg: false,
            }),
          },
          live,
          () => {
            if (upload.commitAttempted) throw new KernelFault('conflict');
            upload.commitAttempted = true;
            dispatch();
          },
        );
        ports.safe(response.body, secret, token);
        return response;
      }).then((result) => {
        if (result.ok || result.dispatched) uploads.delete(uploadKey(input, input.upload_id));
        return result;
      });
    },
  };
}
