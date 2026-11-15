import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { connect } from 'node:net';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import {
  makeError,
  type PluginManifest,
  type QQOfficialSettings,
  type QQOneBotSettings,
} from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import {
  CompanionPluginHost,
  companionHostDefinition,
  companionHostManifest,
} from '@pet/companion-runtime';
import {
  createAuthorizedOfficialIo,
  createAuthorizedOneBotIo,
  ownedQqSocket,
  withQqOperationCheck,
  type CapturedQqBinding,
} from '@pet/local-host/qq-native';
import {
  decodeSnowDownloadReply,
  SNOW_MEDIA_ECHO_PREFIX,
} from '../../../plugins/qq-onebot/src/media-wire.js';
import { uploadOfficialMedia } from '../../../plugins/qq-official/src/media.js';
import { OfficialQqDriver } from '../../../plugins/qq-official/src/driver.js';
import { KernelFault } from '@pet/host-kernel';
import { encodeOneBotAction } from '@pet/qq-onebot';
import { downloadSnowMedia, uploadSnowMedia } from '../../../plugins/qq-onebot/src/media.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const secret = 'synthetic-source-only-key-894837';
async function setup<S>(
  protocol: 'official' | 'onebot',
  settings: S,
): Promise<{ host: CompanionPluginHost; binding: CapturedQqBinding<S> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-qq-extra-test-'));
  const src = path.join(root, 'source');
  const core = path.join(root, 'host');
  await mkdir(src);
  await mkdir(core);
  const manifest = JSON.parse(
    await readFile(new URL(`../../../plugins/qq-${protocol}/plugin.json`, import.meta.url), 'utf8'),
  ) as PluginManifest;
  await writeFile(path.join(src, 'plugin.json'), JSON.stringify(manifest));
  await writeFile(path.join(core, 'plugin.json'), JSON.stringify(companionHostManifest));
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(root, 'data'),
    plugins: [
      {
        manifest: companionHostManifest,
        directory: core,
        definition: companionHostDefinition,
        preset: 'allow',
        enabled: true,
      },
      {
        manifest,
        directory: src,
        definition: definePlugin({
          activate(context) {
            context.provide(protocol, { describe: async () => null });
          },
        }),
        preset: 'allow',
        enabled: true,
        hostCredentials: [
          protocol === 'official' ? 'qq-official-app-secret' : 'qq-onebot-access-token',
        ],
      },
    ],
  });
  const binding: CapturedQqBinding<S> = {
    owner: host.owner(manifest.id),
    signal: new AbortController().signal,
    settings,
    configRevision: 1,
    credentialVersion: 'fixture',
    credential: secret,
    check() {},
  };
  cleanups.push(async () => {
    await host.close();
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-qq-extra-test-')
    )
      throw new Error('unexpected cleanup path');
    await rm(target, { recursive: true });
  });
  return { host, binding };
}
function flagResponseEof(response: Response, onEof: () => void): Response {
  if (!response.body) return response;
  const body = response.body;
  return {
    status: response.status,
    body: {
      getReader() {
        const reader = body.getReader();
        return {
          read: async () => {
            const next = await reader.read();
            if (next.done) onEof();
            return next;
          },
          cancel: () => reader.cancel(),
          releaseLock: () => reader.releaseLock(),
        };
      },
    },
  } as unknown as Response;
}

it.each(['source-revoke', 'transient-stale'] as const)(
  'preserves an accepted old-target receipt after postflight %s',
  async (mode) => {
    const settings: QQOfficialSettings = {
      protocol: 'official',
      appId: '555',
      scenes: ['private'],
    };
    const f = await setup('official', settings);
    let fullBody = false;
    let revoked = false;
    let messageRequests = 0;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/app/getAppAccessToken')
        response.end(
          JSON.stringify({ access_token: 'synthetic-access-token-462', expires_in: 7200 }),
        );
      else if (request.url === '/gateway')
        response.end(JSON.stringify({ url: 'wss://gateway.qq.com/socket' }));
      else {
        messageRequests++;
        response.end(JSON.stringify({ id: 'confirmed-old-target-message' }));
      }
    });
    const gateways = new WebSocketServer({ server });
    gateways.on('connection', (socket) => {
      socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
      socket.on('message', (data) => {
        const frame = JSON.parse(String(data)) as { op: number };
        if (frame.op === 2)
          socket.send(
            JSON.stringify({
              op: 0,
              t: 'READY',
              s: 1,
              d: { session_id: 'synthetic-session', user: { id: 'synthetic-bot' } },
            }),
          );
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const binding = {
      ...f.binding,
      check() {
        if (fullBody && !revoked) {
          revoked = true;
          if (mode === 'source-revoke')
            f.host.permissionControl.revoke({
              pluginId: f.binding.owner.pluginId,
              instanceId: 'default',
            });
          throw new KernelFault(mode === 'source-revoke' ? 'permission-denied' : 'stale-owner');
        }
      },
    };
    const io = createAuthorizedOfficialIo(f.host, binding, {
      fetch: async (url, init) => {
        const target = new URL(String(url));
        const response = await fetch(`http://127.0.0.1:${address.port}${target.pathname}`, init);
        return target.pathname.endsWith('/messages')
          ? flagResponseEof(response, () => {
              fullBody = true;
            })
          : response;
      },
      websocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
    });
    const driver = new OfficialQqDriver(io, { onStatus: () => {}, onEvent: async () => {} });
    cleanups.push(async () => {
      await driver.close();
      gateways.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const running = driver.start(new AbortController().signal);
    void running.catch(() => {});
    await vi.waitFor(() => expect(driver.status.phase).toBe('ready'));
    const connection = driver.status.connectionId;
    if (!connection) throw new Error('missing connection');
    const first = await driver.send(
      'c2c',
      'target',
      { msg_type: 0, msg_seq: 1, content: 'one' },
      new AbortController().signal,
      connection,
    );
    expect(revoked).toBe(true);
    expect(first).toMatchObject({
      ok: true,
      value: {
        connectionId: connection,
        receipt: { kind: 'message-accepted', id: 'confirmed-old-target-message' },
      },
    });
    const second = await driver.send(
      'c2c',
      'target',
      { msg_type: 0, msg_seq: 2, content: 'two' },
      new AbortController().signal,
      connection,
    );
    expect(second.ok).toBe(false);
    expect(messageRequests).toBe(1);
    await driver.close();
    await running.catch(() => {});
    expect(f.host.permissions.diagnostics().leases).toBe(0);
    expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  },
);

it.each(['internal-postflight', 'secret-response'] as const)(
  'does not preserve an unsafe or non-authority failure: %s',
  async (mode) => {
    const settings: QQOfficialSettings = {
      protocol: 'official',
      appId: '555',
      scenes: ['private'],
    };
    const f = await setup('official', settings);
    let full = false;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/app/getAppAccessToken')
        response.end(
          JSON.stringify({ access_token: 'synthetic-access-token-462', expires_in: 7200 }),
        );
      else
        response.end(
          JSON.stringify({ id: mode === 'secret-response' ? secret : 'synthetic-accepted' }),
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const binding = {
      ...f.binding,
      check() {
        if (full && mode === 'internal-postflight') throw new KernelFault('internal');
      },
    };
    const io = createAuthorizedOfficialIo(f.host, binding, {
      fetch: async (url, init) => {
        const target = new URL(String(url));
        const response = await fetch(`http://127.0.0.1:${address.port}${target.pathname}`, init);
        return target.pathname.endsWith('/messages')
          ? flagResponseEof(response, () => {
              full = true;
            })
          : response;
      },
    });
    cleanups.push(async () => {
      await io.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const outcome = await io.send(
      { path: '/v2/users/target/messages', body: { msg_type: 0, msg_seq: 1, content: 'fixture' } },
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({
      ok: false,
      dispatched: true,
      error: { code: mode === 'secret-response' ? 'permission-denied' : 'internal' },
    });
    expect(JSON.stringify(outcome)).not.toContain(secret);
  },
);

it('reports unknown after a partial response and never sends a second part', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  let reached: () => void = () => {};
  let physicalClose: () => void = () => {};
  const partial = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    physicalClose = resolve;
  });
  let messageRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/app/getAppAccessToken')
      response.end(
        JSON.stringify({ access_token: 'synthetic-access-token-462', expires_in: 7200 }),
      );
    else if (request.url === '/gateway')
      response.end(JSON.stringify({ url: 'wss://gateway.qq.com/socket' }));
    else {
      messageRequests++;
      response.once('close', physicalClose);
      response.writeHead(200);
      response.write('{"id":"partial');
      reached();
    }
  });
  const gateways = new WebSocketServer({ server });
  gateways.on('connection', (socket) => {
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
    socket.on('message', (data) => {
      if ((JSON.parse(String(data)) as { op: number }).op === 2)
        socket.send(
          JSON.stringify({
            op: 0,
            t: 'READY',
            s: 1,
            d: { session_id: 'synthetic-session', user: { id: 'synthetic-bot' } },
          }),
        );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    fetch: (url, init) =>
      fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init),
    websocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
  });
  const driver = new OfficialQqDriver(io, { onStatus: () => {}, onEvent: async () => {} });
  cleanups.push(async () => {
    await driver.close();
    gateways.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const running = driver.start(new AbortController().signal);
  void running.catch(() => {});
  await vi.waitFor(() => expect(driver.status.phase).toBe('ready'));
  const connection = driver.status.connectionId;
  if (!connection) throw new Error('missing connection');
  const first = driver.send(
    'c2c',
    'target',
    { msg_type: 0, msg_seq: 1, content: 'one' },
    new AbortController().signal,
    connection,
  );
  await partial;
  f.host.permissionControl.revoke({ pluginId: f.binding.owner.pluginId, instanceId: 'default' });
  await closed;
  expect(await first).toMatchObject({
    ok: true,
    value: { connectionId: connection, receipt: { kind: 'unknown' } },
  });
  const second = await driver.send(
    'c2c',
    'target',
    { msg_type: 0, msg_seq: 2, content: 'two' },
    new AbortController().signal,
    connection,
  );
  expect(second.ok).toBe(false);
  expect(messageRequests).toBe(1);
  await driver.close();
  await running.catch(() => {});
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('distinguishes pre-dispatch refusal from a revoked real HTTP request and waits for closure', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  let requestReached = (): void => {};
  const reached = new Promise<void>((resolve) => {
    requestReached = resolve;
  });
  let socketClosed = (): void => {};
  const socketDone = new Promise<void>((resolve) => {
    socketClosed = resolve;
  });
  const calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(request.url ?? '');
    if (request.url === '/app/getAppAccessToken') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({ access_token: 'synthetic-access-token-462', expires_in: 7200 }),
      );
    } else {
      response.once('close', socketClosed);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"id":"');
      requestReached();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    fetch: (url, init) =>
      fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init),
  });
  cleanups.push(async () => {
    await io.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const request = {
    path: '/v2/users/user1/messages',
    body: { msg_type: 0, msg_seq: 1, content: 'hello' },
  };
  expect(
    await io.send({ ...request, path: '/v2/groups/g/messages' }, new AbortController().signal),
  ).toMatchObject({ ok: false, dispatched: false });
  expect(calls).toHaveLength(0);
  const pending = io.send(request, new AbortController().signal);
  await reached;
  f.host.permissionControl.revoke({ pluginId: f.binding.owner.pluginId, instanceId: 'default' });
  const outcome = await pending;
  await socketDone;
  expect(outcome).toMatchObject({ ok: false, dispatched: true });
  expect(JSON.stringify(outcome)).not.toContain(secret);
  expect(calls).toEqual(['/app/getAppAccessToken', '/v2/users/user1/messages']);
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it.each(['binary', 'oversized'] as const)(
  'rejects a %s reverse frame and drains the peer',
  async (mode) => {
    const settings: QQOneBotSettings = {
      protocol: 'onebot-v11',
      accountId: '555',
      mode: 'reverse-ws',
      channelMode: 'universal',
      mediaProfile: 'snowluma-v11',
      listenHost: '127.0.0.1',
      listenPort: 0,
      path: '/qq',
    };
    const f = await setup('onebot', settings);
    let ready: (port: number) => void = () => {};
    const listening = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const io = createAuthorizedOneBotIo(f.host, f.binding, {
      onListening: (address) => ready(address.port),
    });
    cleanups.push(() => io.close());
    const signal = new AbortController();
    const pending = io.nextPeer(signal.signal);
    const port = await listening;
    const remote = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        'X-Self-ID': '555',
        'X-Client-Role': 'Universal',
      },
    });
    remote.on('error', () => {});
    await once(remote, 'open');
    const peer = await pending;
    const noSend = await peer.send(
      { action: 'get_status', params: {}, echo: 'x' },
      AbortSignal.abort(),
    );
    expect(noSend).toMatchObject({ ok: false, dispatched: false });
    const next = peer.frames[Symbol.asyncIterator]().next();
    remote.send(mode === 'binary' ? Buffer.from([1, 2]) : 'x'.repeat(70_000));
    await expect(next).rejects.toBeInstanceOf(Error);
    await peer.close();
    await peer.settled;
    signal.abort();
    await io.close();
    await vi.waitFor(() => expect(f.host.permissions.diagnostics().leases).toBe(0));
  },
);

it('aborts the owned socket signal before a held physical write has settled', async () => {
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const accepted = once(sockets, 'connection');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  client.on('error', () => {});
  await once(client, 'open');
  const [raw] = (await accepted) as [WebSocket];
  const nativeSend = raw.send.bind(raw);
  let release: () => void = () => {};
  let callbackReached: () => void = () => {};
  const callbackPending = new Promise<void>((resolve) => {
    callbackReached = resolve;
  });
  Object.defineProperty(raw, 'send', {
    configurable: true,
    value: (data: string, callback: (error?: Error) => void) => {
      nativeSend(data, (error) => {
        release = () => callback(error);
        callbackReached();
      });
    },
  });
  const owned = ownedQqSocket(raw, new AbortController().signal, async () => {});
  const write = owned.send('hello', new AbortController().signal).catch((error: unknown) => error);
  await callbackPending;
  let settled = false;
  void owned.settled.then(() => {
    settled = true;
  });
  const closing = owned.close();
  expect(owned.signal.aborted).toBe(true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  release();
  await write;
  await closing;
  await owned.settled;
  expect(settled).toBe(true);
  sockets.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('sanitizes a failed captured check before any official I/O', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  const fetchSpy = vi.fn<typeof fetch>();
  const io = createAuthorizedOfficialIo(
    f.host,
    {
      ...f.binding,
      check() {
        throw new Error(secret);
      },
    },
    { fetch: fetchSpy },
  );
  cleanups.push(() => io.close());
  const error = await io.openGateway(new AbortController().signal).catch((cause: unknown) => cause);
  expect(error).toMatchObject({ error: { code: 'stale-owner' } });
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('revokes a live reverse peer and drains its source and credential leases', async () => {
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const f = await setup('onebot', settings);
  let ready: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const io = createAuthorizedOneBotIo(f.host, f.binding, {
    onListening: (address) => ready(address.port),
  });
  cleanups.push(() => io.close());
  const pending = io.nextPeer(new AbortController().signal);
  const port = await listening;
  const remote = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '555',
      'X-Client-Role': 'Universal',
    },
  });
  remote.on('error', () => {});
  await once(remote, 'open');
  const peer = await pending;
  const media = peer.openMedia(
    {
      action: 'download_file_stream',
      echo: `${SNOW_MEDIA_ECHO_PREFIX}0123456789abcdef0123456789abcdef:1`,
      params: { file_id: 'fixture', chunk_size: 16384 },
    },
    new AbortController().signal,
  );
  expect((await media.sent).ok).toBe(true);
  const reading = media.frames[Symbol.asyncIterator]()
    .next()
    .catch((error: unknown) => error);
  const closed = new Promise<void>((resolve) => remote.once('close', () => resolve()));
  f.host.permissionControl.revoke({ pluginId: f.binding.owner.pluginId, instanceId: 'default' });
  expect(peer.signal.aborted).toBe(true);
  expect(await reading).toBeInstanceOf(Error);
  await media.settled;
  await peer.settled;
  await closed;
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('checks the actual OneBot source task for every action and media write', async () => {
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const f = await setup('onebot', settings);
  let ready: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    ready = resolve;
  });
  let expireNext = false;
  let fenceCalls = 0;
  let expiresAt = 0;
  let reached: () => void = () => {};
  let release: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const io = createAuthorizedOneBotIo(
    f.host,
    {
      ...f.binding,
      requireOperationCheck: true,
      async check() {
        if (expireNext && ++fenceCalls === 2) {
          reached();
          await gate;
        }
      },
    },
    { onListening: (address) => ready(address.port) },
  );
  cleanups.push(async () => {
    release();
    await io.close();
  });
  const pending = io.nextPeer(new AbortController().signal);
  const port = await listening;
  const remote = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '555',
      'X-Client-Role': 'Universal',
    },
  });
  remote.on('error', () => {});
  await once(remote, 'open');
  const peer = await pending;
  const action = encodeOneBotAction(
    'send_private_msg',
    { user_id: 777, message: [{ type: 'text', data: { text: 'fixture' } }] },
    'action-1',
  );
  if (!action.ok) throw new Error('invalid action');
  const received: string[] = [];
  remote.on('message', (value) => received.push(String(value)));
  expect(await peer.send(action.value, new AbortController().signal)).toMatchObject({
    ok: false,
    dispatched: false,
    error: { code: 'permission-denied' },
  });
  let checks = 0;
  let permitted = true;
  let thrown: unknown;
  const task = f.host.runFor(f.binding.owner.pluginId, async (task) => {
    try {
      await withQqOperationCheck(
        f.host,
        task,
        async () => {
          checks++;
          if (!permitted) throw new KernelFault('permission-denied');
          expiresAt = performance.now() + (expireNext ? 20 : 1000);
          return expiresAt;
        },
        async () => {
          const actionSent = once(remote, 'message');
          expect(await peer.send(action.value, task.signal)).toEqual({ ok: true, value: null });
          await actionSent;
          const mediaSent = once(remote, 'message');
          const media = peer.openMedia(
            {
              action: 'download_file_stream',
              echo: `${SNOW_MEDIA_ECHO_PREFIX}0123456789abcdef0123456789abcdef:1`,
              params: { file_id: 'fixture', chunk_size: 16384 },
            },
            task.signal,
          );
          expect(await media.sent).toEqual({ ok: true, value: null });
          await mediaSent;
          expireNext = true;
          const held = peer.send(action.value, task.signal);
          await entered;
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.max(0, expiresAt - performance.now()) + 5),
          );
          release();
          expect(await held).toMatchObject({
            ok: false,
            dispatched: false,
            error: { code: 'timeout' },
          });
          expireNext = false;
          permitted = false;
          const denied = await peer.send(action.value, task.signal);
          expect(denied).toMatchObject({
            ok: false,
            dispatched: false,
            error: { code: 'permission-denied' },
          });
          expect(checks).toBe(4);
          await media.close();
          await media.settled;
          expect(checks).toBe(4); // Actual cleanup never requires a fresh remote grant.
        },
      );
      return null;
    } catch (error) {
      thrown = error;
      throw error;
    }
  });
  const result = await task.result;
  await task.settled;
  if (thrown) throw thrown;
  expect(result.ok).toBe(true);
  expect(received).toHaveLength(2);
  await io.close();
  await peer.settled;
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('owns and closes an incomplete reverse WebSocket upgrade on source shutdown', async () => {
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const f = await setup('onebot', settings);
  let ready: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const io = createAuthorizedOneBotIo(f.host, f.binding, {
    onListening: (address) => ready(address.port),
  });
  cleanups.push(() => io.close());
  const signal = new AbortController();
  const waiting = io.nextPeer(signal.signal).catch((error: unknown) => error);
  const port = await listening;
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write('GET /qq HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n');
  const closed = new Promise<void>((resolve) => {
    socket.on('error', () => {});
    socket.once('close', resolve);
  });
  signal.abort();
  await io.close();
  await closed;
  expect(await waiting).toBeInstanceOf(Error);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('routes a large registered media echo separately, drops late frames, and rejects echo reuse', async () => {
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const f = await setup('onebot', settings);
  let ready: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const io = createAuthorizedOneBotIo(f.host, f.binding, {
    onListening: (address) => ready(address.port),
  });
  cleanups.push(() => io.close());
  const lifetime = new AbortController();
  const pending = io.nextPeer(lifetime.signal);
  const port = await listening;
  const remote = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '555',
      'X-Client-Role': 'Universal',
    },
  });
  remote.on('error', () => {});
  await once(remote, 'open');
  const peer = await pending;
  const echo = `${SNOW_MEDIA_ECHO_PREFIX}0123456789abcdef0123456789abcdef:1`;
  const request = {
    action: 'download_file_stream' as const,
    echo,
    params: { file_id: 'fixture', chunk_size: 16384 },
  };
  const sent = once(remote, 'message');
  const exchange = peer.openMedia(request, lifetime.signal);
  expect(await exchange.sent).toEqual({ ok: true, value: null });
  expect(JSON.parse(String((await sent)[0]))).toMatchObject({
    action: 'download_file_stream',
    echo,
  });
  const bytes = Buffer.alloc(256 * 1024, 9);
  const data = bytes.toString('base64');
  const frame = JSON.stringify({
    status: 'ok',
    retcode: 0,
    echo,
    stream: 'stream-action',
    data: {
      type: 'stream',
      data_type: 'file_chunk',
      index: 0,
      data,
      size: bytes.length,
      base64_size: data.length,
    },
  });
  expect(Buffer.byteLength(frame)).toBeGreaterThan(64 * 1024);
  const mediaFrames = exchange.frames[Symbol.asyncIterator]();
  remote.send(frame);
  const next = await mediaFrames.next();
  if (next.done) throw new Error('missing chunk');
  const decoded = decodeSnowDownloadReply(next.value, echo);
  expect(
    decoded.ok &&
      decoded.value.kind === 'download-chunk' &&
      Buffer.from(decoded.value.bytes).equals(bytes),
  ).toBe(true);
  await exchange.close();
  await exchange.settled;
  expect(() => peer.openMedia(request, lifetime.signal)).toThrow();
  const normal = peer.frames[Symbol.asyncIterator]();
  remote.send(frame); // A late closed-echo frame is dropped even when larger than control frames.
  remote.send(
    JSON.stringify({
      post_type: 'meta_event',
      self_id: 555,
      time: 1,
      meta_event_type: 'heartbeat',
    }),
  );
  const nextNormal = await normal.next();
  expect(nextNormal.value).toContain('meta_event');
  lifetime.abort();
  await io.close();
  await peer.settled;
});

it('moves OneBot material bytes through the real peer and keeps unknown-size terminal truthful', async () => {
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const f = await setup('onebot', settings);
  let ready: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const io = createAuthorizedOneBotIo(f.host, f.binding, {
    onListening: (address) => ready(address.port),
  });
  cleanups.push(() => io.close());
  const lifetime = new AbortController();
  const pending = io.nextPeer(lifetime.signal);
  const port = await listening;
  const remote = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '555',
      'X-Client-Role': 'Universal',
    },
  });
  remote.on('error', () => {});
  await once(remote, 'open');
  const peer = await pending;
  const bytes = Buffer.alloc(70_001, 3);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const uploaded: Buffer[] = [];
  remote.on('message', (frame) => {
    const message = JSON.parse(String(frame)) as {
      action: string;
      echo: string;
      params: Record<string, unknown>;
    };
    const envelope = (data: unknown): void =>
      remote.send(
        JSON.stringify({
          status: 'ok',
          retcode: 0,
          echo: message.echo,
          stream: 'stream-action',
          data,
        }),
      );
    if (message.action === 'upload_file_stream') {
      const p = message.params;
      if (p['is_complete'] === true)
        envelope({
          type: 'response',
          status: 'file_complete',
          stream_id: p['stream_id'],
          received_chunks: p['total_chunks'],
          total_chunks: p['total_chunks'],
          file_path: '/remote/owned-file',
          file_name: p['filename'],
          file_size: p['file_size'],
          sha256: p['expected_sha256'],
        });
      else {
        uploaded.push(Buffer.from(String(p['chunk_data']), 'base64'));
        envelope({
          type: 'stream',
          status: 'chunk_received',
          stream_id: p['stream_id'],
          received_chunks: Number(p['chunk_index']) + 1,
          total_chunks: p['total_chunks'],
        });
      }
    } else if (message.action === 'download_file_image_stream') {
      const encoded = bytes.toString('base64');
      envelope({
        type: 'stream',
        data_type: 'file_info',
        file_name: 'fixture.bin',
        file_size: 0,
        chunk_size: 16384,
      });
      envelope({
        type: 'stream',
        data_type: 'file_chunk',
        index: 0,
        data: encoded,
        size: bytes.length,
        base64_size: encoded.length,
      });
      envelope({
        type: 'response',
        data_type: 'file_complete',
        file_name: 'fixture.bin',
        total_chunks: 1,
        total_bytes: bytes.length,
      });
    }
  });
  let seq = 0;
  const nextEcho = (): string =>
    `${SNOW_MEDIA_ECHO_PREFIX}0123456789abcdef0123456789abcdef:${++seq}`;
  const source = {
    name: 'fixture.bin',
    sizeBytes: bytes.length,
    sha256,
    async open() {
      let finish: () => void = () => {};
      const settled = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        body: {
          async *[Symbol.asyncIterator]() {
            try {
              yield bytes;
            } finally {
              finish();
            }
          },
        },
        settled,
        cancel: finish,
      };
    },
  };
  const result = await uploadSnowMedia(
    peer,
    { scene: 'private', targetId: '123', kind: 'file', source },
    peer.id,
    nextEcho,
    lifetime.signal,
  );
  expect(
    result.ok &&
      result.value.kind === 'complete' &&
      result.value.value.remotePath === '/remote/owned-file',
  ).toBe(true);
  expect(Buffer.concat(uploaded).equals(bytes)).toBe(true);
  const received: Buffer[] = [];
  const download = await downloadSnowMedia(
    peer,
    async () => ({ ok: false, error: makeError('not-ready'), dispatched: false }),
    {
      source: { kind: 'image', fileId: 'fixture-image' },
      expectedSizeBytes: null,
      expectedSha256: null,
    },
    async (chunk) => {
      received.push(Buffer.from(chunk));
    },
    peer.id,
    nextEcho,
    lifetime.signal,
  );
  expect(
    download.ok &&
      download.value.kind === 'complete' &&
      download.value.value.sizeBytes === bytes.length,
  ).toBe(true);
  if (download.ok && download.value.kind === 'complete')
    expect('transferId' in download.value.value).toBe(false);
  expect(Buffer.concat(received).equals(bytes)).toBe(true);
  lifetime.abort();
  await io.close();
  await peer.settled;
});

it('joins a socket reader still checking authority and fences its late frame on close', async () => {
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const accepted = once(sockets, 'connection');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  client.on('error', () => {});
  await once(client, 'open');
  const [raw] = (await accepted) as [WebSocket];
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const allowed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owned = ownedQqSocket(raw, new AbortController().signal, async () => {
    entered();
    await allowed;
  });
  const reading = owned.frames[Symbol.asyncIterator]()
    .next()
    .catch((error: unknown) => error);
  client.send('old-frame');
  await checking;
  let settled = false;
  void owned.settled.then(() => {
    settled = true;
  });
  const closing = owned.close();
  expect(owned.signal.aborted).toBe(true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  release();
  expect(await reading).toMatchObject({ done: true });
  await closing;
  expect(settled).toBe(true);
  sockets.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('joins a media reader that is still checking authority when its exchange closes', async () => {
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const f = await setup('onebot', settings);
  let blocked = false;
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const allowed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const binding = {
    ...f.binding,
    async check() {
      if (blocked) {
        entered();
        await allowed;
      }
    },
  };
  let ready: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const io = createAuthorizedOneBotIo(f.host, binding, {
    onListening: (address) => ready(address.port),
  });
  cleanups.push(() => io.close());
  const lifetime = new AbortController();
  const pending = io.nextPeer(lifetime.signal);
  const port = await listening;
  const remote = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '555',
      'X-Client-Role': 'Universal',
    },
  });
  remote.on('error', () => {});
  await once(remote, 'open');
  const peer = await pending;
  const echo = `${SNOW_MEDIA_ECHO_PREFIX}0123456789abcdef0123456789abcdef:1`;
  const exchange = peer.openMedia(
    { action: 'download_file_stream', echo, params: { file_id: 'fixture', chunk_size: 16384 } },
    lifetime.signal,
  );
  expect((await exchange.sent).ok).toBe(true);
  blocked = true;
  const read = exchange.frames[Symbol.asyncIterator]().next();
  remote.send(
    JSON.stringify({
      status: 'ok',
      retcode: 0,
      echo,
      stream: 'stream-action',
      data: {
        type: 'stream',
        data_type: 'file_info',
        file_name: 'x',
        file_size: 0,
        chunk_size: 16384,
      },
    }),
  );
  await checking;
  let settled = false;
  void exchange.settled.then(() => {
    settled = true;
  });
  const closing = exchange.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  blocked = false;
  release();
  await read;
  await closing;
  await exchange.settled;
  expect(settled).toBe(true);
  lifetime.abort();
  await io.close();
  await peer.settled;
});

it('checks the actual source task before every official multipart business dispatch', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  const wire: string[] = [];
  let upload = 0;
  const server = createServer((request, response) => {
    void (async () => {
      for await (const chunk of request) void chunk;
      const url = request.url ?? '';
      if (url !== '/app/getAppAccessToken') wire.push(url);
      response.setHeader('Content-Type', 'application/json');
      if (url === '/app/getAppAccessToken')
        response.end(JSON.stringify({ access_token: 'fixture-access-25', expires_in: 7200 }));
      else if (url.endsWith('/upload_prepare'))
        response.end(
          JSON.stringify({
            upload_id: `upload-${++upload}`,
            block_size: '1',
            parts: [
              {
                index: 0,
                block_size: '1',
                presigned_url: 'https://storage.qq.com/part?sig=private',
              },
            ],
          }),
        );
      else if (url === '/part' || url.endsWith('/upload_part_finish')) response.end('{}');
      else if (url.endsWith('/files'))
        response.end(
          JSON.stringify({ file_uuid: 'fixture', file_info: 'private-scope-only', ttl: 60 }),
        );
      else response.end(JSON.stringify({ id: 'fixture-message' }));
    })().catch(() => response.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server');
  const io = createAuthorizedOfficialIo(
    f.host,
    { ...f.binding, requireOperationCheck: true },
    {
      fetch: (url, init) =>
        fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init),
    },
  );
  cleanups.push(async () => {
    await io.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const signal = new AbortController().signal;
  const bytes = Buffer.from([42]);
  const hash = (name: string) => createHash(name).update(bytes).digest('hex');
  const metadata = {
    scene: 'c2c' as const,
    targetId: 'target',
    file_type: 4 as const,
    file_name: 'fixture.bin',
    sizeBytes: 1,
  };
  const hashes = {
    md5: hash('md5'),
    sha1: hash('sha1'),
    md5_10m: hash('md5'),
    sha256: hash('sha256'),
  };
  const message = {
    path: '/v2/users/target/messages',
    body: { msg_type: 0, msg_seq: 1, content: 'fixture' },
  };
  const noScope = await io.send(message, signal);
  expect(noScope).toMatchObject({
    ok: false,
    dispatched: false,
    error: { code: 'permission-denied' },
  });
  expect(wire).toEqual([]);
  let checks = 0;
  let allowed = true;
  let thrown: unknown;
  const task = f.host.runFor(f.binding.owner.pluginId, async (task) => {
    try {
      await expect(
        withQqOperationCheck(
          f.host,
          { ...task, taskId: 'forged-task' },
          async () => performance.now() + 1000,
          async () => null,
        ),
      ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let detached: Promise<unknown> | undefined;
      await withQqOperationCheck(
        f.host,
        task,
        async () => {
          checks++;
          if (!allowed) throw new KernelFault('permission-denied');
          return performance.now() + 1000;
        },
        async () => {
          async function* body() {
            yield bytes;
          }
          const first = await io.media.prepare(metadata, hashes, task.signal);
          if (!first.ok || first.value.kind !== 'prepared') throw new Error('prepare failed');
          const id = first.value.plan.upload_id;
          expect(
            (
              await io.media.putPart(
                { scene: 'c2c', targetId: 'target', upload_id: id, part_index: 0, byteLength: 1 },
                body(),
                task.signal,
              )
            ).ok,
          ).toBe(true);
          expect(
            (
              await io.media.finishPart(
                {
                  scene: 'c2c',
                  targetId: 'target',
                  upload_id: id,
                  part_index: 0,
                  block_size: '1',
                  md5: hashes.md5,
                },
                task.signal,
              )
            ).ok,
          ).toBe(true);
          expect(
            (
              await io.media.commit(
                { ...metadata, upload_id: id, srv_send_msg: false },
                task.signal,
              )
            ).ok,
          ).toBe(true);
          expect((await io.send(message, task.signal)).ok).toBe(true);
          expect(checks).toBe(5);
          const second = await io.media.prepare(metadata, hashes, task.signal);
          if (!second.ok || second.value.kind !== 'prepared')
            throw new Error('second prepare failed');
          const secondId = second.value.plan.upload_id;
          expect(
            (
              await io.media.putPart(
                {
                  scene: 'c2c',
                  targetId: 'target',
                  upload_id: secondId,
                  part_index: 0,
                  byteLength: 1,
                },
                body(),
                task.signal,
              )
            ).ok,
          ).toBe(true);
          allowed = false;
          const before = wire.length;
          const denied = await io.media.finishPart(
            {
              scene: 'c2c',
              targetId: 'target',
              upload_id: secondId,
              part_index: 0,
              block_size: '1',
              md5: hashes.md5,
            },
            task.signal,
          );
          expect(denied).toMatchObject({
            ok: false,
            dispatched: false,
            error: { code: 'permission-denied' },
          });
          expect(checks).toBe(8);
          expect(wire).toHaveLength(before);
          allowed = true;
          detached = gate.then(() => io.send(message, task.signal));
        },
      );
      const before = wire.length;
      release();
      if (!detached) throw new Error('missing detached fixture');
      expect(await detached).toMatchObject({
        ok: false,
        dispatched: false,
        error: { code: 'permission-denied' },
      });
      expect(wire).toHaveLength(before);
      return null;
    } catch (error) {
      thrown = error;
      throw error;
    }
  });
  const result = await task.result;
  await task.settled;
  if (thrown) throw thrown;
  expect(result.ok).toBe(true);
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('keeps a completed scoped receipt when authority is revoked after the body', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  let full = false;
  let revoked = false;
  let checks = 0;
  const server = createServer((request, response) => {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/app/getAppAccessToken')
      response.end(JSON.stringify({ access_token: 'fixture-access-25', expires_in: 7200 }));
    else response.end(JSON.stringify({ id: 'observed-accepted' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server');
  const io = createAuthorizedOfficialIo(
    f.host,
    {
      ...f.binding,
      requireOperationCheck: true,
      check() {
        if (full && !revoked) {
          revoked = true;
          f.host.permissionControl.revoke({
            pluginId: f.binding.owner.pluginId,
            instanceId: 'default',
          });
          throw new KernelFault('permission-denied');
        }
      },
    },
    {
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, init);
        return path.endsWith('/messages')
          ? flagResponseEof(response, () => {
              full = true;
            })
          : response;
      },
    },
  );
  cleanups.push(async () => {
    await io.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  let observed: unknown;
  const task = f.host.runFor(f.binding.owner.pluginId, async (task) => {
    observed = await withQqOperationCheck(
      f.host,
      task,
      async () => {
        checks++;
        return performance.now() + 1000;
      },
      () =>
        io.send(
          {
            path: '/v2/users/target/messages',
            body: { msg_type: 0, msg_seq: 1, content: 'fixture' },
          },
          task.signal,
        ),
    );
    return null;
  });
  await task.result;
  await task.settled;
  expect(checks).toBe(1);
  expect(revoked).toBe(true);
  expect(observed).toMatchObject({
    ok: true,
    value: { status: 200, body: '{"id":"observed-accepted"}' },
  });
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('expires a fresh scoped check after a held local fence without dispatching a body', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  let hold = false;
  let reached: () => void = () => {};
  let release: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let business = 0;
  const io = createAuthorizedOfficialIo(
    f.host,
    {
      ...f.binding,
      requireOperationCheck: true,
      async check() {
        if (hold) {
          reached();
          await gate;
          hold = false;
        }
      },
    },
    {
      fetch: async (url) => {
        if (String(url).endsWith('/app/getAppAccessToken'))
          return Response.json({ access_token: 'temporary-synthetic-access', expires_in: 7200 });
        business++;
        return Response.json({ id: 'must-not-send' });
      },
    },
  );
  cleanups.push(async () => {
    release();
    await io.close();
  });
  let observed: unknown;
  let deadline = 0;
  const task = f.host.runFor(f.binding.owner.pluginId, async (task) => {
    observed = await withQqOperationCheck(
      f.host,
      task,
      async () => {
        hold = true;
        deadline = performance.now() + 20;
        return deadline;
      },
      () =>
        io.send(
          {
            path: '/v2/users/target/messages',
            body: { msg_type: 0, msg_seq: 1, content: 'fixture' },
          },
          task.signal,
        ),
    );
    return null;
  });
  await entered;
  await new Promise<void>((resolve) =>
    setTimeout(resolve, Math.max(0, deadline - performance.now()) + 5),
  );
  release();
  await task.result;
  await task.settled;
  expect(observed).toMatchObject({ ok: false, dispatched: false, error: { code: 'timeout' } });
  expect(business).toBe(0);
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('streams official inline and registered multipart bytes without exposing presigned URLs or QQ authorization to storage', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  const rows: Array<{ url: string; authorization: string | undefined; body: Buffer }> = [];
  const block = 4 * 1024 * 1024;
  const full = Buffer.alloc(5 * 1024 * 1024 + 31, 7);
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      rows.push({ url: incoming.url ?? '', authorization: incoming.headers.authorization, body });
      outgoing.setHeader('Content-Type', 'application/json');
      if (incoming.url === '/app/getAppAccessToken')
        outgoing.end(
          JSON.stringify({ access_token: 'temporary-synthetic-access', expires_in: 7200 }),
        );
      else if (incoming.url?.endsWith('/upload_prepare'))
        outgoing.end(
          JSON.stringify({
            upload_id: 'owned-transfer',
            block_size: String(block),
            parts: [
              {
                index: 0,
                block_size: String(block),
                presigned_url: 'https://storage.qq.com/private-0?sig=fixture',
              },
              {
                index: 1,
                block_size: String(full.length - block),
                presigned_url: 'https://storage.qq.com/private-1?sig=fixture',
              },
            ],
          }),
        );
      else if (incoming.url?.endsWith('/upload_part_finish')) outgoing.end('{}');
      else if (incoming.url?.startsWith('/private-')) outgoing.end('{}');
      else
        outgoing.end(
          JSON.stringify({ file_uuid: 'fixture-id', file_info: 'private-file-info', ttl: 60 }),
        );
    })().catch(() => outgoing.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    fetch: (url, init) => {
      expect(init?.redirect).toBe('error');
      return fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init);
    },
  });
  cleanups.push(async () => {
    await io.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function* chunks(bytes: Buffer): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < bytes.length; offset += 32767)
      yield bytes.subarray(offset, offset + 32767);
  }
  const signal = new AbortController().signal;
  const small = Buffer.from('small-utf8-bytes');
  const inline = await io.media.inline(
    {
      scene: 'c2c',
      targetId: 'target',
      file_type: 4,
      file_name: 'file.txt',
      sizeBytes: small.length,
      srv_send_msg: false,
    },
    chunks(small),
    signal,
  );
  expect(inline.ok).toBe(true);
  const inlineWire = JSON.parse(
    rows.find((row) => row.url.endsWith('/files'))?.body.toString() ?? '{}',
  ) as { file_data: string; srv_send_msg: boolean };
  expect(Buffer.from(inlineWire.file_data, 'base64')).toEqual(small);
  expect(inlineWire.srv_send_msg).toBe(false);
  const metadata = {
    scene: 'c2c' as const,
    targetId: 'target',
    file_type: 4 as const,
    file_name: 'large.bin',
    sizeBytes: full.length,
  };
  const digest = (name: string, bytes: Buffer): string =>
    createHash(name).update(bytes).digest('hex');
  const prepared = await io.media.prepare(
    metadata,
    {
      md5: digest('md5', full),
      sha1: digest('sha1', full),
      md5_10m: digest('md5', full),
      sha256: digest('sha256', full),
    },
    signal,
  );
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error('prepare failed');
  expect(JSON.stringify(prepared)).not.toContain('storage.qq.com');
  if (prepared.value.kind !== 'prepared') throw new Error('prepare did not return a plan');
  const geometry = prepared.value.plan;
  expect(geometry.parts).toHaveLength(2);
  const forbidden = await io.media.putPart(
    {
      scene: 'group',
      targetId: 'other',
      upload_id: geometry.upload_id,
      part_index: 0,
      byteLength: block,
    },
    chunks(full.subarray(0, block)),
    signal,
  );
  expect(forbidden).toMatchObject({ ok: false, dispatched: false });
  for (const part of geometry.parts) {
    const bytes = full.subarray(part.offset, part.offset + part.byteLength);
    const uploaded = await io.media.putPart(
      {
        scene: metadata.scene,
        targetId: metadata.targetId,
        upload_id: geometry.upload_id,
        part_index: part.index,
        byteLength: bytes.length,
      },
      chunks(bytes),
      signal,
    );
    expect(uploaded.ok).toBe(true);
    const finished = await io.media.finishPart(
      {
        scene: metadata.scene,
        targetId: metadata.targetId,
        upload_id: geometry.upload_id,
        part_index: part.index,
        block_size: String(bytes.length),
        md5: digest('md5', bytes),
      },
      signal,
    );
    expect(finished.ok).toBe(true);
  }
  const repeated = await io.media.putPart(
    {
      scene: metadata.scene,
      targetId: metadata.targetId,
      upload_id: geometry.upload_id,
      part_index: 0,
      byteLength: block,
    },
    chunks(full.subarray(0, block)),
    signal,
  );
  expect(repeated).toMatchObject({ ok: false, dispatched: false });
  const result = await io.media.commit(
    { ...metadata, upload_id: geometry.upload_id, srv_send_msg: false },
    signal,
  );
  expect(result.ok).toBe(true);
  const storage = rows.filter((row) => row.url.startsWith('/private-'));
  expect(storage).toHaveLength(2);
  expect(storage.every((row) => row.authorization === undefined)).toBe(true);
  expect(Buffer.concat(storage.map((row) => row.body)).equals(full)).toBe(true);
  expect(
    JSON.parse(
      rows
        .filter((row) => row.url.endsWith('/files'))
        .at(-1)
        ?.body.toString() ?? '{}',
    ),
  ).toMatchObject({ upload_id: 'owned-transfer', srv_send_msg: false });
});

it.each([
  ['inline', 'revoke'],
  ['prepare', 'revoke'],
  ['put', 'revoke'],
  ['finish', 'revoke'],
  ['commit', 'revoke'],
  ['inline', 'transient-stale'],
] as const)('preserves completed media %s facts after postflight %s', async (stage, mode) => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  const bytes = Buffer.from([42]);
  const hash = (name: string): string => createHash(name).update(bytes).digest('hex');
  let armed = false;
  let full = false;
  let revoked = false;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      for await (const chunk of request) void chunk;
      requests.push(request.url ?? '');
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/app/getAppAccessToken')
        response.end(JSON.stringify({ access_token: 'fixture-access-token', expires_in: 7200 }));
      else if (request.url?.endsWith('/upload_prepare'))
        response.end(
          JSON.stringify({
            upload_id: 'receipt-upload',
            block_size: '1',
            parts: [
              {
                index: 0,
                block_size: '1',
                presigned_url: 'https://storage.qq.com/part?sig=private',
              },
            ],
          }),
        );
      else if (request.url?.endsWith('/upload_part_finish') || request.url === '/part')
        response.end('{}');
      else
        response.end(
          JSON.stringify({ file_uuid: 'fixture', file_info: 'private-old-scope-info', ttl: 60 }),
        );
    })().catch(() => response.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const binding = {
    ...f.binding,
    check() {
      if (armed && full && !revoked) {
        revoked = true;
        if (mode === 'revoke')
          f.host.permissionControl.revoke({
            pluginId: f.binding.owner.pluginId,
            instanceId: 'default',
          });
        throw new KernelFault(mode === 'revoke' ? 'permission-denied' : 'stale-owner');
      }
    },
  };
  const io = createAuthorizedOfficialIo(f.host, binding, {
    fetch: async (url, init) => {
      const target = new URL(String(url));
      const response = await fetch(`http://127.0.0.1:${address.port}${target.pathname}`, init);
      const selected =
        stage === 'put'
          ? target.hostname === 'storage.qq.com'
          : stage === 'prepare'
            ? target.pathname.endsWith('/upload_prepare')
            : stage === 'finish'
              ? target.pathname.endsWith('/upload_part_finish')
              : target.pathname.endsWith('/files');
      return armed && selected
        ? flagResponseEof(response, () => {
            full = true;
          })
        : response;
    },
  });
  cleanups.push(async () => {
    await io.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const metadata = {
    scene: 'c2c' as const,
    targetId: 'target',
    file_type: 4 as const,
    file_name: 'fixture',
    sizeBytes: bytes.length,
  };
  const hashes = {
    md5: hash('md5'),
    sha1: hash('sha1'),
    md5_10m: hash('md5'),
    sha256: hash('sha256'),
  };
  const signal = new AbortController().signal;
  async function* body(): AsyncGenerator<Uint8Array> {
    yield bytes;
  }
  let uploadId = '';
  if (stage === 'put' || stage === 'finish' || stage === 'commit') {
    const prepared = await io.media.prepare(metadata, hashes, signal);
    if (!prepared.ok || prepared.value.kind !== 'prepared') throw new Error('prepare failed');
    uploadId = prepared.value.plan.upload_id;
    if (stage === 'finish' || stage === 'commit') {
      const put = await io.media.putPart(
        { scene: 'c2c', targetId: 'target', upload_id: uploadId, part_index: 0, byteLength: 1 },
        body(),
        signal,
      );
      if (!put.ok || put.value.status !== 200) throw new Error('put failed');
    }
    if (stage === 'commit') {
      const finish = await io.media.finishPart(
        {
          scene: 'c2c',
          targetId: 'target',
          upload_id: uploadId,
          part_index: 0,
          block_size: '1',
          md5: hashes.md5,
        },
        signal,
      );
      if (!finish.ok || finish.value.status !== 200) throw new Error('finish failed');
    }
  }
  armed = true;
  const result =
    stage === 'inline'
      ? await io.media.inline({ ...metadata, srv_send_msg: false }, body(), signal)
      : stage === 'prepare'
        ? await io.media.prepare(metadata, hashes, signal)
        : stage === 'put'
          ? await io.media.putPart(
              {
                scene: 'c2c',
                targetId: 'target',
                upload_id: uploadId,
                part_index: 0,
                byteLength: 1,
              },
              body(),
              signal,
            )
          : stage === 'finish'
            ? await io.media.finishPart(
                {
                  scene: 'c2c',
                  targetId: 'target',
                  upload_id: uploadId,
                  part_index: 0,
                  block_size: '1',
                  md5: hashes.md5,
                },
                signal,
              )
            : await io.media.commit(
                { ...metadata, upload_id: uploadId, srv_send_msg: false },
                signal,
              );
  expect(revoked).toBe(true);
  expect(result.ok).toBe(true);
  if (stage === 'prepare' && result.ok)
    expect(result.value).toMatchObject({ kind: 'prepared', plan: { upload_id: 'receipt-upload' } });
  if ((stage === 'inline' || stage === 'commit') && result.ok && 'body' in result.value)
    expect(result.value.body).toContain('private-old-scope-info');
  const before = requests.length;
  const next = await io.send(
    {
      path: '/v2/users/target/messages',
      body: { msg_type: 0, msg_seq: 1, content: 'must not send' },
    },
    signal,
  );
  expect(next).toMatchObject({ ok: false, dispatched: false });
  expect(requests).toHaveLength(before);
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('releases finished presigned registrations without making prior uploads replayable', async () => {
  const f = await setup('official', {
    protocol: 'official',
    appId: '555',
    scenes: ['private'],
  } as QQOfficialSettings);
  let sequence = 0;
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    fetch: async (url, init) => {
      const target = new URL(String(url));
      if (target.pathname === '/app/getAppAccessToken')
        return Response.json({ access_token: 'fixture-access-token', expires_in: 7200 });
      if (target.pathname.endsWith('/upload_prepare'))
        return Response.json({
          upload_id: `owned-${++sequence}`,
          block_size: '1',
          parts: [
            {
              index: 0,
              block_size: '1',
              presigned_url: `https://storage.qq.com/${sequence}?sig=hidden`,
            },
          ],
        });
      if (target.hostname === 'storage.qq.com') {
        for await (const chunk of init?.body as unknown as AsyncIterable<Uint8Array>) {
          void chunk;
        }
        return Response.json({});
      }
      if (target.pathname.endsWith('/upload_part_finish')) return Response.json({});
      return Response.json({ file_uuid: 'fixture', file_info: 'opaque', ttl: 60 });
    },
  });
  cleanups.push(() => io.close());
  const bytes = Buffer.from([42]);
  const hash = (name: string): string => createHash(name).update(bytes).digest('hex');
  const metadata = {
    scene: 'c2c' as const,
    targetId: 'target',
    file_type: 4 as const,
    file_name: 'x',
    sizeBytes: 1,
  };
  const signal = new AbortController().signal;
  let lastId = '';
  for (let index = 0; index < 17; index++) {
    const prepared = await io.media.prepare(
      metadata,
      { md5: hash('md5'), sha1: hash('sha1'), md5_10m: hash('md5'), sha256: hash('sha256') },
      signal,
    );
    if (!prepared.ok || prepared.value.kind !== 'prepared') throw new Error('prepare failed');
    lastId = prepared.value.plan.upload_id;
    const part = {
      scene: 'c2c' as const,
      targetId: 'target',
      upload_id: lastId,
      part_index: 0,
      byteLength: 1,
    };
    async function* body(): AsyncGenerator<Uint8Array> {
      yield bytes;
    }
    expect((await io.media.putPart(part, body(), signal)).ok).toBe(true);
    expect(
      (
        await io.media.finishPart(
          {
            scene: 'c2c',
            targetId: 'target',
            upload_id: lastId,
            part_index: 0,
            block_size: '1',
            md5: hash('md5'),
          },
          signal,
        )
      ).ok,
    ).toBe(true);
    expect(
      (await io.media.commit({ ...metadata, upload_id: lastId, srv_send_msg: false }, signal)).ok,
    ).toBe(true);
  }
  expect(
    await io.media.commit({ ...metadata, upload_id: lastId, srv_send_msg: false }, signal),
  ).toMatchObject({ ok: false, dispatched: false });
});

it('prevents concurrent duplicate part writes and never commits an unconfirmed finish', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  const bytes = Buffer.from('ten-bytes!');
  const digest = (kind: string): string => createHash(kind).update(bytes).digest('hex');
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const allowed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let puts = 0;
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    fetch: async (url, init) => {
      const target = new URL(String(url));
      if (target.pathname === '/app/getAppAccessToken')
        return Response.json({ access_token: 'fixture-access-token', expires_in: 7200 });
      if (target.pathname.endsWith('/upload_prepare'))
        return Response.json({
          upload_id: 'one-attempt',
          block_size: String(bytes.length),
          parts: [
            {
              index: 0,
              block_size: String(bytes.length),
              presigned_url: 'https://storage.qq.com/once?sig=private',
            },
          ],
        });
      if (target.hostname === 'storage.qq.com') {
        puts++;
        for await (const chunk of init?.body as unknown as AsyncIterable<Uint8Array>) {
          void chunk;
        }
        entered();
        await allowed;
        return Response.json({});
      }
      if (target.pathname.endsWith('/upload_part_finish'))
        return Response.json({ code: 1 }, { status: 500 });
      throw new Error('unexpected dispatch');
    },
  });
  cleanups.push(() => io.close());
  const metadata = {
    scene: 'c2c' as const,
    targetId: 'target',
    file_type: 4 as const,
    file_name: 'fixture',
    sizeBytes: bytes.length,
  };
  const signal = new AbortController().signal;
  const prepared = await io.media.prepare(
    metadata,
    { md5: digest('md5'), sha1: digest('sha1'), md5_10m: digest('md5'), sha256: digest('sha256') },
    signal,
  );
  if (!prepared.ok || prepared.value.kind !== 'prepared') throw new Error('prepare failed');
  const part = {
    scene: 'c2c' as const,
    targetId: 'target',
    upload_id: prepared.value.plan.upload_id,
    part_index: 0,
    byteLength: bytes.length,
  };
  async function* body(): AsyncGenerator<Uint8Array> {
    yield bytes;
  }
  const first = io.media.putPart(part, body(), signal);
  await pending;
  try {
    expect(await io.media.putPart(part, body(), signal)).toMatchObject({
      ok: false,
      dispatched: false,
    });
    expect(puts).toBe(1);
  } finally {
    release();
  }
  expect((await first).ok).toBe(true);
  const finish = {
    scene: 'c2c' as const,
    targetId: 'target',
    upload_id: part.upload_id,
    part_index: 0,
    block_size: String(bytes.length),
    md5: digest('md5'),
  };
  expect(await io.media.finishPart(finish, signal)).toMatchObject({
    ok: true,
    value: { status: 500 },
  });
  expect(await io.media.finishPart(finish, signal)).toMatchObject({ ok: false, dispatched: false });
  expect(
    await io.media.commit({ ...metadata, upload_id: part.upload_id, srv_send_msg: false }, signal),
  ).toMatchObject({ ok: false, dispatched: false });
});

it('hashes the exact documented prefix and reads only ordered material ranges for a large official upload', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  const full = Buffer.alloc(10_002_432 + 107, 19);
  full[10_002_431] = 77;
  full[10_002_432] = 33;
  const block = 4 * 1024 * 1024;
  const ranges: Array<[number, number]> = [];
  const sent: Buffer[] = [];
  let prepareBody: Record<string, unknown> | undefined;
  const hash = (kind: string, value: Uint8Array): string =>
    createHash(kind).update(value).digest('hex');
  const source = {
    name: 'synthetic.bin',
    sizeBytes: full.length,
    sha256: hash('sha256', full),
    async open(offset: number, length: number) {
      ranges.push([offset, length]);
      let complete: () => void = () => {};
      const settled = new Promise<void>((resolve) => {
        complete = resolve;
      });
      return {
        body: {
          async *[Symbol.asyncIterator]() {
            try {
              for (let n = offset; n < offset + length; n += 65536)
                yield full.subarray(n, Math.min(offset + length, n + 65536));
            } finally {
              complete();
            }
          },
        },
        settled,
        cancel() {
          complete();
        },
      };
    },
  };
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    fetch: async (url, init) => {
      const target = new URL(String(url));
      if (target.pathname === '/app/getAppAccessToken')
        return Response.json({ access_token: 'synthetic-access-token-462', expires_in: 7200 });
      if (target.pathname.endsWith('/upload_prepare')) {
        prepareBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          upload_id: 'owned-hash-upload',
          block_size: String(block),
          parts: Array.from({ length: Math.ceil(full.length / block) }, (_, index) => ({
            index,
            block_size: String(Math.min(block, full.length - index * block)),
            presigned_url: `https://storage.qq.com/part-${index}?signature=hidden`,
          })),
        });
      }
      if (target.hostname === 'storage.qq.com') {
        expect(new Headers(init?.headers).has('authorization')).toBe(false);
        const chunks: Buffer[] = [];
        for await (const chunk of init?.body as unknown as AsyncIterable<Uint8Array>)
          chunks.push(Buffer.from(chunk));
        sent.push(Buffer.concat(chunks));
        return Response.json({});
      }
      if (target.pathname.endsWith('/upload_part_finish')) return Response.json({});
      return Response.json({ file_uuid: 'fixture', file_info: 'opaque-host-only', ttl: 60 });
    },
  });
  cleanups.push(() => io.close());
  const result = await uploadOfficialMedia(
    io.media,
    { scene: 'c2c', targetId: 'target', fileType: 4, source },
    'fixture-connection',
    new AbortController().signal,
  );
  expect(result.ok && result.value.receipt.kind === 'media-upload-accepted').toBe(true);
  expect(prepareBody?.['md5_10m']).toBe(hash('md5', full.subarray(0, 10_002_432)));
  expect(prepareBody?.['md5_10m']).not.toBe(hash('md5', full.subarray(0, 10 * 1024 * 1024)));
  expect(ranges).toEqual([
    [0, full.length],
    [0, block],
    [block, block],
    [2 * block, full.length - 2 * block],
  ]);
  expect(Buffer.concat(sent).equals(full)).toBe(true);
});

it('pins approved official attachment DNS, streams bounded bytes and never forwards credentials', async () => {
  const settings: QQOfficialSettings = { protocol: 'official', appId: '555', scenes: ['private'] };
  const f = await setup('official', settings);
  const content = Buffer.from('synthetic-attachment-body');
  const headers: Array<string | undefined> = [];
  let redirect = false;
  const server = createServer((request, response) => {
    headers.push(request.headers.authorization);
    if (redirect) {
      response.writeHead(302, { Location: 'http://127.0.0.1/forbidden' });
      response.end();
      return;
    }
    response.setHeader('Content-Length', content.length);
    response.end(content);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  let resolvedAddress = '8.8.8.8';
  let resolvedFamily: 4 | 6 = 4;
  let extraPrivate = false;
  let opens = 0;
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    attachment: {
      lookup: async () => [
        { address: resolvedAddress, family: resolvedFamily },
        ...(extraPrivate ? [{ address: '10.1.2.3', family: 4 as const }] : []),
      ],
      open: async (url, pinned, signal) =>
        new Promise((resolve, reject) => {
          expect(url.hostname).toBe('multimedia.nt.qq.com.cn');
          expect(pinned.address).toBe('8.8.8.8');
          opens++;
          const request = httpRequest(
            { host: '127.0.0.1', port: address.port, path: '/fixture', method: 'GET', signal },
            (response) =>
              resolve({
                response,
                closed,
                abort: () => {
                  response.destroy();
                  request.destroy();
                },
              }),
          );
          const closed = new Promise<void>((done) => request.once('close', () => done()));
          request.on('error', reject);
          request.end();
        }),
    },
  });
  cleanups.push(async () => {
    await io.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const input = {
    scene: 'c2c' as const,
    targetId: 'target',
    url: 'https://multimedia.nt.qq.com.cn/download?rkey=synthetic',
    maximumBytes: 1024,
  };
  await expect(
    io.media.readAttachment(
      { ...input, url: 'https://attacker.invalid/file' },
      new AbortController().signal,
      async () => {},
    ),
  ).rejects.toBeInstanceOf(Error);
  for (const [address, family] of [
    ['127.0.0.1', 4],
    ['10.2.3.4', 4],
    ['169.254.1.2', 4],
    ['::ffff:127.0.0.1', 6],
    ['fc00::1', 6],
    ['2002:7f00:1::', 6],
  ] as const) {
    resolvedAddress = address;
    resolvedFamily = family;
    await expect(
      io.media.readAttachment(input, new AbortController().signal, async () => {}),
    ).rejects.toBeInstanceOf(Error);
  }
  expect(opens).toBe(0);
  resolvedAddress = '8.8.8.8';
  resolvedFamily = 4;
  extraPrivate = true;
  await expect(
    io.media.readAttachment(input, new AbortController().signal, async () => {}),
  ).rejects.toBeInstanceOf(Error);
  expect(opens).toBe(0);
  extraPrivate = false;
  const read = await io.media.readAttachment(input, new AbortController().signal, async () => {});
  const received: Uint8Array[] = [];
  for await (const chunk of read.body) received.push(chunk);
  await read.settled;
  expect(Buffer.concat(received).equals(content)).toBe(true);
  expect(headers).toEqual([undefined]);
  expect(opens).toBe(1);
  await expect(
    io.media.readAttachment(
      { ...input, maximumBytes: 2 },
      new AbortController().signal,
      async () => {},
    ),
  ).rejects.toBeInstanceOf(Error);
  redirect = true;
  await expect(
    io.media.readAttachment(input, new AbortController().signal, async () => {}),
  ).rejects.toBeInstanceOf(Error);
  expect(opens).toBe(3);
  expect(headers).toEqual([undefined, undefined, undefined]);
});

it.each(['source', 'material-grant'] as const)(
  'aborts an in-flight attachment on %s revoke and joins the native socket',
  async (mode) => {
    const settings: QQOfficialSettings = {
      protocol: 'official',
      appId: '555',
      scenes: ['private'],
    };
    const f = await setup('official', settings);
    let socketClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      socketClosed = resolve;
    });
    const server = createServer((_request, response) => {
      response.on('close', socketClosed);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.write(Buffer.from('first-chunk'));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const io = createAuthorizedOfficialIo(f.host, f.binding, {
      attachment: {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        open: async (_url, _pinned, signal) =>
          new Promise((resolve, reject) => {
            const request = httpRequest(
              { host: '127.0.0.1', port: address.port, path: '/', signal },
              (response) =>
                resolve({
                  response,
                  closed: requestClosed,
                  abort: () => {
                    response.destroy();
                    request.destroy();
                  },
                }),
            );
            const requestClosed = new Promise<void>((done) => request.once('close', () => done()));
            request.on('error', reject);
            request.end();
          }),
      },
    });
    cleanups.push(async () => {
      await io.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    let granted = true;
    const read = await io.media.readAttachment(
      {
        scene: 'c2c',
        targetId: 'target',
        url: 'https://multimedia.nt.qq.com.cn/download?fileid=synthetic',
        maximumBytes: 1024,
      },
      new AbortController().signal,
      async () => {
        if (!granted) throw new Error('revoked');
      },
    );
    const iterator = read.body[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    const outcome = read.settled.catch((error: unknown) => error);
    if (mode === 'source')
      f.host.permissionControl.revoke({
        pluginId: f.binding.owner.pluginId,
        instanceId: 'default',
      });
    else {
      granted = false;
      await expect(iterator.next()).rejects.toBeInstanceOf(Error);
    }
    await closed;
    expect(await outcome).toBeInstanceOf(Error);
    await io.close();
    expect(f.host.permissions.diagnostics().leases).toBe(0);
    expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  },
);
