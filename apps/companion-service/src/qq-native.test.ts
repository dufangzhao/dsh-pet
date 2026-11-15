import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, expect, it } from 'vitest';
import type { PluginManifest, QQOfficialSettings, QQOneBotSettings } from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import {
  CompanionPluginHost,
  companionHostDefinition,
  companionHostManifest,
} from '@pet/companion-runtime';
import {
  createAuthorizedOfficialIo,
  createAuthorizedOneBotIo,
  type CapturedQqBinding,
} from '@pet/local-host/qq-native';
import { OfficialQqDriver } from '../../../plugins/qq-official/src/driver.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const secret = 'isolated-qq-test-secret-8a2ef0';
const access = 'isolated-qq-access-token-49b0d';
// Public, synthetic loopback certificate and key used only by the controlled WSS fixture.
const fixtureKey = `-----BEGIN PRIVATE KEY-----
MIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQCd2/R9GPmfW0NV
5l+Bn/fPMqrHPHV4dMrr29a7LRhxTq0MqOuXj3MDHB51cys8M10xvoLaRMdMrrYO
OwELL9CyHx/N2frhIqmZMV34Ln8RmMutK0p+0rBUE5JZSqHFIdcty+VjVSdoR7/s
oM10PBNm+U8ojXy1/S8TxUTfSZfbt2y8lN5VZF0hLD5cbwl7QWgQYjwRjSmqx+DG
Q65HFWAjicdVioHh1JpmUdh4MECFHyt8BGsM/ch/RbsUYHR3KKMbh2tYOXgtjnw3
qYC9+ZtB3il5bgvM8Rl/sVhLCxlfCJo2FgxBCVm0vW8wWo7hdzipahmBD7BCt+D6
T2AnCCtdAgMBAAECgf8OLrTIiHXk204xaYErJDQfaW3ueIAVUmjox9eC+Yo4o9jo
SkTgWQL8RIp4AuDfh73XukYHViaRvSCeJq7xUlptpl41IGBp2bNjEAxhP8wqyI+D
/1+yBTvSUe/UFeBy1Zd/hdIWGpBvzgJwQAI1bzBPEBcMjammsBiKri6B4RrDopL7
PIHnXojC2tofUgtzwO6OiVJnPNWbCOxB0eN/tuo1nmn8J/meNPKDjFYe+qEd4Ich
GZ82IQSeaCBHT2J24QP5kRxAZ8L24H35C6urK4ylpj+/lqmXyNsLFyWqnjjoEVK8
ut3O+d0ptVHxve3pUXZjtZI93QoYIqrKOhWCbyUCgYEAwOX45QLCLYGQoPSAdASw
BRhNYDBJj11WXYcS1P+Tcz55kcF7RSpvNzPS7EygeU+yR3c0ZEaHwBq8LRj8zi/S
wkrRO11rsTLJAbwoolcTsphUlArYXDVNusF17UMpPkbBKXByByG6gWmTh4CDuyJp
osfGklYnS328mzyrO+Vac08CgYEA0X+syz2+s7yrDPa1Em2ugOe9KnbcyJGuabx9
I6T3wTgqqUruSlxT9wB1dWrVVta+wo6E4eqgABHlcBfs9rO0teue+lk872L4DNmx
XAR/Tt76C3Bkl0/hKQGdeN35WtJE4j976N5HXE/s4GxdzHmD2+rbnfmMOLfnqr7S
EO3/e5MCgYAIE5jwPcVTknEzzAj00p1sGTBkLqFl10qeb+Fh+bF6ycrdR3SZ2MT/
UrQqIKs3aRbV1y/iYvGcIYJvgPRUzbvNVsSb77Vqne28nNw2r96rQ6WG7U1RzwmK
ID+Hx6Aac2vzCDo+AjOE5569tavOUgqKPkMaLXFHv+P9u/SPdXLsEQKBgQCk1c0y
WNGsf/0iBRcxecU8vZl0SPOsiBtwLJNVsV4S1EuUylU1gvG5vc2tZjKX0f1j/VkG
nGHpzCr3iIu1DG5aWRrMJdyxCfDbw4kuOoekmgKpb3RmLb6eUhwB1r10vU7fqU2o
SwRg2K4rYnhnAxFBvsevw4KVufV4vg1wrqI/KwKBgFyhisCoILBIgiSTnimeIus3
xD3XAxDWzcSg+6dfxbOkroHpalexv90o1LDaTPOAYyKHhMfb2y3Nzz78zwMozPnO
sTrjzTiq5v6h0hrrHgLdi2KbLxDGLVI5W148tlTKiyUnqSgkvPJLYTb53VUyOxbB
S9M0ouOAU6kKJPg07YCO
-----END PRIVATE KEY-----`;
const fixtureCertificate = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUdPhUWtgXpfL8RBOjpbhsMfc6UjQwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTExMzIzMDU0MloXDTM2MTEx
MDIzMDU0MlowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAndv0fRj5n1tDVeZfgZ/3zzKqxzx1eHTK69vWuy0YcU6t
DKjrl49zAxwedXMrPDNdMb6C2kTHTK62DjsBCy/Qsh8fzdn64SKpmTFd+C5/EZjL
rStKftKwVBOSWUqhxSHXLcvlY1UnaEe/7KDNdDwTZvlPKI18tf0vE8VE30mX27ds
vJTeVWRdISw+XG8Je0FoEGI8EY0pqsfgxkOuRxVgI4nHVYqB4dSaZlHYeDBAhR8r
fARrDP3If0W7FGB0dyijG4drWDl4LY58N6mAvfmbQd4peW4LzPEZf7FYSwsZXwia
NhYMQQlZtL1vMFqO4Xc4qWoZgQ+wQrfg+k9gJwgrXQIDAQABo28wbTAdBgNVHQ4E
FgQUPRNaUphvqvsyRaefx9tZxr5Hk14wHwYDVR0jBBgwFoAUPRNaUphvqvsyRaef
x9tZxr5Hk14wDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBAHURPvDcCFDT3uEYh9e/BmbvVxWS7NP5
HRmgnAL+Z2U1RPNwwfrV7qDYX4OjZnh8zegWsKH9w6kyCu590RMYtNyETmHdSTSN
BzqCkTt8rSwGnx7osebueYIIx2x8sScv4EfTffoo4QHwIs6FbKmp7PkpIAaaE64D
5rNeEQt0/IDamWln4yOc+r3CjR40u7cp04TOirjx3V76eAPL7fMW+owS758zx3mC
xU6HoRwvQ+0I34iA9Tk1YqkuPgzsYR8G9UuvB3Zv+vAHfsBD/Nldv90jRZOvc0cc
HzoaV04KLHkHhlJLPiSzvb5VVxZqaqTbrCHzl26sUrnHkeMuUTIyP9M=
-----END CERTIFICATE-----`;

async function source<S>(
  protocol: 'official' | 'onebot',
  settings: S,
): Promise<{ host: CompanionPluginHost; binding: CapturedQqBinding<S>; abort: AbortController }> {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-qq-io-test-'));
  const sourceDirectory = path.join(root, 'source');
  const hostDirectory = path.join(root, 'host');
  await mkdir(sourceDirectory);
  await mkdir(hostDirectory);
  const manifest = JSON.parse(
    await readFile(new URL(`../../../plugins/qq-${protocol}/plugin.json`, import.meta.url), 'utf8'),
  ) as PluginManifest;
  await writeFile(path.join(sourceDirectory, 'plugin.json'), JSON.stringify(manifest));
  await writeFile(path.join(hostDirectory, 'plugin.json'), JSON.stringify(companionHostManifest));
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(root, 'data'),
    plugins: [
      {
        manifest: companionHostManifest,
        directory: hostDirectory,
        definition: companionHostDefinition,
        preset: 'allow',
        enabled: true,
      },
      {
        manifest,
        directory: sourceDirectory,
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
  const abort = new AbortController();
  const binding: CapturedQqBinding<S> = {
    owner: host.owner(manifest.id),
    signal: abort.signal,
    configRevision: 1,
    credentialVersion: 'synthetic-version',
    settings,
    credential: secret,
    check: () => {},
  };
  cleanups.push(async () => {
    abort.abort();
    await host.close();
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-qq-io-test-')
    )
      throw new Error('unexpected test directory');
    await rm(target, { recursive: true });
  });
  return { host, binding, abort };
}
const official: QQOfficialSettings = {
  protocol: 'official',
  appId: '12345',
  scenes: ['private', 'group'],
};
const onebot = (port: number): QQOneBotSettings => ({
  protocol: 'onebot-v11',
  accountId: '12345',
  mode: 'reverse-ws',
  channelMode: 'universal',
  mediaProfile: 'snowluma-v11',
  listenHost: '127.0.0.1',
  listenPort: port,
  path: '/private-qq-ws',
});

it('keeps official credentials host-private and drains a real controlled gateway', async () => {
  const f = await source('official', official);
  const server = createServer();
  const ws = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const urls: string[] = [];
  const headers: Array<Headers> = [];
  const io = createAuthorizedOfficialIo(f.host, f.binding, {
    fetch: async (input, init) => {
      urls.push(String(input));
      headers.push(new Headers(init?.headers));
      if (String(input).endsWith('/app/getAppAccessToken')) {
        expect(JSON.parse(String(init?.body))).toEqual({ appId: '12345', clientSecret: secret });
        return Response.json({ access_token: access, expires_in: 7200 });
      }
      if (String(input).endsWith('/gateway'))
        return Response.json({ url: 'wss://gateway.qq.com/socket' });
      return Response.json({ id: 'message-id' });
    },
    websocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
  });
  cleanups.push(async () => {
    await io.close();
    ws.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  expect(urls).toHaveLength(0);
  const incoming = once(ws, 'connection');
  const gateway = await io.openGateway(new AbortController().signal);
  const [remote] = (await incoming) as [WebSocket];
  const receive = once(remote, 'message');
  await gateway.identify(new AbortController().signal);
  const [raw] = await receive;
  expect(JSON.parse(String(raw))).toMatchObject({ op: 2, d: { token: `QQBot ${access}` } });
  remote.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 5000 } }));
  const frame = await gateway.frames[Symbol.asyncIterator]().next();
  expect(frame.value).not.toContain(access);
  const sent = await io.send(
    { path: '/v2/users/user1/messages', body: { msg_type: 0, msg_seq: 1, content: 'test' } },
    new AbortController().signal,
  );
  expect(sent).toMatchObject({ ok: true, value: { status: 200 } });
  expect(urls.every((url) => url.startsWith('https://api.bot.qq.com/'))).toBe(true);
  expect(headers.some((value) => value.get('authorization') === `QQBot ${access}`)).toBe(true);
  const before = urls.length;
  const cancelled = AbortSignal.abort();
  expect(
    await io.send(
      { path: '/v2/users/user1/messages', body: { msg_type: 0, msg_seq: 1, content: 'test' } },
      cancelled,
    ),
  ).toMatchObject({ ok: false, dispatched: false });
  expect(urls).toHaveLength(before);
  await gateway.close();
  await gateway.settled;
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('retains an immediate TLS gateway HELLO for each independently opened source', async () => {
  const f = await source('official', official);
  let tokenRequests = 0;
  let gatewayRequests = 0;
  const http = createServer((request, response) => {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/app/getAppAccessToken') {
      tokenRequests++;
      response.end(JSON.stringify({ access_token: access, expires_in: 7200 }));
    } else if (request.url === '/gateway') {
      gatewayRequests++;
      response.end(JSON.stringify({ url: 'wss://gateway.qq.com/socket' }));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  const tls = createHttpsServer({ key: fixtureKey, cert: fixtureCertificate });
  const gateways = new WebSocketServer({ server: tls });
  let connections = 0;
  let identifications = 0;
  gateways.on('connection', (socket) => {
    connections++;
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
    socket.on('message', (message) => {
      const frame = JSON.parse(String(message)) as { op: number; d?: { token?: string } };
      if (frame.op !== 2) return;
      expect(frame.d?.token).toBe(`QQBot ${access}`);
      identifications++;
      socket.send(
        JSON.stringify({
          op: 0,
          t: 'READY',
          s: 1,
          d: { session_id: 'fixture-session', user: { id: 'fixture-bot' } },
        }),
      );
    });
  });
  http.listen(0, '127.0.0.1');
  tls.listen(0, '127.0.0.1');
  await Promise.all([once(http, 'listening'), once(tls, 'listening')]);
  const httpAddress = http.address();
  const tlsAddress = tls.address();
  if (
    !httpAddress ||
    typeof httpAddress === 'string' ||
    !tlsAddress ||
    typeof tlsAddress === 'string'
  )
    throw new Error('missing addresses');
  cleanups.push(async () => {
    gateways.close();
    http.closeAllConnections();
    tls.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => http.close(() => resolve())),
      new Promise<void>((resolve) => tls.close(() => resolve())),
    ]);
  });
  for (let n = 0; n < 8; n++) {
    const io = createAuthorizedOfficialIo(f.host, f.binding, {
      fetch: (url, init) =>
        fetch(`http://127.0.0.1:${httpAddress.port}${new URL(String(url)).pathname}`, init),
      websocket: () =>
        new WebSocket(`wss://127.0.0.1:${tlsAddress.port}`, { ca: fixtureCertificate }),
    });
    let resolved: () => void = () => {};
    let rejected: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      resolved = resolve;
      rejected = reject;
    });
    const driver = new OfficialQqDriver(
      io,
      {
        onStatus: (status) => {
          if (status.phase === 'ready') resolved();
          if (status.phase === 'failed')
            rejected(new Error(`gateway failed: ${status.error?.code}`));
        },
        onEvent: async () => {},
      },
      { reconnectAttempts: 0, handshakeTimeoutMs: 1500 },
    );
    const running = driver.start(new AbortController().signal);
    void running.catch(() => {});
    try {
      await ready;
      expect(driver.status.phase).toBe('ready');
      expect(driver.status.selfId).toBe('fixture-bot');
    } finally {
      await driver.close();
      await running.catch(() => {});
    }
  }
  expect(tokenRequests).toBe(8);
  expect(gatewayRequests).toBe(8);
  expect(connections).toBe(8);
  expect(identifications).toBe(8);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it.each(['refused', 'cancelled'] as const)(
  'joins the real WSS handshake socket when opening is %s',
  async (mode) => {
    const f = await source('official', official);
    const tls = createHttpsServer({ key: fixtureKey, cert: fixtureCertificate });
    let reached: () => void = () => {};
    let remoteFinished: () => void = () => {};
    const upgrade = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const remoteClosed = new Promise<void>((resolve) => {
      remoteFinished = resolve;
    });
    tls.on('upgrade', (_request, socket) => {
      socket.once('close', remoteFinished);
      reached();
      if (mode === 'refused')
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    tls.listen(0, '127.0.0.1');
    await once(tls, 'listening');
    const address = tls.address();
    if (!address || typeof address === 'string') throw new Error('missing TLS address');
    let clientClosed = false;
    const io = createAuthorizedOfficialIo(f.host, f.binding, {
      fetch: async (url) =>
        String(url).endsWith('/app/getAppAccessToken')
          ? Response.json({ access_token: access, expires_in: 7200 })
          : Response.json({ url: 'wss://gateway.qq.com/socket' }),
      websocket: () => {
        const socket = new WebSocket(`wss://127.0.0.1:${address.port}`, { ca: fixtureCertificate });
        socket.once('close', () => {
          clientClosed = true;
        });
        return socket;
      },
    });
    cleanups.push(async () => {
      await io.close();
      tls.closeAllConnections();
      await new Promise<void>((resolve) => tls.close(() => resolve()));
    });
    const abort = new AbortController();
    const pending = io.openGateway(abort.signal);
    void pending.catch(() => {});
    await upgrade;
    if (mode === 'cancelled') abort.abort();
    await expect(pending).rejects.toMatchObject({
      error: { code: mode === 'cancelled' ? 'cancelled' : 'network' },
    });
    expect(clientClosed).toBe(true);
    await remoteClosed;
    await io.close();
    expect(f.host.permissions.diagnostics().leases).toBe(0);
    expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  },
);

it('joins an early-HELLO socket when post-open authority is revoked during its real check', async () => {
  const f = await source('official', official);
  const tls = createHttpsServer({ key: fixtureKey, cert: fixtureCertificate });
  const gateways = new WebSocketServer({ server: tls });
  gateways.on('connection', (socket) => {
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
  });
  tls.listen(0, '127.0.0.1');
  await once(tls, 'listening');
  const address = tls.address();
  if (!address || typeof address === 'string') throw new Error('missing TLS address');
  let opened = false;
  let reached: () => void = () => {};
  let release: () => void = () => {};
  const checking = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let clientClosed = false;
  const io = createAuthorizedOfficialIo(
    f.host,
    {
      ...f.binding,
      async check() {
        if (opened) {
          reached();
          await gate;
        }
      },
    },
    {
      fetch: async (url) =>
        String(url).endsWith('/app/getAppAccessToken')
          ? Response.json({ access_token: access, expires_in: 7200 })
          : Response.json({ url: 'wss://gateway.qq.com/socket' }),
      websocket: () => {
        const socket = new WebSocket(`wss://127.0.0.1:${address.port}`, { ca: fixtureCertificate });
        socket.once('open', () => {
          opened = true;
        });
        socket.once('close', () => {
          clientClosed = true;
        });
        return socket;
      },
    },
  );
  cleanups.push(async () => {
    release();
    await io.close();
    gateways.close();
    tls.closeAllConnections();
    await new Promise<void>((resolve) => tls.close(() => resolve()));
  });
  let done = false;
  const opening = io.openGateway(new AbortController().signal);
  const observed = opening.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await checking;
  expect(
    f.host.permissionControl.revoke({ pluginId: f.binding.owner.pluginId, instanceId: 'default' }),
  ).toBe(true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(done).toBe(false);
  release();
  await expect(opening).rejects.toBeInstanceOf(Error);
  await observed;
  expect(clientClosed).toBe(true);
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('authenticates one reverse Universal peer, isolates identities, and closes the real listener', async () => {
  const f = await source('onebot', onebot(0));
  let listening: (port: number) => void = () => {};
  const address = new Promise<number>((resolve) => {
    listening = resolve;
  });
  const io = createAuthorizedOneBotIo(f.host, f.binding, {
    onListening: (info) => listening(info.port),
  });
  cleanups.push(() => io.close());
  const controller = new AbortController();
  const accepted = io.nextPeer(controller.signal);
  const port = await address;
  const url = `ws://127.0.0.1:${port}/private-qq-ws`;
  const rejectHandshake = async (
    address: string,
    headers: Record<string, string>,
  ): Promise<number> => {
    const wrong = new WebSocket(address, { headers });
    return new Promise<number>((resolve) => {
      wrong.on('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      wrong.on('error', () => {});
    });
  };
  const headers = {
    Authorization: `Bearer ${secret}`,
    'X-Self-ID': '12345',
    'X-Client-Role': 'Universal',
  };
  expect(await rejectHandshake(url, { ...headers, Authorization: 'Bearer wrong' })).toBe(403);
  expect(await rejectHandshake(url, { ...headers, 'X-Self-ID': '98765' })).toBe(403);
  expect(await rejectHandshake(url, { ...headers, 'X-Client-Role': 'Event' })).toBe(403);
  expect(await rejectHandshake(`ws://127.0.0.1:${port}/wrong`, headers)).toBe(403);
  const remote = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '12345',
      'X-Client-Role': 'Universal',
    },
  });
  await once(remote, 'open');
  const peer = await accepted;
  expect(peer.selfId).toBe('12345');
  expect(await rejectHandshake(url, headers)).toBe(409);
  const received = once(remote, 'message');
  const outcome = await peer.send(
    { action: 'get_status', params: {}, echo: 'request-1' },
    controller.signal,
  );
  expect(outcome).toEqual({ ok: true, value: null });
  expect(JSON.parse(String((await received)[0]))).toMatchObject({
    action: 'get_status',
    echo: 'request-1',
  });
  const iterator = peer.frames[Symbol.asyncIterator]();
  remote.send(
    JSON.stringify({
      post_type: 'meta_event',
      self_id: 98765,
      time: 1,
      meta_event_type: 'heartbeat',
    }),
  );
  await expect(iterator.next()).rejects.toMatchObject({ error: { code: 'auth-failed' } });
  await peer.close();
  await peer.settled;
  controller.abort();
  await io.close();
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});
