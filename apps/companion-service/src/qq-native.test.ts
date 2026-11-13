import { createServer } from 'node:http';
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
import { createAuthorizedOfficialIo } from './qq-official-io.js';
import { createAuthorizedOneBotIo } from './qq-onebot-io.js';
import type { CapturedQqBinding } from './qq-native-types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const secret = 'isolated-qq-test-secret-8a2ef0';
const access = 'isolated-qq-access-token-49b0d';

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
