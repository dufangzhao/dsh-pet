import { isDeepStrictEqual } from 'node:util';
import {
  CONTROL_MAX_MESSAGE_BYTES,
  LOCAL_HOST_BRIDGE_METHODS,
  MEDIA_MAX_CHUNK_BYTES,
  makeError,
  type ControlMessage,
  type JsonValue,
  type LocalHostBridgeWelcome,
  type Result,
} from '@pet/contracts';
import { validateControlMessage } from '@pet/contracts/validation';
import {
  ControlEndpoint,
  encodeMediaFrame,
  KernelFault,
  MEDIA_HEADER_BYTES,
  MediaFrameDecoder,
  TaskMediaPeer,
  type ControlTransport,
  type MediaPeerOptions,
  type RpcHandler,
} from '@pet/host-kernel';
import { WebSocket, type RawData } from 'ws';

const methods = new Set<string>(LOCAL_HOST_BRIDGE_METHODS);
export const BRIDGE_MAX_MEDIA_MESSAGE_BYTES = 8 + MEDIA_HEADER_BYTES + MEDIA_MAX_CHUNK_BYTES;
const MAX_BUFFERED_BYTES = CONTROL_MAX_MESSAGE_BYTES * 128 + BRIDGE_MAX_MEDIA_MESSAGE_BYTES * 4;

export interface BridgeChannelOptions {
  readonly context: LocalHostBridgeWelcome;
  readonly live: () => boolean;
  readonly signalFor: MediaPeerOptions['signalFor'];
  readonly handlers?: Readonly<Record<string, RpcHandler>>;
  readonly allowJson?: (value: JsonValue) => boolean;
}
export interface BridgeChannel {
  readonly context: LocalHostBridgeWelcome;
  readonly rpc: ControlEndpoint;
  readonly media: TaskMediaPeer;
  readonly signal: AbortSignal;
  /** Only the bridge socket's physical closure, not a remote native operation. */
  readonly settled: Promise<void>;
  close(): void;
}

export function bridgeMessageBytes(data: RawData, maximum: number): Buffer {
  const parts = Array.isArray(data) ? data : [data];
  let total = 0;
  const buffers = parts.map((part) => {
    const buffer = part instanceof ArrayBuffer ? Buffer.from(part) : part;
    total += buffer.byteLength;
    if (total > maximum) throw new KernelFault('quota-exceeded');
    return buffer;
  });
  return Buffer.concat(buffers, total);
}

/** Caller must first complete the authenticated hello/welcome exchange. */
export function createBridgeChannel(
  socket: WebSocket,
  options: BridgeChannelOptions,
): BridgeChannel {
  if (socket.readyState !== WebSocket.OPEN) throw new KernelFault('not-ready');
  if (Object.keys(options.handlers ?? {}).some((method) => !methods.has(method)))
    throw new KernelFault('invalid-input');
  const context: LocalHostBridgeWelcome = Object.freeze({
    ...options.context,
    owner: Object.freeze({ ...options.context.owner }),
  });
  const lifetime = new AbortController();
  const listeners = new Set<(message: ControlMessage) => void>();
  const closedListeners = new Set<() => void>();
  let closing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const settled = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  const closeSocket = (): void => {
    if (closing) return;
    closing = true;
    lifetime.abort();
    for (const listener of closedListeners) listener();
    socket.close();
    closeTimer = setTimeout(() => socket.terminate(), 1000);
    closeTimer.unref();
  };
  const write = async (data: string | Uint8Array): Promise<void> => {
    if (closing || socket.readyState !== WebSocket.OPEN) throw new KernelFault('unavailable');
    if (socket.bufferedAmount + Buffer.byteLength(data) > MAX_BUFFERED_BYTES)
      throw new KernelFault('quota-exceeded');
    await new Promise<void>((resolve, reject) => {
      socket.send(data, (error) => (error ? reject(new KernelFault('network')) : resolve()));
    });
  };
  const transport: ControlTransport = {
    async send(message) {
      if (message.type === 'request' && !methods.has(message.method))
        throw new KernelFault('permission-denied');
      const text = JSON.stringify(message);
      if (Buffer.byteLength(text) > CONTROL_MAX_MESSAGE_BYTES)
        throw new KernelFault('quota-exceeded');
      await write(text);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose(listener) {
      closedListeners.add(listener);
      return () => closedListeners.delete(listener);
    },
    close: closeSocket,
  };
  const rpc = new ControlEndpoint(transport, {
    sessionId: context.sessionId,
    owner: context.owner,
    live: () => !lifetime.signal.aborted && options.live(),
    signal: lifetime.signal,
    ...(options.handlers ? { handlers: options.handlers } : {}),
    ...(options.allowJson ? { allowJson: options.allowJson } : {}),
    onStreamControl: (message) => {
      if (!media.control(message).ok) closeSocket();
    },
  });
  const media = new TaskMediaPeer({
    maxStreams: 4,
    signalFor: (owner, taskId) =>
      isDeepStrictEqual(owner, context.owner) ? options.signalFor(owner, taskId) : null,
    write: async (frame): Promise<Result<null>> => {
      if (!isDeepStrictEqual(frame.header.owner, context.owner))
        return { ok: false, error: makeError('permission-denied', false) };
      const encoded = encodeMediaFrame(frame);
      if (!encoded.ok) return encoded;
      try {
        await write(encoded.value);
        return { ok: true, value: null };
      } catch {
        closeSocket();
        return { ok: false, error: makeError('network', false) };
      }
    },
    control: (message) => rpc.streamControl(message),
  });
  const decoder = new MediaFrameDecoder((frame) => {
    if (!isDeepStrictEqual(frame.header.owner, context.owner))
      return { ok: false, error: makeError('stale-owner', false) };
    return media.receive(frame);
  });
  const receive = (data: RawData, binary: boolean): void => {
    try {
      if (closing) return;
      if (binary) {
        const accepted = decoder.feed(bridgeMessageBytes(data, BRIDGE_MAX_MEDIA_MESSAGE_BYTES));
        if (!accepted.ok) closeSocket();
        return;
      }
      const bytes = bridgeMessageBytes(data, CONTROL_MAX_MESSAGE_BYTES);
      const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const parsed = validateControlMessage(input);
      if (!parsed.ok || (parsed.value.type === 'request' && !methods.has(parsed.value.method))) {
        closeSocket();
        return;
      }
      for (const listener of listeners) listener(parsed.value);
    } catch {
      closeSocket();
    }
  };
  socket.on('message', receive);
  socket.once('error', closeSocket);
  socket.once('close', () => {
    closeSocket();
    if (closeTimer) clearTimeout(closeTimer);
    rpc.close();
    media.close();
    socket.off('message', receive);
    listeners.clear();
    closedListeners.clear();
  });
  return Object.freeze({
    context,
    rpc,
    media,
    signal: lifetime.signal,
    settled,
    close: closeSocket,
  });
}
