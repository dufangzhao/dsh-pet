import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  isQQSourceSettings,
  makeError,
  QQ_ONEBOT_CREDENTIAL_ID,
  type QQOneBotSettings,
} from '@pet/contracts';
import { KernelFault, SecretRedactor } from '@pet/host-kernel';
import type { CompanionPluginHost, QQIoOutcome } from '@pet/companion-runtime';
import type { OneBotIo, OneBotPeer } from '../../../plugins/qq-onebot/src/ports.js';
import { decodeOneBotFrame, encodeOneBotAction } from '../../../plugins/qq-onebot/src/wire.js';
import { SNOW_MEDIA_FRAME_MAX_BYTES } from '../../../plugins/qq-onebot/src/media-wire.js';
import { createQqAuthority, type CapturedQqBinding } from './qq-native-types.js';
import { ownedQqSocket } from './qq-socket.js';
import { createOneBotMediaIo, type OneBotMediaRouter } from './qq-onebot-media-io.js';

/** Private reverse Universal listener. No listener or credential borrow occurs until nextPeer. */
export function createAuthorizedOneBotIo(
  host: CompanionPluginHost,
  binding: CapturedQqBinding<QQOneBotSettings>,
  test?: { readonly onListening: (address: AddressInfo) => void },
): OneBotIo {
  if (
    !isQQSourceSettings(binding.settings) ||
    binding.settings.protocol !== 'onebot-v11' ||
    !binding.settings.accountId
  )
    throw new KernelFault('invalid-input');
  const settings = { ...binding.settings };
  const authority = createQqAuthority(host, binding, QQ_ONEBOT_CREDENTIAL_ID);
  let server: Server | undefined;
  let wsServer: WebSocketServer | undefined;
  let peer: OneBotPeer | undefined;
  let delivered = false;
  let waiting: (() => void) | undefined;
  let running: Promise<void> | undefined;
  let ready: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;
  let runError: unknown;
  const sockets = new Set<Socket>();
  const upgrades = new Set<Promise<void>>();
  const peers = new Set<Promise<void>>();
  const signalWaiter = (): void => {
    waiting?.();
    waiting = undefined;
  };
  const reject = (socket: Socket, status: number): void => {
    if (!socket.destroyed)
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const start = (signal: AbortSignal): Promise<void> => {
    if (ready) return ready;
    let acceptReady = (): void => {};
    let rejectReady = (_error: unknown): void => {};
    ready = new Promise<void>((resolve, rejectPromise) => {
      acceptReady = resolve;
      rejectReady = rejectPromise;
    });
    running = authority.run(signal, async (secret, sourceSignal) => {
      const expected = Buffer.from(`Bearer ${secret}`);
      server = createServer(
        { headersTimeout: 10000, requestTimeout: 15000 },
        (_request, response) => {
          response.writeHead(404);
          response.end();
        },
      );
      server.maxConnections = 16;
      wsServer = new WebSocketServer({
        noServer: true,
        maxPayload: SNOW_MEDIA_FRAME_MAX_BYTES,
        perMessageDeflate: false,
      });
      server.on('connection', (socket: Socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      });
      server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
        const auth = Buffer.from(request.headers.authorization ?? '');
        const role = request.headers['x-client-role'];
        if (
          request.url !== settings.path ||
          request.headers['x-self-id'] !== settings.accountId ||
          typeof role !== 'string' ||
          role.toLowerCase() !== 'universal' ||
          auth.length !== expected.length ||
          !timingSafeEqual(auth, expected)
        ) {
          reject(socket, 403);
          return;
        }
        if (peer) {
          reject(socket, 409);
          return;
        }
        // Reserve before the async source check; duplicate handshakes cannot race.
        const reserved = {} as OneBotPeer;
        peer = reserved;
        socket.once('close', () => {
          if (peer === reserved) {
            peer = undefined;
            signalWaiter();
          }
        });
        const upgrading = (async () => {
          try {
            await authority.check();
            if (sourceSignal.aborted || closed || socket.destroyed || !wsServer)
              throw new KernelFault('cancelled');
            wsServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
              const redactor = new SecretRedactor();
              redactor.add(secret);
              const mediaRef: { current?: OneBotMediaRouter } = {};
              const owned = ownedQqSocket(websocket, sourceSignal, authority.check, {
                maxFrameBytes: SNOW_MEDIA_FRAME_MAX_BYTES,
                routeFrame: (text, size) => mediaRef.current?.route(text, size) ?? false,
              });
              const write = async (
                text: string,
                caller: AbortSignal,
              ): Promise<QQIoOutcome<null>> => {
                let dispatched = false;
                try {
                  await owned.send(text, caller, () => {
                    dispatched = true;
                  });
                  return { ok: true, value: null };
                } catch (error) {
                  return {
                    ok: false,
                    error:
                      error instanceof KernelFault
                        ? error.error
                        : makeError(caller.aborted ? 'cancelled' : 'network'),
                    dispatched,
                  };
                }
              };
              const mediaIo = createOneBotMediaIo({
                socket: websocket,
                signal: AbortSignal.any([sourceSignal, owned.signal]),
                check: authority.check,
                redactor,
                write,
              });
              mediaRef.current = mediaIo;
              let mediaClosing: Promise<void> | undefined;
              const closeMedia = (): Promise<void> => (mediaClosing ??= mediaIo.close());
              owned.signal.addEventListener(
                'abort',
                () => {
                  void closeMedia();
                },
                { once: true },
              );
              const peerSettled = (async () => {
                await owned.settled;
                await closeMedia();
              })();
              const frames: AsyncIterable<string> = {
                async *[Symbol.asyncIterator]() {
                  for await (const text of owned.frames) {
                    const decoded = decodeOneBotFrame(text, settings.accountId);
                    if (!decoded.ok) throw new KernelFault(decoded.error.code);
                    let parsed: unknown;
                    try {
                      parsed = JSON.parse(text) as unknown;
                    } catch {
                      throw new KernelFault('invalid-input');
                    }
                    if (redactor.containsValue(parsed)) throw new KernelFault('permission-denied');
                    yield text;
                  }
                },
              };
              peer = {
                ...owned,
                frames,
                settled: peerSettled,
                selfId: settings.accountId,
                openMedia: (request, signal) => mediaIo.openMedia(request, signal),
                async send(frame, caller): Promise<QQIoOutcome<null>> {
                  const parsed = encodeOneBotAction(frame.action, frame.params, frame.echo);
                  if (!parsed.ok || JSON.stringify(parsed.value) !== JSON.stringify(frame))
                    return { ok: false, error: makeError('invalid-input'), dispatched: false };
                  if (redactor.containsValue(frame))
                    return { ok: false, error: makeError('permission-denied'), dispatched: false };
                  return write(JSON.stringify(frame), caller);
                },
                async close() {
                  await Promise.all([owned.close(), closeMedia()]);
                  await peerSettled;
                },
              };
              delivered = false;
              peers.add(peerSettled);
              void peerSettled.then(() => {
                peers.delete(peerSettled);
                if (peer?.id === owned.id) {
                  peer = undefined;
                  delivered = false;
                  signalWaiter();
                }
              });
              signalWaiter();
            });
          } catch {
            if (peer === reserved) peer = undefined;
            reject(socket, 403);
            signalWaiter();
          }
        })();
        upgrades.add(upgrading);
        void upgrading.finally(() => upgrades.delete(upgrading));
      });
      const stopped = new Promise<void>((resolve) => {
        const abort = (): void => {
          for (const socket of sockets) socket.destroy();
          wsServer?.close();
          if (server?.listening) server.close(() => resolve());
          else resolve();
          signalWaiter();
        };
        sourceSignal.addEventListener('abort', abort, { once: true });
        if (sourceSignal.aborted) abort();
      });
      if (sourceSignal.aborted) throw new KernelFault('cancelled');
      try {
        await new Promise<void>((resolve, rejectListen) => {
          server?.once('error', rejectListen);
          server?.listen(settings.listenPort, settings.listenHost, () => resolve());
        });
        await authority.check();
        const address = server.address();
        if (!address || typeof address === 'string') throw new KernelFault('unavailable');
        test?.onListening(address);
        acceptReady();
        await stopped;
      } finally {
        for (const socket of sockets) socket.destroy();
        if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
        await Promise.allSettled([...upgrades]);
        await Promise.allSettled([...peers]);
      }
    });
    void running.catch((error: unknown) => {
      runError = error;
      rejectReady(error);
      signalWaiter();
    });
    return ready;
  };
  return {
    async nextPeer(signal) {
      if (closed || signal.aborted) throw new KernelFault('cancelled');
      await start(signal);
      while (!closed && !signal.aborted) {
        await authority.check();
        if (runError) throw runError instanceof KernelFault ? runError : new KernelFault('network');
        if (peer && peer.id && !delivered) {
          delivered = true;
          return peer;
        }
        await new Promise<void>((resolve) => {
          const wake = (): void => {
            signal.removeEventListener('abort', wake);
            resolve();
          };
          waiting = wake;
          signal.addEventListener('abort', wake, { once: true });
          if (signal.aborted || closed) wake();
        });
      }
      throw new KernelFault('cancelled');
    },
    close() {
      closing ??= (async () => {
        closed = true;
        signalWaiter();
        await authority.close();
        await running?.catch(() => {});
      })();
      return closing;
    },
  };
}
