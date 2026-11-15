import type WebSocket from 'ws';
import { makeError } from '@pet/contracts';
import { KernelFault, type SecretRedactor } from '@pet/host-kernel';
import type { QQIoOutcome } from '@pet/companion-runtime';
import type { SnowMediaExchange, SnowMediaIo } from '@pet/qq-onebot';
import {
  encodeSnowMediaRequest,
  parseSnowMediaEcho,
  SNOW_MEDIA_ECHO_PREFIX,
  SNOW_MEDIA_FRAME_MAX_BYTES,
  type SnowMediaRequest,
} from '@pet/qq-onebot/media-wire';

/** Media echoes are private to one authenticated peer; closed IDs need no tombstone table. */
interface Route {
  readonly echo: string;
  push(text: string, bytes: number): void;
  close(): Promise<void>;
}
export interface OneBotMediaRouter extends SnowMediaIo {
  route(text: string, size: number): boolean;
  close(): Promise<void>;
}
export function createOneBotMediaIo(options: {
  readonly socket: WebSocket;
  readonly signal: AbortSignal;
  readonly check: () => Promise<void>;
  readonly redactor: SecretRedactor;
  readonly write: (text: string, signal: AbortSignal) => Promise<QQIoOutcome<null>>;
}): OneBotMediaRouter {
  const routes = new Map<string, Route>();
  let closed = false;
  let nonce: string | undefined;
  let sequence = 0;
  let paused = false;
  let pendingFrames = 0;
  const resume = (): void => {
    if (paused && pendingFrames === 0) {
      paused = false;
      options.socket.resume();
    }
  };
  return {
    openMedia(request: SnowMediaRequest, caller: AbortSignal): SnowMediaExchange {
      if (closed || options.signal.aborted || caller.aborted) throw new KernelFault('cancelled');
      const encoded = encodeSnowMediaRequest(request);
      if (!encoded.ok) throw new KernelFault(encoded.error.code);
      const match = parseSnowMediaEcho(request.echo);
      if (
        !match ||
        match.sequence <= sequence ||
        (nonce !== undefined && nonce !== match.nonce) ||
        routes.has(request.echo)
      )
        throw new KernelFault('conflict');
      if (routes.size >= 8) throw new KernelFault('quota-exceeded');
      if (
        options.redactor.containsValue({
          action: request.action,
          echo: request.echo,
          params: request.params,
        }) ||
        ('chunk' in request && request.chunk && options.redactor.containsBytes(request.chunk.bytes))
      )
        throw new KernelFault('permission-denied');
      const signal = AbortSignal.any([options.signal, caller]);
      const queue: Array<{ text: string; bytes: number }> = [];
      const readers = new Set<Promise<unknown>>();
      let queuedBytes = 0;
      let wake: (() => void) | undefined;
      let used = false;
      let ended = false;
      let finishing: Promise<void> | undefined;
      let finish = (): void => {};
      const endedPromise = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const notify = (): void => {
        wake?.();
        wake = undefined;
      };
      const route: Route = {
        echo: request.echo,
        push(text, bytes) {
          if (ended) return;
          if (queue.length >= 4 || queuedBytes + bytes > SNOW_MEDIA_FRAME_MAX_BYTES * 4)
            throw new KernelFault('quota-exceeded');
          queue.push({ text, bytes });
          pendingFrames++;
          queuedBytes += bytes;
          if (!paused) {
            paused = true;
            options.socket.pause();
          }
          notify();
        },
        close() {
          if (!finishing) {
            ended = true;
            if (routes.get(request.echo) === route) routes.delete(request.echo);
            pendingFrames -= queue.length;
            queue.length = 0;
            queuedBytes = 0;
            signal.removeEventListener('abort', onAbort);
            resume();
            notify();
            finish();
            finishing = Promise.allSettled([sent, ...readers]).then(() => {});
          }
          return finishing;
        },
      };
      const onAbort = (): void => {
        void route.close();
      };
      // Register synchronously before even scheduling a native write. High water prevents reuse.
      nonce = match.nonce;
      sequence = match.sequence;
      routes.set(request.echo, route);
      signal.addEventListener('abort', onAbort, { once: true });
      const sent = Promise.resolve().then(async (): Promise<QQIoOutcome<null>> => {
        let handedToWriter = false;
        try {
          await options.check();
          if (signal.aborted || ended) throw new KernelFault('cancelled');
          handedToWriter = true;
          return await options.write(encoded.value, signal);
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof KernelFault
                ? error.error
                : makeError(signal.aborted ? 'cancelled' : 'network'),
            dispatched: handedToWriter,
          };
        }
      });
      if (signal.aborted) onAbort();
      const settled = endedPromise.then(() => finishing ?? sent.then(() => {}));
      return {
        sent,
        settled,
        frames: {
          [Symbol.asyncIterator]() {
            if (used) throw new KernelFault('conflict');
            used = true;
            return {
              next() {
                if (readers.size) return Promise.reject(new KernelFault('conflict'));
                if (ended) return Promise.resolve({ done: true as const, value: undefined });
                const reading = (async () => {
                  while (!queue.length && !ended)
                    await new Promise<void>((resolve) => {
                      wake = resolve;
                    });
                  await options.check();
                  if (signal.aborted) throw new KernelFault('cancelled');
                  const frame = queue.shift();
                  if (!frame) return { done: true as const, value: undefined };
                  queuedBytes -= frame.bytes;
                  pendingFrames--;
                  resume();
                  return { done: false as const, value: frame.text };
                })();
                readers.add(reading);
                void reading.then(
                  () => readers.delete(reading),
                  () => readers.delete(reading),
                );
                return reading;
              },
              async return() {
                await route.close();
                return { done: true as const, value: undefined };
              },
            };
          },
        },
        close: () => route.close(),
      };
    },
    route(text, size) {
      let root: unknown;
      try {
        root = JSON.parse(text) as unknown;
      } catch {
        return false;
      }
      if (!root || typeof root !== 'object' || Array.isArray(root) || !('echo' in root))
        return false;
      const echo = root.echo;
      if (typeof echo !== 'string' || !echo.startsWith(SNOW_MEDIA_ECHO_PREFIX)) return false;
      if (size > SNOW_MEDIA_FRAME_MAX_BYTES || options.redactor.containsValue(root))
        throw new KernelFault('permission-denied');
      routes.get(echo)?.push(text, size);
      return true; // Late media responses never become ordinary messages.
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([...routes.values()].map((route) => route.close()));
      resume();
    },
  };
}
