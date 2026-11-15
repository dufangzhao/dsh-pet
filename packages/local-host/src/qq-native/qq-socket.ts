import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';
import { KernelFault } from '@pet/host-kernel';

const FRAME_MAX = 64 * 1024;
const QUEUE_MAX = 256 * 1024;

/** A single bounded native socket reader and actual write/close settlement. */
export function ownedQqSocket(
  socket: WebSocket,
  signal: AbortSignal,
  check: () => Promise<void>,
  options?: {
    readonly maxFrameBytes: number;
    readonly routeFrame: (text: string, size: number) => boolean;
  },
): {
  id: string;
  readonly signal: AbortSignal;
  frames: AsyncIterable<string>;
  settled: Promise<void>;
  send(text: string, signal: AbortSignal, onDispatch?: () => void): Promise<void>;
  close(): Promise<void>;
} {
  const id = randomUUID();
  const connection = new AbortController();
  const queue: string[] = [];
  let bytes = 0;
  let wake: (() => void) | undefined;
  let ended = false;
  let consumed = false;
  let failure: KernelFault | undefined;
  let finish = (): void => {};
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const writes = new Set<Promise<void>>();
  const readers = new Set<Promise<unknown>>();
  const settled = closed.then(async () => {
    await Promise.allSettled([...writes, ...readers]);
  });
  const notify = (): void => {
    wake?.();
    wake = undefined;
  };
  const stop = (): void => {
    connection.abort();
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  };
  const fail = (code: 'invalid-input' | 'quota-exceeded' | 'network'): void => {
    failure ??= new KernelFault(code);
    stop();
    notify();
  };
  socket.on('error', () => fail('network'));
  socket.on('message', (data: RawData, binary: boolean) => {
    if (binary) {
      fail('invalid-input');
      return;
    }
    const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (buffer.byteLength > (options?.maxFrameBytes ?? FRAME_MAX)) {
      fail('quota-exceeded');
      return;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      fail('invalid-input');
      return;
    }
    try {
      if (options?.routeFrame(text, buffer.byteLength)) return;
    } catch {
      fail('invalid-input');
      return;
    }
    if (
      buffer.byteLength > FRAME_MAX ||
      bytes + buffer.byteLength > QUEUE_MAX ||
      queue.length >= 64
    ) {
      fail('quota-exceeded');
      return;
    }
    bytes += buffer.byteLength;
    queue.push(text);
    notify();
  });
  socket.once('close', () => {
    connection.abort();
    ended = true;
    signal.removeEventListener('abort', stop);
    notify();
    finish();
  });
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  let closing: Promise<void> | undefined;
  return {
    id,
    signal: connection.signal,
    settled,
    frames: {
      [Symbol.asyncIterator]() {
        if (consumed) throw new KernelFault('conflict');
        consumed = true;
        return {
          next() {
            if (readers.size) return Promise.reject(new KernelFault('conflict'));
            if (ended)
              return failure
                ? Promise.reject(failure)
                : Promise.resolve({ done: true as const, value: undefined });
            const reading = (async () => {
              while (!queue.length && !ended && !failure)
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
              await check();
              if (signal.aborted) throw new KernelFault('cancelled');
              if (failure) throw failure;
              if (connection.signal.aborted) return { done: true as const, value: undefined };
              const text = queue.shift();
              if (text === undefined) return { done: true as const, value: undefined };
              bytes -= Buffer.byteLength(text);
              return { done: false as const, value: text };
            })();
            readers.add(reading);
            void reading.then(
              () => readers.delete(reading),
              () => readers.delete(reading),
            );
            return reading;
          },
          async return() {
            return { done: true as const, value: undefined };
          },
        };
      },
    },
    send(text, caller, onDispatch) {
      if (connection.signal.aborted) return Promise.reject(new KernelFault('cancelled'));
      const work = (async () => {
        await check();
        if (signal.aborted || caller.aborted || connection.signal.aborted)
          throw new KernelFault('cancelled');
        if (Buffer.byteLength(text) > FRAME_MAX) throw new KernelFault('quota-exceeded');
        if (socket.readyState !== WebSocket.OPEN) throw new KernelFault('network');
        await new Promise<void>((resolve, reject) => {
          onDispatch?.();
          socket.send(text, (error) => (error ? reject(new KernelFault('network')) : resolve()));
        });
        await check();
        if (caller.aborted || signal.aborted || connection.signal.aborted)
          throw new KernelFault('cancelled');
      })();
      writes.add(work);
      void work.then(
        () => writes.delete(work),
        () => writes.delete(work),
      );
      return work;
    },
    close() {
      closing ??= (async () => {
        stop();
        await settled;
        await Promise.allSettled([...writes]);
      })();
      return closing;
    },
  };
}
