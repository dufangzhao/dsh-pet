import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  CONTROL_MAX_MESSAGE_BYTES,
  LOCAL_HOST_BRIDGE_PATH,
  LOCAL_HOST_BRIDGE_PLUGIN_ID,
  LOCAL_HOST_PROTOCOL_VERSION,
  LOCAL_ID_PATTERN,
  type LocalHostBridgeHello,
  type LocalHostBridgeWelcome,
  type OwnerRef,
} from '@pet/contracts';
import { isRecord, jsonPreflight, validateControlMessage } from '@pet/contracts/validation';
import { KernelFault } from '@pet/host-kernel';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  BRIDGE_MAX_MEDIA_MESSAGE_BYTES,
  bridgeMessageBytes,
  createBridgeChannel,
  type BridgeChannel,
  type BridgeChannelOptions,
} from './bridge-channel.js';

const localId = new RegExp(LOCAL_ID_PATTERN);
const HANDSHAKE_MS = 5000;
const id = (value: unknown): value is string => typeof value === 'string' && localId.test(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function packet(data: RawData, binary: boolean): Record<string, unknown> {
  if (binary) throw new KernelFault('invalid-input');
  const bytes = bridgeMessageBytes(data, CONTROL_MAX_MESSAGE_BYTES);
  const parsed = jsonPreflight(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (!parsed.ok || !isRecord(parsed.value)) throw new KernelFault('invalid-input');
  return parsed.value;
}
function hello(data: RawData, binary: boolean): LocalHostBridgeHello {
  const value = packet(data, binary);
  if (
    !exact(value, [
      'type',
      'protocolVersion',
      'packageVersion',
      'hostId',
      'bootId',
      'agentId',
      'agentEpoch',
    ]) ||
    value['type'] !== 'hello' ||
    value['protocolVersion'] !== LOCAL_HOST_PROTOCOL_VERSION ||
    typeof value['packageVersion'] !== 'string' ||
    !/^[A-Za-z0-9.+-]{1,64}$/.test(value['packageVersion']) ||
    !id(value['hostId']) ||
    !id(value['bootId']) ||
    !id(value['agentId']) ||
    !id(value['agentEpoch'])
  )
    throw new KernelFault('invalid-input');
  return {
    type: 'hello',
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    packageVersion: value['packageVersion'],
    hostId: value['hostId'],
    bootId: value['bootId'],
    agentId: value['agentId'],
    agentEpoch: value['agentEpoch'],
  };
}
function welcome(
  data: RawData,
  binary: boolean,
  expected: LocalHostBridgeHello,
): LocalHostBridgeWelcome {
  const value = packet(data, binary);
  const owner = value['owner'];
  const identity = validateControlMessage({
    protocol: 1,
    type: 'cancel',
    id: 'handshake',
    taskId: 'handshake',
    reason: 'user',
    sessionId: value['sessionId'],
    owner,
  });
  if (
    !exact(value, [
      'type',
      'protocolVersion',
      'agentId',
      'agentEpoch',
      'hostId',
      'bootId',
      'sessionId',
      'owner',
    ]) ||
    value['type'] !== 'welcome' ||
    value['protocolVersion'] !== LOCAL_HOST_PROTOCOL_VERSION ||
    value['agentId'] !== expected.agentId ||
    value['agentEpoch'] !== expected.agentEpoch ||
    value['hostId'] !== expected.hostId ||
    value['bootId'] !== expected.bootId ||
    !identity.ok ||
    identity.value.owner.pluginId !== LOCAL_HOST_BRIDGE_PLUGIN_ID ||
    identity.value.owner.instanceId !== 'default'
  )
    throw new KernelFault('permission-denied');
  return {
    type: 'welcome',
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    agentId: expected.agentId,
    agentEpoch: expected.agentEpoch,
    hostId: expected.hostId,
    bootId: expected.bootId,
    sessionId: identity.value.sessionId,
    owner: identity.value.owner,
  };
}

export interface AgentBridgeServerOptions {
  readonly server: Server;
  readonly token: string;
  readonly agentId: string;
  readonly agentEpoch: string;
  readonly hostId: string;
  readonly owner: OwnerRef;
  readonly channel: (
    hello: LocalHostBridgeHello,
    context: LocalHostBridgeWelcome,
  ) => Omit<BridgeChannelOptions, 'context'>;
  readonly onPeer: (peer: BridgeChannel, hello: LocalHostBridgeHello) => void;
}

/** Header auth grants the existing owner trust, not independent device identity. */
export function createAgentBridgeServer(options: AgentBridgeServerOptions): {
  close(): Promise<void>;
} {
  if (
    Buffer.byteLength(options.token) < 24 ||
    Buffer.byteLength(options.token) > 512 ||
    options.owner.pluginId !== LOCAL_HOST_BRIDGE_PLUGIN_ID ||
    options.owner.instanceId !== 'default' ||
    !id(options.agentId) ||
    !id(options.agentEpoch) ||
    !id(options.hostId)
  )
    throw new KernelFault('invalid-input');
  const expected = Buffer.from(`Bearer ${options.token}`);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: BRIDGE_MAX_MEDIA_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const peers = new Set<BridgeChannel>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const reject = (socket: Duplex, code: number): void => {
    socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (request.url !== LOCAL_HOST_BRIDGE_PATH) {
      reject(socket, 404);
      return;
    }
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (closed || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      reject(socket, 401);
      return;
    }
    if (wss.clients.size >= 1) {
      reject(socket, 503);
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const timer = setTimeout(() => ws.terminate(), HANDSHAKE_MS);
      timer.unref();
      ws.once('close', () => clearTimeout(timer));
      ws.once('error', () => ws.terminate());
      ws.once('message', (data, binary) => {
        clearTimeout(timer);
        try {
          const offered = hello(data, binary);
          if (
            offered.agentId !== options.agentId ||
            offered.agentEpoch !== options.agentEpoch ||
            offered.hostId !== options.hostId
          )
            throw new KernelFault('permission-denied');
          const context: LocalHostBridgeWelcome = {
            type: 'welcome',
            protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
            agentId: options.agentId,
            agentEpoch: options.agentEpoch,
            hostId: offered.hostId,
            bootId: offered.bootId,
            sessionId: randomUUID(),
            owner: options.owner,
          };
          // Install the channel synchronously before another WebSocket message can arrive.
          const peer = createBridgeChannel(ws, { ...options.channel(offered, context), context });
          peers.add(peer);
          void peer.settled.then(() => peers.delete(peer));
          ws.send(JSON.stringify(context), (error) => {
            if (error || closed || peer.signal.aborted) {
              peer.close();
              return;
            }
            try {
              options.onPeer(peer, offered);
            } catch {
              peer.close();
            }
          });
        } catch {
          ws.terminate();
        }
      });
    });
  };
  options.server.on('upgrade', upgrade);
  return {
    close() {
      if (closing) return closing;
      closed = true;
      options.server.off('upgrade', upgrade);
      closing = Promise.resolve().then(async () => {
        for (const peer of peers) peer.close();
        for (const ws of wss.clients) ws.terminate();
        await Promise.all([...peers].map((peer) => peer.settled));
        await new Promise<void>((resolve, rejectClose) =>
          wss.close((error) => (error ? rejectClose(new KernelFault('network')) : resolve())),
        );
      });
      return closing;
    },
  };
}

export interface ConnectAgentBridgeOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly hello: LocalHostBridgeHello;
  readonly channel: (context: LocalHostBridgeWelcome) => Omit<BridgeChannelOptions, 'context'>;
  readonly signal?: AbortSignal;
}
export async function connectAgentBridge(
  options: ConnectAgentBridgeOptions,
): Promise<BridgeChannel> {
  let target: URL;
  try {
    target = new URL(options.baseUrl);
  } catch {
    throw new KernelFault('invalid-input');
  }
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.pathname !== '/' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new KernelFault('invalid-input');
  if (
    Buffer.byteLength(options.token) < 24 ||
    Buffer.byteLength(options.token) > 512 ||
    options.signal?.aborted
  )
    throw new KernelFault('invalid-input');
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  target.pathname = LOCAL_HOST_BRIDGE_PATH;
  const socket = new WebSocket(target, {
    headers: { Authorization: `Bearer ${options.token}` },
    followRedirects: false,
    perMessageDeflate: false,
    maxPayload: BRIDGE_MAX_MEDIA_MESSAGE_BYTES,
  });
  return new Promise<BridgeChannel>((resolve, rejectConnect) => {
    let done = false;
    let activePeer: BridgeChannel | undefined;
    const fail = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.terminate();
      rejectConnect(new KernelFault('network'));
    };
    const abort = (): void => {
      if (activePeer) activePeer.close();
      else fail();
    };
    const timer = setTimeout(fail, HANDSHAKE_MS);
    timer.unref();
    options.signal?.addEventListener('abort', abort, { once: true });
    socket.once('close', () => {
      options.signal?.removeEventListener('abort', abort);
      fail();
    });
    socket.on('error', fail);
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      fail();
    });
    socket.once('open', () =>
      socket.send(JSON.stringify(options.hello), (error) => {
        if (error) fail();
      }),
    );
    socket.once('message', (data, binary) => {
      if (done) return;
      try {
        const context = welcome(data, binary, options.hello);
        const peer = createBridgeChannel(socket, { ...options.channel(context), context });
        activePeer = peer;
        done = true;
        clearTimeout(timer);
        resolve(peer);
      } catch {
        fail();
      }
    });
  });
}
