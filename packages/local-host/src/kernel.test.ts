import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, expect, it } from 'vitest';
import {
  LOCAL_AGENT_LINK_CREDENTIAL_ID,
  LOCAL_AGENT_LINK_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type PluginManifest,
  type QQOfficialSettings,
  type QQOneBotSettings,
} from '@pet/contracts';
import {
  CredentialBroker,
  credentialPermissionAuthorizer,
  KernelFault,
  MemoryCiphertextStore,
} from '@pet/host-kernel';
import { packageFingerprint, type CompanionPluginHost } from '@pet/companion-runtime/plugin-host';
import type { PluginContext } from '@pet/plugin-sdk';
import type { OfficialQqDriver } from '@pet/qq-official';
import type { OneBotQqDriver } from '@pet/qq-onebot';
import {
  createAuthorizedOfficialIo,
  createAuthorizedOneBotIo,
  type CapturedQqBinding,
} from './qq-native/index.js';
import {
  createLocalPluginKernel,
  type LocalPluginKernel,
  type LocalPluginKernelOptions,
} from './kernel.js';
import { LOCAL_QQ_CONTROL_ID } from './qq-control.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function latch<T>() {
  let resolve = (_value: T): void => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function binding<S>(
  host: CompanionPluginHost,
  context: PluginContext,
  settings: S,
  revision: number,
  credential: string,
): CapturedQqBinding<S> {
  const id = { pluginId: context.owner.pluginId, instanceId: context.owner.instanceId };
  const epoch = host.permissionControl.inspect(id)?.epoch;
  return {
    owner: context.owner,
    signal: context.signal,
    configRevision: revision,
    credentialVersion: 'fixture-key-v1',
    settings,
    credential,
    async check() {
      const policy = host.permissionControl.inspect(id);
      const config = await host.configs.get(id);
      if (
        !host.manager.isActive(context.owner) ||
        context.signal.aborted ||
        !host.verifySource(id.pluginId) ||
        !policy ||
        policy.blocked ||
        policy.preset === 'deny' ||
        policy.epoch !== epoch ||
        !config.ok ||
        config.value.revision !== revision ||
        !isDeepStrictEqual(config.value.data, settings)
      )
        throw new KernelFault('stale-owner');
    },
  };
}

it('requires exact review, starts both real factories and drains actual source/key work independently', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-local-kernel-test-'));
  const officialDirectory = path.join(root, 'official');
  const onebotDirectory = path.join(root, 'onebot');
  const officialPackage = await realpath(new URL('../../../plugins/qq-official', import.meta.url));
  const onebotPackage = await realpath(new URL('../../../plugins/qq-onebot', import.meta.url));
  await symlink(officialPackage, officialDirectory, 'dir');
  await symlink(onebotPackage, onebotDirectory, 'dir');
  const officialManifest = JSON.parse(
    await readFile(path.join(officialDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const onebotManifest = JSON.parse(
    await readFile(path.join(onebotDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const server = createServer();
  const gateways = new WebSocketServer({ server });
  gateways.on('connection', (peer) => {
    peer.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
    peer.on('message', (data) => {
      if ((JSON.parse(String(data)) as { op: number }).op === 2)
        peer.send(
          JSON.stringify({
            op: 0,
            t: 'READY',
            s: 1,
            d: { session_id: 'fixture-session', user: { id: 'fixture-bot' } },
          }),
        );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const closeEntered = latch<void>();
  const releaseClose = latch<void>();
  const owned: { kernel?: LocalPluginKernel; peer?: WebSocket } = {};
  cleanups.push(async () => {
    releaseClose.resolve();
    await owned.kernel?.close();
    if (owned.peer && owned.peer.readyState !== WebSocket.CLOSED) {
      const ended = once(owned.peer, 'close');
      owned.peer.terminate();
      await ended;
    }
    gateways.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-local-kernel-test-')
    )
      throw new Error('wrong test root');
    await rm(target, { recursive: true });
  });
  const onebotListening = latch<number>();
  const officialReady = latch<void>();
  const onebotReady = latch<void>();
  let officialDriver: OfficialQqDriver | undefined;
  let onebotDriver: OneBotQqDriver | undefined;
  let officialRevision = 0;
  let onebotRevision = 0;
  let fetches = 0;
  const secret = 'local-kernel-fixture-key-7c96';
  const officialConfig: QQOfficialSettings = {
    protocol: 'official',
    appId: 'fixture-app',
    scenes: ['private'],
  };
  const onebotConfig: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '12345',
    mode: 'reverse-ws',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const options: LocalPluginKernelOptions = {
    dataDirectory: path.join(root, 'data'),
    official: {
      directory: officialDirectory,
      manifest: officialManifest,
      preset: 'allow',
      config: { ...officialConfig, scenes: [...officialConfig.scenes] },
      portsFor(context, host) {
        return {
          authorizedOfficial(settings) {
            const io = createAuthorizedOfficialIo(
              host,
              binding(host, context, settings, officialRevision, secret),
              {
                fetch: async (url) => {
                  fetches++;
                  return String(url).endsWith('/app/getAppAccessToken')
                    ? Response.json({ access_token: 'fixture-access-token-2036', expires_in: 7200 })
                    : String(url).endsWith('/gateway')
                      ? Response.json({ url: 'wss://gateway.qq.com/socket' })
                      : Response.json({ id: 'fixture-message' });
                },
                websocket: () => new WebSocket(`ws://127.0.0.1:${address.port}`),
              },
            );
            return {
              ...io,
              async close() {
                closeEntered.resolve();
                await releaseClose.promise;
                await io.close();
              },
            };
          },
          observer: {
            onStatus: (status) => {
              if (status.phase === 'ready') officialReady.resolve();
            },
            onEvent: async () => {},
          },
          bind(driver) {
            officialDriver = driver;
            return async () => {
              officialDriver = undefined;
            };
          },
        };
      },
    },
    onebot: {
      directory: onebotDirectory,
      manifest: onebotManifest,
      preset: 'allow',
      config: { ...onebotConfig },
      portsFor(context, host) {
        return {
          authorizedOneBot: (settings) =>
            createAuthorizedOneBotIo(
              host,
              binding(host, context, settings, onebotRevision, secret),
              { onListening: (info) => onebotListening.resolve(info.port) },
            ),
          observer: {
            onStatus: (status) => {
              if (status.phase === 'ready') onebotReady.resolve();
            },
            onEvent: async () => {},
          },
          bind(driver) {
            onebotDriver = driver;
            return async () => {
              onebotDriver = undefined;
            };
          },
        };
      },
    },
  };
  const unrelated = path.join(root, 'unrelated');
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, 'plugin.json'), JSON.stringify(officialManifest));
  await expect(
    createLocalPluginKernel({
      ...options,
      official: { ...options.official, directory: unrelated },
    }),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  const kernel = await createLocalPluginKernel(options);
  owned.kernel = kernel;
  expect(
    kernel.host.manager
      .list()
      .map((entry) => entry.owner.pluginId)
      .sort(),
  ).toEqual([LOCAL_QQ_CONTROL_ID, QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID].sort());
  expect((await readdir(path.join(root, 'data'))).sort()).toEqual(['configuration', 'plugin-data']);
  const management = kernel.runManagement(async (task) => {
    expect(task.owner.pluginId).toBe(LOCAL_QQ_CONTROL_ID);
    expect(kernel.host.tasks.taskSignal(task.taskId, task.owner)).toBe(task.signal);
    return { ready: true };
  });
  expect(await management.result).toMatchObject({ ok: true, value: { ready: true } });
  await management.settled;
  expect(kernel.host.isEnabled(QQ_OFFICIAL_PLUGIN_ID)).toBe(false);
  expect(kernel.host.isEnabled(QQ_ONEBOT_PLUGIN_ID)).toBe(false);
  const officialSnapshot = await kernel.host.configs.get({
    pluginId: QQ_OFFICIAL_PLUGIN_ID,
    instanceId: 'default',
  });
  const onebotSnapshot = await kernel.host.configs.get({
    pluginId: QQ_ONEBOT_PLUGIN_ID,
    instanceId: 'default',
  });
  if (!officialSnapshot.ok || !onebotSnapshot.ok) throw new Error('missing source config');
  officialRevision = officialSnapshot.value.revision;
  onebotRevision = onebotSnapshot.value.revision;
  const officialReview = kernel.review(QQ_OFFICIAL_PLUGIN_ID);
  const onebotReview = kernel.review(QQ_ONEBOT_PLUGIN_ID);
  expect(officialReview.trusted).toBe(false);
  expect(onebotReview.trusted).toBe(false);
  await expect(kernel.setEnabled(QQ_OFFICIAL_PLUGIN_ID, true)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(officialDriver).toBeUndefined();
  expect(fetches).toBe(0);
  expect(() => kernel.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, '0'.repeat(64))).toThrow();
  kernel.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, officialReview.digest);
  kernel.setPreset(QQ_ONEBOT_PLUGIN_ID, 'deny');
  kernel.confirmTrust(QQ_ONEBOT_PLUGIN_ID, onebotReview.digest);
  expect(kernel.review(QQ_ONEBOT_PLUGIN_ID).preset).toBe('deny');
  kernel.setPreset(QQ_ONEBOT_PLUGIN_ID, 'allow');
  await kernel.setEnabled(QQ_OFFICIAL_PLUGIN_ID, true);
  await kernel.setEnabled(QQ_ONEBOT_PLUGIN_ID, true);
  expect(officialDriver).toBeDefined();
  expect(onebotDriver).toBeDefined();
  expect(fetches).toBe(0);
  const official = officialDriver;
  const onebot = onebotDriver;
  if (!official || !onebot) throw new Error('factory failed to bind');
  const officialTask = kernel.runFor(QQ_OFFICIAL_PLUGIN_ID, async (task) => {
    await official.start(task.signal);
    return null;
  });
  const onebotTask = kernel.runFor(QQ_ONEBOT_PLUGIN_ID, async (task) => {
    await onebot.start(task.signal);
    return null;
  });
  const taskStarted = latch<void>();
  const taskCleaning = latch<void>();
  const releaseTask = latch<void>();
  cleanups.push(async () => {
    releaseTask.resolve();
  });
  const heldTask = kernel.runFor(QQ_ONEBOT_PLUGIN_ID, async (task) => {
    taskStarted.resolve();
    if (!task.signal.aborted) await once(task.signal, 'abort');
    taskCleaning.resolve();
    await releaseTask.promise;
    return null;
  });
  await taskStarted.promise;
  const port = await onebotListening.promise;
  const peer = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Self-ID': '12345',
      'X-Client-Role': 'Universal',
    },
  });
  owned.peer = peer;
  peer.on('error', () => {});
  await once(peer, 'open');
  await Promise.all([officialReady.promise, onebotReady.promise]);
  expect(kernel.host.permissions.diagnostics().leases).toBeGreaterThan(0);
  await unlink(officialDirectory);
  await mkdir(officialDirectory);
  await writeFile(path.join(officialDirectory, 'plugin.json'), JSON.stringify(officialManifest));
  await writeFile(path.join(officialDirectory, 'changed.txt'), 'not reviewed');
  expect(() => kernel.review(QQ_OFFICIAL_PLUGIN_ID)).toThrow();
  expect(() => kernel.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, officialReview.digest)).toThrow();
  expect(() =>
    kernel.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, packageFingerprint(officialDirectory)),
  ).toThrow();
  const oldConnection = official.status.connectionId;
  if (!oldConnection) throw new Error('missing official connection');
  const before = fetches;
  const fenced = await official.send(
    'c2c',
    'fixture-user',
    { msg_type: 0, msg_seq: 1, content: 'must not send' },
    new AbortController().signal,
    oldConnection,
  );
  expect(fenced).toMatchObject({ ok: false, error: { code: 'package-changed' } });
  expect(fetches).toBe(before);
  let disabled = false;
  const disabling = kernel.setEnabled(QQ_OFFICIAL_PLUGIN_ID, false).then(() => {
    disabled = true;
  });
  await closeEntered.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(disabled).toBe(false);
  expect(peer.readyState).toBe(WebSocket.OPEN);
  releaseClose.resolve();
  await disabling;
  await officialTask.settled;
  expect(peer.readyState).toBe(WebSocket.OPEN);
  const peerClosed = once(peer, 'close');
  kernel.withdrawTrust(QQ_ONEBOT_PLUGIN_ID, onebotReview.digest);
  expect(() => kernel.runFor(QQ_ONEBOT_PLUGIN_ID, async () => null)).toThrow();
  await taskCleaning.promise;
  expect(heldTask.signal.aborted).toBe(true);
  expect(heldTask.snapshot().workPending).toBe(true);
  kernel.confirmTrust(QQ_ONEBOT_PLUGIN_ID, onebotReview.digest);
  expect(heldTask.signal.aborted).toBe(true);
  expect(kernel.review(QQ_ONEBOT_PLUGIN_ID).cleanup).toBe('pending');
  expect(() => kernel.runFor(QQ_ONEBOT_PLUGIN_ID, async () => null)).toThrow();
  await peerClosed;
  let onebotDisabled = false;
  const stopping = kernel.setEnabled(QQ_ONEBOT_PLUGIN_ID, false).then(() => {
    onebotDisabled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(onebotDisabled).toBe(false);
  expect(kernel.review(QQ_ONEBOT_PLUGIN_ID).cleanup).toBe('pending');
  await expect(kernel.setEnabled(QQ_ONEBOT_PLUGIN_ID, true)).rejects.toMatchObject({
    error: { code: 'conflict' },
  });
  releaseTask.resolve();
  await stopping;
  await Promise.all([onebotTask.settled, heldTask.settled]);
  expect(heldTask.signal.aborted).toBe(true);
  await kernel.setEnabled(QQ_ONEBOT_PLUGIN_ID, true);
  const freshStarted = latch<void>();
  const fresh = kernel.runFor(QQ_ONEBOT_PLUGIN_ID, async (task) => {
    freshStarted.resolve();
    if (!task.signal.aborted) await once(task.signal, 'abort');
    return null;
  });
  await freshStarted.promise;
  kernel.setPreset(QQ_ONEBOT_PLUGIN_ID, 'deny');
  kernel.setPreset(QQ_ONEBOT_PLUGIN_ID, 'allow');
  expect(fresh.signal.aborted).toBe(true);
  expect(() => kernel.runFor(QQ_ONEBOT_PLUGIN_ID, async () => null)).toThrow();
  expect(kernel.review(QQ_ONEBOT_PLUGIN_ID).cleanup).toBe('pending');
  await fresh.settled;
  await kernel.setEnabled(QQ_ONEBOT_PLUGIN_ID, false);
  await kernel.close();
  expect(kernel.host.permissions.diagnostics().leases).toBe(0);
  expect(kernel.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('keeps committed source configuration across host restarts without regranting trust', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-local-kernel-restart-'));
  const officialDirectory = path.join(root, 'official');
  const onebotDirectory = path.join(root, 'onebot');
  await symlink(
    await realpath(new URL('../../../plugins/qq-official', import.meta.url)),
    officialDirectory,
    'dir',
  );
  await symlink(
    await realpath(new URL('../../../plugins/qq-onebot', import.meta.url)),
    onebotDirectory,
    'dir',
  );
  const officialManifest = JSON.parse(
    await readFile(path.join(officialDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const onebotManifest = JSON.parse(
    await readFile(path.join(onebotDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const instances: LocalPluginKernel[] = [];
  cleanups.push(async () => {
    await Promise.all(instances.map((item) => item.close()));
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-local-kernel-restart-')
    )
      throw new Error('wrong test root');
    await rm(target, { recursive: true });
  });
  const options: LocalPluginKernelOptions = {
    dataDirectory: path.join(root, 'data'),
    official: {
      directory: officialDirectory,
      manifest: officialManifest,
      preset: 'allow',
      config: { protocol: 'official', appId: 'seed', scenes: ['private'] },
      portsFor() {
        throw new Error('source must stay disabled');
      },
    },
    onebot: {
      directory: onebotDirectory,
      manifest: onebotManifest,
      preset: 'allow',
      portsFor() {
        throw new Error('source must stay disabled');
      },
    },
  };
  const first = await createLocalPluginKernel(options);
  instances.push(first);
  const id = { pluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' };
  const initial = await first.host.configs.get(id);
  if (!initial.ok) throw new Error('missing config');
  const saved = await first.host.configs.save(
    id,
    { ...initial.value.data, appId: 'explicitly-saved' },
    initial.value.revision,
  );
  if (!saved.ok) throw new Error('config CAS failed');
  const review = first.review(QQ_OFFICIAL_PLUGIN_ID);
  first.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, review.digest);
  await first.close();
  const restarted = await createLocalPluginKernel({
    ...options,
    official: {
      ...options.official,
      config: { protocol: 'official', appId: 'stale-seed', scenes: ['group'] },
    },
  });
  instances.push(restarted);
  const restored = await restarted.host.configs.get(id);
  if (!restored.ok) throw new Error('missing restored config');
  expect(restored.value.revision).toBe(saved.value.snapshot.revision);
  expect(restored.value.data).toMatchObject({ appId: 'explicitly-saved', scenes: ['private'] });
  expect(restarted.review(QQ_OFFICIAL_PLUGIN_ID).trusted).toBe(false);
});

it('retains failed cleanup and refuses a replacement source', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-local-kernel-failure-'));
  const officialDirectory = path.join(root, 'official');
  const onebotDirectory = path.join(root, 'onebot');
  await symlink(
    await realpath(new URL('../../../plugins/qq-official', import.meta.url)),
    officialDirectory,
    'dir',
  );
  await symlink(
    await realpath(new URL('../../../plugins/qq-onebot', import.meta.url)),
    onebotDirectory,
    'dir',
  );
  const officialManifest = JSON.parse(
    await readFile(path.join(officialDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const onebotManifest = JSON.parse(
    await readFile(path.join(onebotDirectory, 'plugin.json'), 'utf8'),
  ) as PluginManifest;
  const owned: { kernel?: LocalPluginKernel } = {};
  cleanups.push(async () => {
    await owned.kernel?.close().catch(() => {});
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-local-kernel-failure-')
    )
      throw new Error('wrong test root');
    await rm(target, { recursive: true });
  });
  const kernel = await createLocalPluginKernel({
    dataDirectory: path.join(root, 'data'),
    official: {
      directory: officialDirectory,
      manifest: officialManifest,
      preset: 'allow',
      config: { protocol: 'official', appId: 'fixture-app', scenes: ['private'] },
      portsFor(context, host) {
        return {
          authorizedOfficial(settings) {
            const io = createAuthorizedOfficialIo(
              host,
              binding(host, context, settings, 1, 'fixture-key'),
              {
                fetch: async () => {
                  throw new Error('unexpected network');
                },
              },
            );
            return {
              ...io,
              async close() {
                await io.close();
                throw new Error('native cleanup failed');
              },
            };
          },
          observer: { onStatus: () => {}, onEvent: async () => {} },
          bind: () => async () => {},
        };
      },
    },
    onebot: {
      directory: onebotDirectory,
      manifest: onebotManifest,
      preset: 'allow',
      portsFor() {
        throw new Error('onebot must not start');
      },
    },
  });
  owned.kernel = kernel;
  const review = kernel.review(QQ_OFFICIAL_PLUGIN_ID);
  kernel.confirmTrust(QQ_OFFICIAL_PLUGIN_ID, review.digest);
  await kernel.setEnabled(QQ_OFFICIAL_PLUGIN_ID, true);
  await expect(kernel.setEnabled(QQ_OFFICIAL_PLUGIN_ID, false)).rejects.toBeInstanceOf(Error);
  expect(kernel.review(QQ_OFFICIAL_PLUGIN_ID).cleanup).toBe('failed');
  expect(
    kernel.host.manager.get({ pluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' })?.state,
  ).toBe('pending_restart');
  await expect(kernel.setEnabled(QQ_OFFICIAL_PLUGIN_ID, true)).rejects.toMatchObject({
    error: { code: 'not-ready' },
  });
});

it('optionally admits the real AgentLink factory only after explicit review', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pet-local-link-kernel-'));
  const dirs = await Promise.all(
    ['qq-official', 'qq-onebot', 'local-agent-link'].map((name) =>
      realpath(new URL(`../../../plugins/${name}`, import.meta.url)),
    ),
  );
  const [officialDirectory, onebotDirectory, linkDirectory] = dirs;
  if (!officialDirectory || !onebotDirectory || !linkDirectory) throw new Error('missing package');
  const manifests = await Promise.all(
    dirs.map(
      async (directory) =>
        JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8')) as PluginManifest,
    ),
  );
  const [official, onebot, link] = manifests;
  if (!official || !onebot || !link) throw new Error('missing manifest');
  const owned: { kernel?: LocalPluginKernel } = {};
  cleanups.push(async () => {
    await owned.kernel?.close();
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('pet-local-link-kernel-')
    )
      throw new Error('wrong test root');
    await rm(target, { recursive: true });
  });
  let bound = 0;
  let unbound = 0;
  let linkOwner = '';
  const kernel = await createLocalPluginKernel({
    dataDirectory: path.join(root, 'data'),
    official: {
      directory: officialDirectory,
      manifest: official,
      preset: 'allow',
      portsFor() {
        throw new Error('unexpected official');
      },
    },
    onebot: {
      directory: onebotDirectory,
      manifest: onebot,
      preset: 'allow',
      portsFor() {
        throw new Error('unexpected onebot');
      },
    },
    agentLink: {
      directory: linkDirectory,
      manifest: link,
      preset: 'allow',
      portsFor(context) {
        linkOwner = context.owner.pluginId;
        return {
          bind() {
            bound++;
            return async () => {
              unbound++;
            };
          },
          status: async () => ({ phase: 'idle' }),
        };
      },
    },
  });
  owned.kernel = kernel;
  expect(kernel.review(LOCAL_AGENT_LINK_PLUGIN_ID).trusted).toBe(false);
  await expect(kernel.setEnabled(LOCAL_AGENT_LINK_PLUGIN_ID, true)).rejects.toMatchObject({
    error: { code: 'permission-denied' },
  });
  expect(bound).toBe(0);
  kernel.confirmTrust(LOCAL_AGENT_LINK_PLUGIN_ID, kernel.review(LOCAL_AGENT_LINK_PLUGIN_ID).digest);
  await kernel.setEnabled(LOCAL_AGENT_LINK_PLUGIN_ID, true);
  expect(bound).toBe(1);
  expect(linkOwner).toBe(LOCAL_AGENT_LINK_PLUGIN_ID);
  const broker = new CredentialBroker({
    store: new MemoryCiphertextStore(),
    cipher: {
      encrypt: async () => {
        throw new Error('unused');
      },
      decrypt: async () => {
        throw new Error('unused');
      },
    },
    authorize: credentialPermissionAuthorizer(kernel.host.permissions),
  });
  const task = kernel.runFor(LOCAL_AGENT_LINK_PLUGIN_ID, async (task) => ({
    owner: task.owner.pluginId,
    borrowed: await broker.withSecretForHost(
      task.owner,
      [LOCAL_AGENT_LINK_CREDENTIAL_ID],
      LOCAL_AGENT_LINK_CREDENTIAL_ID,
      { taskId: task.taskId, signal: task.signal },
      async (secret) => secret === 'fixture-agent-key',
      'fixture-agent-key',
    ),
  }));
  expect(await task.result).toMatchObject({
    ok: true,
    value: { owner: LOCAL_AGENT_LINK_PLUGIN_ID, borrowed: true },
  });
  await task.settled;
  broker.dispose();
  await broker.drainUses();
  await kernel.setEnabled(LOCAL_AGENT_LINK_PLUGIN_ID, false);
  expect(unbound).toBe(1);
});
