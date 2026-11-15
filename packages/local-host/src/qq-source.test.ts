import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import {
  isQQSourceView,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type PluginManifest,
  type QQAccountRef,
} from '@pet/contracts';
import { createLocalPluginKernel, type LocalPluginKernel } from './kernel.js';
import { LocalQQSourceController, type LocalCapturedSourceBase } from './qq-source.js';
import { LOCAL_QQ_CONTROL_ID } from './qq-control.js';
import { createAuthorizedOfficialIo, type OfficialIoTestHooks } from './qq-native/index.js';

function latch<T>() {
  let resolve = (_value: T): void => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('owns local source settings, keys, exact peers and cleanup without server policy or State', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-local-qq-source-'));
  const officialDirectory = await realpath(
    new URL('../../../plugins/qq-official', import.meta.url),
  );
  const onebotDirectory = await realpath(new URL('../../../plugins/qq-onebot', import.meta.url));
  const officialManifest = JSON.parse(
    await readFile(path.join(officialDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const onebotManifest = JSON.parse(
    await readFile(path.join(onebotDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const server = createServer();
  const gateways = new WebSocketServer({ server });
  const connections: WebSocket[] = [];
  gateways.on('connection', (peer) => {
    connections.push(peer);
    peer.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
    peer.on('message', (bytes) => {
      if ((JSON.parse(String(bytes)) as { op: number }).op === 2)
        peer.send(
          JSON.stringify({
            op: 0,
            t: 'READY',
            s: 1,
            d: { session_id: 'source-fixture', user: { id: 'fixture-bot' } },
          }),
        );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const listening = latch<number>();
  const officialEvent = latch<LocalCapturedSourceBase>();
  const officialEvents: string[] = [];
  let businessRequests = 0;
  const onebotEvent = latch<LocalCapturedSourceBase>();
  const closeEntered = latch<void>();
  const releaseClose = latch<void>();
  let holdClose = false;
  const holder: {
    abortAfterCommit?: AbortController;
    controller?: LocalQQSourceController;
    kernel?: LocalPluginKernel;
    peer?: WebSocket;
  } = {};
  cleanups.push(async () => {
    releaseClose.resolve();
    await holder.controller?.close();
    await holder.kernel?.close();
    if (holder.peer && holder.peer.readyState !== WebSocket.CLOSED) {
      const ended = once(holder.peer, 'close');
      holder.peer.terminate();
      await ended;
    }
    gateways.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-local-qq-source-')
    )
      throw new Error('wrong fixture root');
    await rm(target, { recursive: true });
  });
  const required = () => {
    if (!holder.controller) throw new Error('missing source controller');
    return holder.controller;
  };
  const kernel = await createLocalPluginKernel({
    dataDirectory: path.join(root, 'data'),
    official: {
      directory: officialDirectory,
      manifest: officialManifest,
      preset: 'allow',
      portsFor: (context) => required().officialPorts(context),
    },
    onebot: {
      directory: onebotDirectory,
      manifest: onebotManifest,
      preset: 'allow',
      portsFor: (context) => required().onebotPorts(context),
    },
  });
  holder.kernel = kernel;
  const officialHooks: OfficialIoTestHooks = {
    fetch: async (url) => {
      if (String(url).includes('/messages')) businessRequests++;
      return String(url).endsWith('/app/getAppAccessToken')
        ? Response.json({ access_token: 'synthetic-access', expires_in: 7200 })
        : String(url).endsWith('/gateway')
          ? Response.json({ url: 'wss://gateway.qq.com/socket' })
          : Response.json({ id: 'sent' });
    },
    websocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
  };
  const controller = new LocalQQSourceController(kernel, {
    officialFactory(host, binding) {
      holder.abortAfterCommit?.abort();
      const io = createAuthorizedOfficialIo(host, binding, officialHooks);
      return {
        ...io,
        async close() {
          if (holdClose) {
            closeEntered.resolve();
            await releaseClose.promise;
          }
          await io.close();
        },
      };
    },
    onOfficial: async (event, captured) => {
      officialEvents.push(event.t);
      officialEvent.resolve(captured);
    },
    onOneBot: async (_event, captured) => {
      onebotEvent.resolve(captured);
    },
    onebotTest: { onListening: (info) => listening.resolve(info.port) },
  });
  holder.controller = controller;
  await controller.initialize();
  let view = await controller.view();
  expect(view.sources.every(isQQSourceView)).toBe(true);
  expect(view.sources.every((item) => item.source === 'disabled')).toBe(true);
  expect(
    kernel.host.manager
      .list()
      .map((item) => item.owner.pluginId)
      .sort(),
  ).toEqual([LOCAL_QQ_CONTROL_ID, QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID].sort());
  let official = view.sources.find((item) => item.protocol === 'official');
  if (!official) throw new Error('missing official source');
  let changed = await controller.saveSource({
    protocol: 'official',
    expectedRevision: official.configRevision,
    settings: { protocol: 'official', appId: 'source-app', scenes: ['private'] },
  });
  expect(changed.error).toBeNull();
  official = changed.view.sources.find((item) => item.protocol === 'official');
  if (!official) throw new Error('missing official source');
  changed = await controller.credential({
    protocol: 'official',
    expectedRevision: official.configRevision,
    expectedCredentialVersion: official.credential.version,
    value: 'synthetic-official-secret',
  });
  official = changed.view.sources.find((item) => item.protocol === 'official');
  if (!official) throw new Error('missing official source');
  expect(official.credential).toMatchObject({ available: true, source: 'memory' });
  expect(JSON.stringify(changed.view)).not.toContain('synthetic-official-secret');
  const staleControl = changed.view.revision;
  await expect(
    controller.setEnabled('official', true, staleControl, {
      expectedConfigRevision: official.configRevision,
      expectedCredentialVersion: 'stale-key-version',
    }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  expect((await controller.view()).revision).toBe(staleControl);
  changed = await controller.setEnabled('official', true, staleControl, {
    expectedConfigRevision: official.configRevision,
    expectedCredentialVersion: official.credential.version,
  });
  expect(changed.error?.code).toBe('permission-denied');
  expect(changed.view.sources.find((item) => item.protocol === 'official')).toMatchObject({
    desiredEnabled: true,
    source: 'unavailable',
  });
  const review = kernel.review(QQ_OFFICIAL_PLUGIN_ID);
  kernel.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, review.digest);
  changed = await controller.setEnabled('official', true, changed.view.revision);
  expect(changed.error).toBeNull();
  await vi.waitFor(async () =>
    expect(
      (await controller.view()).sources.find((item) => item.protocol === 'official')?.phase,
    ).toBe('ready'),
  );
  const account: QQAccountRef = {
    protocol: 'official',
    sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
    instanceId: 'default',
    accountId: 'source-app',
  };
  const gateway = connections.at(-1);
  if (!gateway) throw new Error('missing gateway');
  gateway.send(
    JSON.stringify({
      op: 0,
      s: 2,
      t: 'GROUP_AT_MESSAGE_CREATE',
      id: 'ignored-group',
      d: {
        id: 'g1',
        timestamp: new Date().toISOString(),
        content: 'group',
        group_openid: 'group',
        author: { id: 'member', member_openid: 'member' },
      },
    }),
  );
  gateway.send(
    JSON.stringify({
      op: 0,
      s: 3,
      t: 'C2C_MESSAGE_CREATE',
      id: 'private-event',
      d: {
        id: 'p1',
        timestamp: new Date().toISOString(),
        content: 'private',
        author: { id: 'person', user_openid: 'person' },
      },
    }),
  );
  const capturedEvent = await officialEvent.promise;
  expect(officialEvents).toEqual(['C2C_MESSAGE_CREATE']);
  expect(capturedEvent).toMatchObject({
    account,
    owner: { pluginId: QQ_OFFICIAL_PLUGIN_ID },
    connectionId: expect.any(String),
    configRevision: expect.any(Number),
    credentialVersion: expect.any(String),
    permissionEpoch: expect.any(Number),
  });
  await capturedEvent.check();
  const captured = controller.captureSource(account);
  await captured.check();
  if (captured.protocol !== 'official') throw new Error('wrong protocol');
  const unscoped = await captured.driver.send(
    'c2c',
    'person',
    { msg_type: 0, msg_seq: 1, content: 'must not send' },
    new AbortController().signal,
    captured.connectionId,
  );
  expect(unscoped).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  expect(businessRequests).toBe(0);
  await expect(controller.setEnabled('onebot-v11', true, staleControl)).rejects.toMatchObject({
    error: { code: 'conflict' },
  });
  view = await controller.view();
  let onebot = view.sources.find((item) => item.protocol === 'onebot-v11');
  if (!onebot) throw new Error('missing onebot');
  changed = await controller.saveSource({
    protocol: 'onebot-v11',
    expectedRevision: onebot.configRevision,
    settings: {
      protocol: 'onebot-v11',
      accountId: '12345',
      mode: 'reverse-ws',
      channelMode: 'universal',
      mediaProfile: 'snowluma-v11',
      listenHost: '127.0.0.1',
      listenPort: 0,
      path: '/qq',
    },
  });
  onebot = changed.view.sources.find((item) => item.protocol === 'onebot-v11');
  if (!onebot) throw new Error('missing onebot');
  changed = await controller.credential({
    protocol: 'onebot-v11',
    expectedRevision: onebot.configRevision,
    expectedCredentialVersion: onebot.credential.version,
    value: 'synthetic-onebot-secret',
  });
  kernel.confirmTrust(QQ_ONEBOT_PLUGIN_ID, kernel.review(QQ_ONEBOT_PLUGIN_ID).digest);
  changed = await controller.setEnabled('onebot-v11', true, changed.view.revision);
  expect(changed.error).toBeNull();
  const port = await listening.promise;
  const peer = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: {
      Authorization: 'Bearer synthetic-onebot-secret',
      'X-Self-ID': '12345',
      'X-Client-Role': 'Universal',
    },
  });
  holder.peer = peer;
  peer.on('error', () => {});
  await once(peer, 'open');
  await vi.waitFor(async () =>
    expect(
      (await controller.view()).sources.find((item) => item.protocol === 'onebot-v11')?.phase,
    ).toBe('ready'),
  );
  peer.send(
    JSON.stringify({
      post_type: 'message',
      self_id: 12345,
      time: 1700000000,
      message_type: 'private',
      sub_type: 'friend',
      message_id: 11,
      user_id: 888,
      target_id: 12345,
      sender: { user_id: 888 },
      message: [{ type: 'text', data: { text: 'fixture' } }],
    }),
  );
  const nativeEvent = await onebotEvent.promise;
  expect(nativeEvent.owner.pluginId).toBe(QQ_ONEBOT_PLUGIN_ID);
  await nativeEvent.check();
  const before = await controller.view();
  official = before.sources.find((item) => item.protocol === 'official');
  if (!official) throw new Error('missing official');
  const oldKeyVersion = official.credential.version;
  const abort = new AbortController();
  holdClose = true;
  const cancelled = controller.credential(
    {
      protocol: 'official',
      expectedRevision: official.configRevision,
      expectedCredentialVersion: oldKeyVersion,
      value: 'cancelled-secret',
    },
    abort.signal,
  );
  await closeEntered.promise;
  abort.abort();
  holdClose = false;
  releaseClose.resolve();
  await expect(cancelled).rejects.toMatchObject({ error: { code: 'cancelled' } });
  view = await controller.view();
  official = view.sources.find((item) => item.protocol === 'official');
  if (!official) throw new Error('missing official');
  expect(official.credential).toMatchObject({ available: true, version: oldKeyVersion });
  expect(captured.signal.aborted).toBe(true);
  await expect(captured.check()).rejects.toBeInstanceOf(Error);
  changed = await controller.setEnabled('official', true, view.revision, {
    expectedConfigRevision: official.configRevision,
    expectedCredentialVersion: oldKeyVersion,
  });
  expect(changed.error).toBeNull();
  await vi.waitFor(async () =>
    expect(
      (await controller.view()).sources.find((item) => item.protocol === 'official')?.phase,
    ).toBe('ready'),
  );
  const resumed = controller.captureSource(account);
  view = await controller.view();
  official = view.sources.find((item) => item.protocol === 'official');
  if (!official) throw new Error('missing official');
  const abortAfterCommit = new AbortController();
  holder.abortAfterCommit = abortAfterCommit;
  changed = await controller.credential(
    {
      protocol: 'official',
      expectedRevision: official.configRevision,
      expectedCredentialVersion: official.credential.version,
      value: 'rotated-official-secret',
    },
    abortAfterCommit.signal,
  );
  expect(abortAfterCommit.signal.aborted).toBe(true);
  expect(changed.error).toBeNull();
  expect(
    changed.view.sources.find((item) => item.protocol === 'official')?.credential,
  ).toMatchObject({ available: true, source: 'memory' });
  expect(
    changed.view.sources.find((item) => item.protocol === 'official')?.credential.version,
  ).not.toBe(oldKeyVersion);
  expect(resumed.signal.aborted).toBe(true);
  await expect(resumed.check()).rejects.toBeInstanceOf(Error);
  expect(peer.readyState).toBe(WebSocket.OPEN);
  await vi.waitFor(async () =>
    expect(
      (await controller.view()).sources.find((item) => item.protocol === 'official')?.phase,
    ).toBe('ready'),
  );
  const fresh = controller.captureSource(account);
  expect(fresh.connectionId).not.toBe(resumed.connectionId);
  await fresh.check();
  await controller.close();
  await kernel.close();
  expect(kernel.host.permissions.diagnostics().leases).toBe(0);
  expect(kernel.host.tasks.diagnostics().pendingWork).toBe(0);
});
