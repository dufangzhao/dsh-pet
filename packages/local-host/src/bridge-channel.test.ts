import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  LOCAL_HOST_BRIDGE_PATH,
  LOCAL_HOST_BRIDGE_PLUGIN_ID,
  LOCAL_HOST_PROTOCOL_VERSION,
  type LocalHostAuthorityRequest,
  type LocalHostBridgeHello,
  type LocalHostBridgeWelcome,
  type OwnerRef,
} from '@pet/contracts';
import { KernelFault, SecretRedactor, type RpcHandler } from '@pet/host-kernel';
import { connectAgentBridge, createAgentBridgeServer } from './bridge-handshake.js';
import type { BridgeChannel } from './bridge-channel.js';
import { checkRemoteAuthority } from './authority-check.js';

const token = 'owner-token-for-controlled-local-host-tests';
const owner: OwnerRef = {
  pluginId: LOCAL_HOST_BRIDGE_PLUGIN_ID,
  instanceId: 'default',
  generation: 1,
};
function deferred<T>() {
  let resolve = (_value: T): void => {
    throw new Error('Deferred is not initialized');
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  return address.port;
}
async function fixture(handlers: Readonly<Record<string, RpcHandler>> = {}) {
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const agentId = randomUUID(),
    agentEpoch = randomUUID(),
    hostId = randomUUID();
  const offers = new Set<BridgeChannel>();
  const accepted = deferred<BridgeChannel>();
  const scope = new AbortController();
  const bridge = createAgentBridgeServer({
    server: http,
    token,
    agentId,
    agentEpoch,
    hostId,
    owner,
    channel: () => ({ live: () => true, signalFor: () => scope.signal, handlers }),
    onPeer: (peer) => {
      offers.add(peer);
      accepted.resolve(peer);
    },
  });
  const port = await listen(http);
  cleanups.push(async () => {
    scope.abort();
    await bridge.close();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const hello: LocalHostBridgeHello = {
    type: 'hello',
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    packageVersion: '0.1.0-g0',
    hostId,
    bootId: randomUUID(),
    agentId,
    agentEpoch,
  };
  return { baseUrl: `http://127.0.0.1:${port}`, hello, offers, accepted, scope };
}
async function pair(handlers: Readonly<Record<string, RpcHandler>> = {}) {
  const setup = await fixture(handlers);
  const localScope = new AbortController();
  const client = await connectAgentBridge({
    baseUrl: setup.baseUrl,
    token,
    hello: setup.hello,
    channel: () => ({ live: () => true, signalFor: () => localScope.signal }),
  });
  const server = await setup.accepted.promise;
  cleanups.push(async () => {
    localScope.abort();
    client.close();
    await client.settled;
  });
  return { ...setup, client, server };
}
function controlledAuthorityRequest(peer: BridgeChannel): LocalHostAuthorityRequest {
  const sourceOwner: OwnerRef = { pluginId: 'pet.qq-onebot', instanceId: 'default', generation: 1 };
  return {
    kind: 'delivery',
    binding: {
      hostId: peer.context.hostId,
      hostBootId: peer.context.bootId,
      bridgeSessionId: peer.context.sessionId,
      sourceOwner,
      sourceConfigRevision: 1,
      sourcePermissionEpoch: 0,
      sourceCredentialVersion: 'synthetic-key-version',
      nativeConnectionId: 'controlled-native-peer',
    },
    task: { owner: sourceOwner, taskId: 'controlled-native-task' },
    deliveryId: 'controlled-delivery',
    partId: 'controlled-part',
    attemptId: 'controlled-attempt',
    contentHash: 'a'.repeat(64),
  };
}
async function rawClient(setup: Awaited<ReturnType<typeof fixture>>) {
  const socket = new WebSocket(setup.baseUrl.replace('http:', 'ws:') + LOCAL_HOST_BRIDGE_PATH, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const received = deferred<LocalHostBridgeWelcome>();
  socket.once('message', (data) =>
    received.resolve(JSON.parse(data.toString()) as LocalHostBridgeWelcome),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify(setup.hello));
  const context = await received.promise;
  cleanups.push(async () => {
    if (socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    socket.terminate();
    await closed;
  });
  return { socket, context };
}

describe('authenticated local-host bridge primitives', () => {
  it('binds the exact host/Agent/session and calls only a declared purpose', async () => {
    const setup = await pair({
      'source.offer': async (_context, payload) => ({ ok: true, value: payload }),
    });
    expect(setup.client.context).toEqual(setup.server.context);
    expect(setup.client.context.agentId).toBe(setup.hello.agentId);
    expect(setup.client.context.hostId).toBe(setup.hello.hostId);
    const result = await setup.client.rpc.request('source.offer', { source: 'onebot-v11' });
    expect(result).toEqual({ ok: true, value: { source: 'onebot-v11' } });
  });

  it('does not authenticate a wrong bearer or a different Agent epoch', async () => {
    const setup = await fixture();
    const attempt = (key: string, hello: LocalHostBridgeHello) =>
      connectAgentBridge({
        baseUrl: setup.baseUrl,
        token: key,
        hello,
        channel: () => ({ live: () => true, signalFor: () => setup.scope.signal }),
      });
    await expect(attempt('wrong-owner-token-with-enough-bytes', setup.hello)).rejects.toThrow();
    await expect(attempt(token, { ...setup.hello, agentEpoch: randomUUID() })).rejects.toThrow();
    expect(setup.offers.size).toBe(0);
  });

  it('checks each captured operation afresh and rejects another bridge session or excessive permit', async () => {
    let calls = 0,
      validForMs = 5000;
    const setup = await pair({
      'authority.check': async () => {
        calls++;
        return { ok: true, value: { validForMs } };
      },
    });
    const request = controlledAuthorityRequest(setup.client);
    const options = {
      peer: setup.client,
      request,
      signal: setup.scope.signal,
      checkLocal: () => {},
    };
    expect((await checkRemoteAuthority(options)).ok).toBe(true);
    expect((await checkRemoteAuthority(options)).ok).toBe(true);
    expect(calls).toBe(2);
    const stale = await checkRemoteAuthority({
      ...options,
      request: { ...request, binding: { ...request.binding, bridgeSessionId: randomUUID() } },
    });
    expect(stale.ok).toBe(false);
    expect(calls).toBe(2);
    validForMs = 5001;
    expect((await checkRemoteAuthority(options)).ok).toBe(false);
    let localChecks = 0;
    validForMs = 5000;
    const denied = await checkRemoteAuthority({
      ...options,
      checkLocal: () => {
        if (++localChecks === 2) throw new KernelFault('permission-denied');
      },
    });
    expect(denied.ok).toBe(false);
  });

  it('counts the fresh-check budget from its request, including a delayed local postflight', async () => {
    const setup = await pair({
      'authority.check': async () => ({ ok: true, value: { validForMs: 5 } }),
    });
    let localChecks = 0;
    const result = await checkRemoteAuthority({
      peer: setup.client,
      request: controlledAuthorityRequest(setup.client),
      signal: setup.scope.signal,
      checkLocal: async () => {
        if (++localChecks === 2) await new Promise<void>((resolve) => setTimeout(resolve, 20));
      },
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'timeout', messageKey: 'errors.timeout', retryable: false },
    });
  });

  it('closes instead of exposing runtime.invoke through the network', async () => {
    const setup = await pair();
    const result = await setup.client.rpc.request('runtime.invoke', { method: 'files.read' });
    expect(result.ok).toBe(false);
    await setup.client.settled;
    expect(setup.offers.size).toBe(1);
  });

  it('rejects a forged owner and oversized JSON before a handler runs', async () => {
    let calls = 0;
    const setup = await fixture({
      'input.offer': async () => {
        calls++;
        return { ok: true, value: null };
      },
    });
    const first = await rawClient(setup);
    const closed = new Promise<void>((resolve) => first.socket.once('close', () => resolve()));
    first.socket.send(
      JSON.stringify({
        protocol: 1,
        id: 'm-1',
        type: 'request',
        method: 'input.offer',
        sessionId: first.context.sessionId,
        owner: { ...owner, generation: 2 },
        payload: {},
      }),
    );
    await closed;
    expect(calls).toBe(0);
    const second = await rawClient(setup);
    const oversizedClosed = new Promise<void>((resolve) =>
      second.socket.once('close', () => resolve()),
    );
    second.socket.send(
      JSON.stringify({
        protocol: 1,
        id: 'm-1',
        type: 'request',
        method: 'input.offer',
        sessionId: second.context.sessionId,
        owner,
        payload: 'x'.repeat(65536),
      }),
    );
    await oversizedClosed;
    expect(calls).toBe(0);
  });

  it('moves actual non-UTF8 bytes through credited binary frames and caps streams', async () => {
    const setup = await pair();
    const reference = {
      owner: setup.client.context.owner,
      taskId: 'wire-bytes',
      streamId: 'wire-stream',
    };
    const reader = setup.server.media.createReader(reference);
    const writer = setup.client.media.createWriter(reference);
    if (!reader.ok || !writer.ok) throw new Error('Failed to create controlled stream');
    expect(setup.server.media.grantInitial(reference).ok).toBe(true);
    const content = Buffer.from(Array.from({ length: 32768 }, (_, index) => index % 256));
    const received = (async () => {
      const chunks: Uint8Array[] = [];
      for await (const bytes of reader.value) chunks.push(bytes);
      return Buffer.concat(chunks);
    })();
    expect((await writer.value.write(content.subarray(0, 12345))).ok).toBe(true);
    expect((await writer.value.write(content.subarray(12345))).ok).toBe(true);
    expect((await writer.value.end()).ok).toBe(true);
    expect(await received).toEqual(content);
    for (let index = 0; index < 4; index++)
      expect(
        setup.client.media.createReader({
          ...reference,
          taskId: `task-${index}`,
          streamId: `held-${index}`,
        }).ok,
      ).toBe(true);
    const fifth = setup.client.media.createReader({
      ...reference,
      taskId: 'overflow-task',
      streamId: 'held-5',
    });
    expect(fifth).toEqual({
      ok: false,
      error: { code: 'quota-exceeded', messageKey: 'errors.quota-exceeded', retryable: false },
    });
    const alien = setup.server.media.createReader({
      ...reference,
      owner: { ...owner, generation: 2 },
      streamId: 'alien',
    });
    expect(alien.ok).toBe(false);
  });

  it('keeps a protected local key out of ordinary control JSON', async () => {
    const redactor = new SecretRedactor();
    const secret = 'synthetic-onebot-local-only-secret';
    redactor.add(secret);
    let calls = 0;
    const setup = await fixture({
      'input.offer': async () => {
        calls++;
        return { ok: true, value: null };
      },
    });
    const client = await connectAgentBridge({
      baseUrl: setup.baseUrl,
      token,
      hello: setup.hello,
      channel: () => ({
        live: () => true,
        signalFor: () => setup.scope.signal,
        allowJson: (value) => !redactor.containsValue(value),
      }),
    });
    cleanups.push(async () => {
      client.close();
      await client.settled;
    });
    expect((await client.rpc.request('input.offer', { text: secret })).ok).toBe(false);
    expect(calls).toBe(0);
    expect((await client.rpc.request('input.offer', { text: 'safe current input' })).ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('fences connection-scope cancellation before physical close or a held handler settles', async () => {
    const setup = await fixture();
    const connectionScope = new AbortController();
    const entered = deferred<AbortSignal>(),
      release = deferred<void>(),
      returned = deferred<void>();
    const client = await connectAgentBridge({
      baseUrl: setup.baseUrl,
      token,
      hello: setup.hello,
      signal: connectionScope.signal,
      channel: () => ({
        live: () => true,
        signalFor: () => setup.scope.signal,
        handlers: {
          'delivery.execute': async (context) => {
            entered.resolve(context.signal);
            await release.promise;
            returned.resolve();
            return { ok: true, value: null };
          },
        },
      }),
    });
    cleanups.push(async () => {
      client.close();
      await client.settled;
    });
    const server = await setup.accepted.promise;
    const requested = server.rpc.request('delivery.execute', {});
    const handlerSignal = await entered.promise;
    let physicallyClosed = false;
    void client.settled.then(() => {
      physicallyClosed = true;
    });
    connectionScope.abort();
    expect(client.signal.aborted).toBe(true);
    expect(handlerSignal.aborted).toBe(true);
    expect(physicallyClosed).toBe(false);
    expect((await requested).ok).toBe(false);
    release.resolve();
    await returned.promise;
  });

  it('does not call socket closure a completed remote operation', async () => {
    const started = deferred<void>(),
      release = deferred<void>(),
      observed = deferred<void>();
    let actualDone = false;
    const setup = await pair({
      'delivery.execute': async () => {
        started.resolve();
        await release.promise;
        actualDone = true;
        observed.resolve();
        return { ok: true, value: { publication: 'accepted' } };
      },
    });
    const requested = setup.server.rpc.request('delivery.execute', {});
    // This side intentionally has no execution handler: no fabricated success is possible.
    expect((await requested).ok).toBe(false);
    const localRequest = setup.client.rpc.request('delivery.execute', {});
    await started.promise;
    setup.client.close();
    expect((await localRequest).ok).toBe(false);
    await setup.client.settled;
    expect(actualDone).toBe(false);
    release.resolve();
    await observed.promise;
    expect(actualDone).toBe(true);
  });
});
