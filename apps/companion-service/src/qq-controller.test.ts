import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import WebSocket from 'ws';
import {
  defaultQQPolicySettings,
  QQ_FEATURE_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  isQQView,
  makeError,
  type JsonObject,
  type PluginManifest,
  type QQJudgeView,
  type QQOfficialSettings,
  type QQOneBotSettings,
} from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import stateDefinition from '@pet/state-sqlite';
import {
  CompanionPluginHost,
  CompanionRuntime,
  ModelConnections,
  STATE_CAPABILITY,
  companionHostDefinition,
  companionHostManifest,
} from '@pet/companion-runtime';
import { createSharedQQPlugin } from '../../../plugins/shared-qq/src/index.js';
import { createOfficialQqPlugin } from '../../../plugins/qq-official/src/index.js';
import { createOneBotQqPlugin } from '../../../plugins/qq-onebot/src/index.js';
import type { OfficialIo } from '../../../plugins/qq-official/src/ports.js';
import type { OneBotIo } from '../../../plugins/qq-onebot/src/ports.js';
import { QQController } from './qq-controller.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const key = 'synthetic-qq-controller-key-68490';
function latch(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(
  realOnebot = false,
  failOfficialClose = false,
  featureDisabled = false,
  invalidPolicy = false,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'qq-controller-test-'));
  const readManifest = async (name: string): Promise<PluginManifest> =>
    JSON.parse(
      await readFile(new URL(`../../../plugins/${name}/plugin.json`, import.meta.url), 'utf8'),
    ) as PluginManifest;
  const [stateManifest, featureManifest, officialManifest, onebotManifest] = await Promise.all([
    readManifest('state-sqlite'),
    readManifest('shared-qq'),
    readManifest('qq-official'),
    readManifest('qq-onebot'),
  ]);
  const manifests = [
    companionHostManifest,
    stateManifest,
    featureManifest,
    officialManifest,
    onebotManifest,
  ];
  const dirs = new Map<string, string>();
  for (const manifest of manifests) {
    const directory = path.join(root, manifest.id);
    await mkdir(directory);
    await writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
    dirs.set(manifest.id, directory);
  }
  const dir = (manifest: PluginManifest): string => {
    const value = dirs.get(manifest.id);
    if (!value) throw new Error('missing source');
    return value;
  };
  const holder: { controller?: QQController } = {};
  const required = (): QQController => {
    if (!holder.controller) throw new Error('missing controller');
    return holder.controller;
  };
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(root, 'data'),
    plugins: [
      {
        manifest: companionHostManifest,
        directory: dir(companionHostManifest),
        definition: companionHostDefinition,
        enabled: true,
        preset: 'allow',
        ...(featureDisabled ? { config: { disabledPlugins: [QQ_FEATURE_PLUGIN_ID] } } : {}),
      },
      {
        manifest: stateManifest,
        directory: dir(stateManifest),
        definition: stateDefinition,
        enabled: true,
        preset: 'allow',
        dataDirectory: path.join(root, 'data', 'state'),
      },
      {
        manifest: featureManifest,
        directory: dir(featureManifest),
        enabled: false,
        preset: 'allow',
        initialConfig: defaultQQPolicySettings() as unknown as JsonObject,
        definition: createSharedQQPlugin((context) => required().featurePorts(context)),
      },
      {
        manifest: officialManifest,
        directory: dir(officialManifest),
        enabled: false,
        preset: 'allow',
        hostCredentials: ['qq-official-app-secret'],
        definition: definePlugin({
          async activate(context) {
            await required().prepareSource(context);
            await createOfficialQqPlugin((ctx) => required().officialPorts(ctx)).activate(context);
          },
        }),
      },
      {
        manifest: onebotManifest,
        directory: dir(onebotManifest),
        enabled: false,
        preset: 'allow',
        hostCredentials: ['qq-onebot-access-token'],
        definition: definePlugin({
          async activate(context) {
            await required().prepareSource(context);
            await createOneBotQqPlugin((ctx) => required().onebotPorts(ctx)).activate(context);
          },
        }),
      },
    ],
  });
  host.bind(STATE_CAPABILITY, stateManifest.id, 'sqlite');
  if (invalidPolicy) {
    const stored = await host.configs.get({
      pluginId: QQ_FEATURE_PLUGIN_ID,
      instanceId: 'default',
    });
    if (!stored.ok) throw new Error('missing policy');
    const invalid = {
      ...stored.value.data,
      privateAllowlist: [
        {
          account: {
            protocol: 'official',
            sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
            instanceId: 'default',
            accountId: 'fixture',
          },
          scene: 'private',
          senderId: 'person',
          groupId: 'unexpected',
        },
      ],
    };
    const saved = await host.configs.save(
      { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' },
      invalid as unknown as JsonObject,
      stored.value.revision,
    );
    if (!saved.ok) throw new Error('invalid test policy did not commit');
  }
  const runtime = new CompanionRuntime(host, {
    mode: 'scripted',
    statePluginId: stateManifest.id,
    stateProviderId: 'sqlite',
    executionPluginId: 'pet.cloud-exec',
    executionProviderId: 'docker',
    executionTimeoutMs: 1000,
    optionalPluginIds: [QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID],
  });
  const connections = new ModelConnections(host, [], () => {
    throw new Error('not used');
  });
  let officialStarts = 0;
  let onebotStarts = 0;
  const officialFactory: NonNullable<
    ConstructorParameters<typeof QQController>[3]
  >['officialFactory'] = (_host, binding) => {
    const closed = latch();
    const connection = new AbortController();
    const unavailable = async () => ({
      ok: false as const,
      error: makeError('not-ready'),
      dispatched: false,
    });
    const io: OfficialIo = {
      media: {
        inline: unavailable,
        prepare: unavailable,
        putPart: unavailable,
        finishPart: unavailable,
        commit: unavailable,
        readAttachment: async () => {
          throw new KernelFault('not-ready');
        },
      },
      async openGateway() {
        await binding.check();
        officialStarts++;
        return {
          id: `official-${officialStarts}`,
          signal: connection.signal,
          frames: {
            async *[Symbol.asyncIterator]() {
              yield JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } });
              yield JSON.stringify({
                op: 0,
                t: 'READY',
                s: 1,
                d: { session_id: 'session', user: { id: 'bot' } },
              });
              await closed.promise;
            },
          },
          settled: closed.promise,
          identify: async () => {},
          resume: async () => {},
          heartbeat: async () => {},
          close: async () => {
            connection.abort();
            closed.resolve();
          },
        };
      },
      send: async () => ({
        ok: false,
        error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: false },
        dispatched: false,
      }),
      upload: async () => ({
        ok: false,
        error: { code: 'unavailable', messageKey: 'errors.unavailable', retryable: false },
        dispatched: false,
      }),
      close: async () => {
        connection.abort();
        closed.resolve();
        if (failOfficialClose) throw new Error('controlled cleanup failure');
      },
    };
    return io;
  };
  const onebotFactory: NonNullable<
    ConstructorParameters<typeof QQController>[3]
  >['onebotFactory'] = (_host, binding) => {
    const closed = latch();
    const connection = new AbortController();
    let entered = false;
    const io: OneBotIo = {
      async nextPeer() {
        await binding.check();
        if (entered) {
          await closed.promise;
          throw new DOMException('closed', 'AbortError');
        }
        entered = true;
        onebotStarts++;
        return {
          id: `onebot-${onebotStarts}`,
          signal: connection.signal,
          selfId: binding.settings.accountId,
          frames: {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  await closed.promise;
                  return { done: true as const, value: undefined };
                },
              };
            },
          },
          settled: closed.promise,
          openMedia: () => {
            throw new KernelFault('not-ready');
          },
          send: async () => ({ ok: true, value: null }),
          close: async () => {
            connection.abort();
            closed.resolve();
          },
        };
      },
      close: async () => {
        connection.abort();
        closed.resolve();
      },
    };
    return io;
  };
  const ports: number[] = [];
  let listenPort: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    listenPort = resolve;
  });
  const controller = new QQController(host, runtime, connections, {
    officialFactory,
    ...(realOnebot
      ? {
          onebotTest: {
            onListening: (address) => {
              ports.push(address.port);
              listenPort(address.port);
            },
          },
        }
      : { onebotFactory }),
  });
  holder.controller = controller;
  const policy = defaultQQPolicySettings();
  const judge: QQJudgeView = {
    sourcePluginId: 'pet.qq-participation-magpie',
    configRevision: 1,
    appliedRevision: null,
    settings: {
      ...policy.judge,
      connection: { baseUrl: 'http://127.0.0.1:3425/v1', model: '', authMode: 'local-client-id' },
    },
    bindingId: null,
    credential: { available: true, writable: false, version: 'fixture', source: 'local-client-id' },
    readiness: 'unconfigured',
    active: 0,
    admittedAttempts: 0,
    inputTokens: null,
    outputTokens: null,
    error: null,
  };
  controller.setJudge({
    view: async () => {
      const saved = await controller.judgePolicyPorts().read();
      return { ...judge, settings: { ...saved.settings, connection: judge.settings.connection } };
    },
    save: async () => ({ error: null }),
    credential: async () => {},
    close: async () => {},
  });
  controller.setIngress({ official: async () => {}, onebot: async () => {} });
  await controller.initialize();
  const qq = controller;
  cleanups.push(async () => {
    if (failOfficialClose) {
      await qq.close().catch(() => {});
      await host.close().catch(() => {});
    } else {
      await qq.close();
      await host.close();
    }
    const target = await realpath(root);
    if (
      path.dirname(target) !== (await realpath(tmpdir())) ||
      !path.basename(target).startsWith('qq-controller-test-')
    )
      throw new Error('unexpected cleanup');
    await rm(target, { recursive: true });
  });
  return {
    qq,
    root,
    host,
    runtime,
    listening,
    ports,
    starts: () => ({ official: officialStarts, onebot: onebotStarts }),
  };
}

it('saves, starts, deduplicates and retires sources independently with target-bound keys', async () => {
  const f = await setup();
  let view = await f.qq.view();
  expect(isQQView(view)).toBe(true);
  expect(f.starts()).toEqual({ official: 0, onebot: 0 });
  const official = view.sources.find((source) => source.protocol === 'official');
  const onebot = view.sources.find((source) => source.protocol === 'onebot-v11');
  if (!official || !onebot) throw new Error('missing sources');
  const settings: QQOfficialSettings = {
    protocol: 'official',
    appId: 'account-a',
    scenes: ['private'],
  };
  view = await f.qq.saveSource({
    protocol: 'official',
    expectedRevision: official.configRevision,
    settings,
  });
  let source = view.sources.find((entry) => entry.protocol === 'official');
  if (!source) throw new Error('missing source');
  await f.qq.credential({
    protocol: 'official',
    expectedRevision: source.configRevision,
    expectedCredentialVersion: source.credential.version,
    value: key,
  });
  await f.qq.setPlugin(QQ_OFFICIAL_PLUGIN_ID, true, 'enable-official');
  await vi.waitFor(async () =>
    expect(
      (await f.qq.status()).sources.find((entry) => entry.protocol === 'official')?.phase,
    ).toBe('ready'),
  );
  expect(f.starts().official).toBe(1);
  expect((await f.qq.setPlugin(QQ_OFFICIAL_PLUGIN_ID, true, 'enable-official')).status).toBe(
    'duplicate',
  );
  expect(f.starts().official).toBe(1);
  view = await f.qq.view();
  source = view.sources.find((entry) => entry.protocol === 'official');
  if (!source) throw new Error('missing official');
  const original = source.credential;
  const nextOnebot: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    mode: 'reverse-ws',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  view = await f.qq.saveSource({
    protocol: 'onebot-v11',
    expectedRevision: onebot.configRevision,
    settings: nextOnebot,
  });
  const changed = view.sources.find((entry) => entry.protocol === 'onebot-v11');
  if (!changed) throw new Error('missing onebot');
  await f.qq.credential({
    protocol: 'onebot-v11',
    expectedRevision: changed.configRevision,
    expectedCredentialVersion: changed.credential.version,
    value: key + '-onebot',
  });
  await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, true, 'enable-onebot');
  await vi.waitFor(async () =>
    expect(
      (await f.qq.status()).sources.find((entry) => entry.protocol === 'onebot-v11')?.phase,
    ).toBe('ready'),
  );
  const onebotCount = f.starts().onebot;
  view = await f.qq.saveSource({
    protocol: 'official',
    expectedRevision: source.configRevision,
    settings: { ...settings, appId: 'account-b' },
  });
  source = view.sources.find((entry) => entry.protocol === 'official');
  expect(source?.credential.available).toBe(false);
  expect(source?.credential.version).not.toBe(original.version);
  expect(f.starts().onebot).toBe(onebotCount);
  expect(view.sources.find((entry) => entry.protocol === 'onebot-v11')?.phase).toBe('ready');
  expect(JSON.stringify(view)).not.toContain(key);
  const scan = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile())
        expect((await readFile(file)).includes(Buffer.from(key))).toBe(false);
    }
  };
  await scan(f.root);
  await expect(
    f.qq.credential({
      protocol: 'official',
      expectedRevision: source?.configRevision,
      expectedCredentialVersion: original.version,
      value: key,
    }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
  await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, false, 'disable-onebot');
  expect(
    (await f.qq.status()).sources.find((entry) => entry.protocol === 'onebot-v11')?.phase,
  ).toBe('disabled');
});

it('reports failed source cleanup and does not start a replacement binding', async () => {
  const f = await setup(false, true);
  let view = await f.qq.view();
  const initial = view.sources.find((entry) => entry.protocol === 'official');
  if (!initial) throw new Error('missing official');
  const settings: QQOfficialSettings = {
    protocol: 'official',
    appId: 'old-account',
    scenes: ['private'],
  };
  view = await f.qq.saveSource({
    protocol: 'official',
    expectedRevision: initial.configRevision,
    settings,
  });
  const saved = view.sources.find((entry) => entry.protocol === 'official');
  if (!saved) throw new Error('missing saved source');
  await f.qq.credential({
    protocol: 'official',
    expectedRevision: saved.configRevision,
    expectedCredentialVersion: saved.credential.version,
    value: key,
  });
  await f.qq.setPlugin(QQ_OFFICIAL_PLUGIN_ID, true, 'enable-with-failing-cleanup');
  await vi.waitFor(async () =>
    expect(
      (await f.qq.status()).sources.find((entry) => entry.protocol === 'official')?.phase,
    ).toBe('ready'),
  );
  const before = (await f.qq.view()).sources.find((entry) => entry.protocol === 'official');
  if (!before) throw new Error('missing source');
  await expect(
    f.qq.saveSource({
      protocol: 'official',
      expectedRevision: before.configRevision,
      settings: { ...settings, appId: 'new-account' },
    }),
  ).rejects.toBeInstanceOf(Error);
  const after = (await f.qq.view()).sources.find((entry) => entry.protocol === 'official');
  expect(after?.credential.available).toBe(false);
  expect(after?.appliedRevision).toBeNull();
  expect(after?.cleanup).toBe('failed');
  expect(after?.error).not.toBeNull();
  expect(f.starts().official).toBe(1);
});

it('starts and retires the real reverse socket under source ownership', async () => {
  const f = await setup(true);
  const first = (await f.qq.view()).sources.find((entry) => entry.protocol === 'onebot-v11');
  if (!first) throw new Error('missing onebot');
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    mode: 'reverse-ws',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const saved = await f.qq.saveSource({
    protocol: 'onebot-v11',
    expectedRevision: first.configRevision,
    settings,
  });
  const source = saved.sources.find((entry) => entry.protocol === 'onebot-v11');
  if (!source) throw new Error('missing saved onebot');
  await f.qq.credential({
    protocol: 'onebot-v11',
    expectedRevision: source.configRevision,
    expectedCredentialVersion: source.credential.version,
    value: key,
  });
  await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, true, 'real-source-enable');
  const port = await f.listening;
  const remote = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: { Authorization: `Bearer ${key}`, 'X-Self-ID': '555', 'X-Client-Role': 'Universal' },
  });
  remote.on('error', () => {});
  await once(remote, 'open');
  await vi.waitFor(async () =>
    expect(
      (await f.qq.status()).sources.find((entry) => entry.protocol === 'onebot-v11')?.phase,
    ).toBe('ready'),
  );
  await f.qq.captureParticipantAuthority();
  const captured = f.qq.sourceFor({
    protocol: 'onebot-v11',
    sourcePluginId: QQ_ONEBOT_PLUGIN_ID,
    instanceId: 'default',
    accountId: '555',
  });
  await captured.check();
  const oldSignal = once(captured.signal, 'abort');
  remote.close();
  await oldSignal;
  expect(captured.signal.aborted).toBe(true);
  await vi.waitFor(async () =>
    expect(
      (await f.qq.status()).sources.find((entry) => entry.protocol === 'onebot-v11')?.phase,
    ).toBe('connecting'),
  );
  const replacement = new WebSocket(`ws://127.0.0.1:${port}/qq`, {
    headers: { Authorization: `Bearer ${key}`, 'X-Self-ID': '555', 'X-Client-Role': 'Universal' },
  });
  replacement.on('error', () => {});
  await once(replacement, 'open');
  await vi.waitFor(async () =>
    expect(
      (await f.qq.status()).sources.find((entry) => entry.protocol === 'onebot-v11')?.phase,
    ).toBe('ready'),
  );
  const next = f.qq.sourceFor({
    protocol: 'onebot-v11',
    sourcePluginId: QQ_ONEBOT_PLUGIN_ID,
    instanceId: 'default',
    accountId: '555',
  });
  expect(next.connectionId).not.toBe(captured.connectionId);
  expect(next.signal.aborted).toBe(false);
  await next.check();
  await expect(captured.check()).rejects.toBeInstanceOf(Error);
  await f.host.setEnabled(QQ_FEATURE_PLUGIN_ID, false);
  expect(next.signal.aborted).toBe(true);
  expect(() => f.qq.sourceFor(next.account)).toThrow();
  expect(
    (await f.qq.status()).sources.find((entry) => entry.protocol === 'onebot-v11')?.source,
  ).toBe('unavailable');
  const disabledView = await f.qq.view();
  expect(isQQView(disabledView)).toBe(true);
  expect(disabledView.sources.find((entry) => entry.protocol === 'onebot-v11')).toMatchObject({
    source: 'unavailable',
    phase: 'failed',
  });
  await f.host.setEnabled(QQ_FEATURE_PLUGIN_ID, true);
  expect(() => f.qq.sourceFor(next.account)).toThrow();
  const participant = await f.qq.captureParticipantAuthority();
  const reauthorized = f.qq.sourceFor(next.account);
  expect(reauthorized.signal.aborted).toBe(false);
  await reauthorized.check();
  await expect(next.check()).rejects.toBeInstanceOf(Error);
  const feature = { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' };
  f.host.permissionControl.setPreset(feature, 'deny');
  expect(reauthorized.signal.aborted).toBe(true);
  expect(participant.signal.aborted).toBe(true);
  f.host.permissionControl.setPreset(feature, 'allow');
  expect(() => f.qq.sourceFor(next.account)).toThrow();
  const freshParticipant = await f.qq.captureParticipantAuthority();
  const freshSource = f.qq.sourceFor(next.account);
  await freshSource.check();
  await expect(reauthorized.check()).rejects.toBeInstanceOf(Error);
  const disconnected = new Promise<void>((resolve) => replacement.once('close', () => resolve()));
  await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, false, 'real-source-disable');
  await disconnected;
  expect(next.signal.aborted).toBe(true);
  expect(freshParticipant.signal.aborted).toBe(false);
  expect(freshSource.signal.aborted).toBe(true);
  await f.host.setEnabled(QQ_FEATURE_PLUGIN_ID, false);
  expect(freshParticipant.signal.aborted).toBe(true);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
});

it('restarts a physically settled source only on a fresh explicit enable intent', async () => {
  const f = await setup(true);
  const initial = (await f.qq.view()).sources.find((entry) => entry.protocol === 'onebot-v11');
  if (!initial) throw new Error('missing source');
  const settings: QQOneBotSettings = {
    protocol: 'onebot-v11',
    accountId: '555',
    channelMode: 'universal',
    mediaProfile: 'snowluma-v11',
    mode: 'reverse-ws',
    listenHost: '127.0.0.1',
    listenPort: 0,
    path: '/qq',
  };
  const saved = await f.qq.saveSource({
    protocol: 'onebot-v11',
    expectedRevision: initial.configRevision,
    settings,
  });
  const source = saved.sources.find((entry) => entry.protocol === 'onebot-v11');
  if (!source) throw new Error('missing source');
  await f.qq.credential({
    protocol: 'onebot-v11',
    expectedRevision: source.configRevision,
    expectedCredentialVersion: source.credential.version,
    value: key,
  });
  await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, true, 'source-first-enable');
  await f.listening;
  expect(
    f.host.permissionControl.revoke({ pluginId: QQ_ONEBOT_PLUGIN_ID, instanceId: 'default' }),
  ).toBe(true);
  await vi.waitFor(() => expect(f.host.tasks.diagnostics().pendingWork).toBe(0));
  expect(
    f.host.permissionControl.setPreset(
      { pluginId: QQ_ONEBOT_PLUGIN_ID, instanceId: 'default' },
      'allow',
    ),
  ).toBe(true);
  expect((await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, true, 'source-first-enable')).status).toBe(
    'duplicate',
  );
  expect(f.ports).toHaveLength(1);
  await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, true, 'source-fresh-enable');
  await vi.waitFor(() => expect(f.ports).toHaveLength(2));
  await f.qq.setPlugin(QQ_ONEBOT_PLUGIN_ID, false, 'source-final-disable');
});

it('does not let a delayed stale source snapshot restore an old target credential', async () => {
  const f = await setup();
  const initial = (await f.qq.view()).sources.find((entry) => entry.protocol === 'official');
  if (!initial) throw new Error('missing source');
  const settings: QQOfficialSettings = {
    protocol: 'official',
    appId: 'old-target',
    scenes: ['private'],
  };
  const saved = await f.qq.saveSource({
    protocol: 'official',
    expectedRevision: initial.configRevision,
    settings,
  });
  const source = saved.sources.find((entry) => entry.protocol === 'official');
  if (!source) throw new Error('missing source');
  await f.qq.credential({
    protocol: 'official',
    expectedRevision: source.configRevision,
    expectedCredentialVersion: source.credential.version,
    value: key,
  });
  const original = f.host.configs.get.bind(f.host.configs);
  const entered = latch();
  const release = latch();
  let hold = true;
  const spy = vi.spyOn(f.host.configs, 'get').mockImplementation(async (...args) => {
    const snapshot = await original(...args);
    if (hold && args[0].pluginId === QQ_OFFICIAL_PLUGIN_ID) {
      hold = false;
      entered.resolve();
      await release.promise;
    }
    return snapshot;
  });
  const stale = f.qq.view();
  await entered.promise;
  try {
    const updated = await f.host.configs.save(
      { pluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' },
      { ...settings, appId: 'new-target' },
      source.configRevision,
    );
    expect(updated.ok).toBe(true);
    release.resolve();
    await expect(stale).rejects.toMatchObject({ error: { code: 'conflict' } });
  } finally {
    release.resolve();
    await stale.catch(() => {});
    spy.mockRestore();
  }
  const current = (await f.qq.view()).sources.find((entry) => entry.protocol === 'official');
  expect(current?.credential.available).toBe(false);
  expect(current?.settings).toMatchObject({ appId: 'new-target' });
});

it('retires the captured source and clears the credential on a semantically invalid source commit', async () => {
  const f = await setup();
  const initial = (await f.qq.view()).sources.find((entry) => entry.protocol === 'official');
  if (!initial) throw new Error('missing source');
  const settings: QQOfficialSettings = {
    protocol: 'official',
    appId: 'good-account',
    scenes: ['private'],
  };
  const saved = await f.qq.saveSource({
    protocol: 'official',
    expectedRevision: initial.configRevision,
    settings,
  });
  const source = saved.sources.find((entry) => entry.protocol === 'official');
  if (!source) throw new Error('missing source');
  await f.qq.credential({
    protocol: 'official',
    expectedRevision: source.configRevision,
    expectedCredentialVersion: source.credential.version,
    value: key,
  });
  await f.qq.setPlugin(QQ_OFFICIAL_PLUGIN_ID, true, 'invalid-source-enable');
  await vi.waitFor(async () =>
    expect(
      (await f.qq.status()).sources.find((entry) => entry.protocol === 'official')?.phase,
    ).toBe('ready'),
  );
  await f.qq.captureParticipantAuthority();
  const captured = f.qq.sourceFor({
    protocol: 'official',
    sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
    instanceId: 'default',
    accountId: 'good-account',
  });
  const invalid = await f.host.configs.save(
    { pluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' },
    { ...settings, appId: 'invalid account' },
    source.configRevision,
  );
  expect(invalid.ok).toBe(true);
  if (!invalid.ok) throw new Error('fixture config did not commit');
  await expect(captured.check()).rejects.toBeInstanceOf(Error);
  const repaired = await f.host.configs.save(
    { pluginId: QQ_OFFICIAL_PLUGIN_ID, instanceId: 'default' },
    { ...settings },
    invalid.value.snapshot.revision,
  );
  expect(repaired.ok).toBe(true);
  const after = (await f.qq.view()).sources.find((entry) => entry.protocol === 'official');
  expect(after?.credential.available).toBe(false);
  expect(after?.appliedRevision).toBeNull();
});

it('fails closed after a structurally valid but semantically invalid policy commit and permits repair', async () => {
  const f = await setup();
  const before = f.qq.policy();
  const captured = await f.qq.captureParticipantAuthority();
  const recheck = vi.spyOn(f.runtime, 'recheckInputAuthorities');
  const malformed = {
    ...before.settings,
    privateAllowlist: [
      {
        account: {
          protocol: 'official',
          sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
          instanceId: 'default',
          accountId: 'fixture',
        },
        scene: 'private',
        senderId: 'person',
        groupId: 'unexpected-group',
      },
    ],
  };
  const saved = await f.host.configs.save(
    { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' },
    malformed as unknown as JsonObject,
    before.revision,
  );
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error('fixture config did not commit');
  expect(() => f.qq.policy()).toThrow();
  expect(captured.signal.aborted).toBe(true);
  await expect(captured.check()).rejects.toBeInstanceOf(Error);
  await vi.waitFor(() => expect(recheck).toHaveBeenCalledOnce());
  const repaired = await f.qq.savePolicy({
    expectedRevision: saved.value.snapshot.revision,
    settings: before.settings,
  });
  expect(repaired.policy.settings).toEqual(before.settings);
  expect(recheck).toHaveBeenCalledTimes(2);
});

it('fences a captured participant lease across deny and restore without reviving old grants', async () => {
  const f = await setup();
  const [old, same] = await Promise.all([
    f.qq.captureParticipantAuthority(),
    f.qq.captureParticipantAuthority(),
  ]);
  expect(same.signal).toBe(old.signal);
  expect(f.host.permissions.diagnostics().leases).toBe(1);
  const feature = { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' };
  expect(f.host.permissionControl.setPreset(feature, 'deny')).toBe(true);
  expect(old.signal.aborted).toBe(true);
  expect(f.host.permissionControl.setPreset(feature, 'allow')).toBe(true);
  await expect(old.check()).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  const fresh = await f.qq.captureParticipantAuthority();
  expect(fresh.policyEpoch).not.toBe(old.policyEpoch);
  expect(fresh.signal.aborted).toBe(false);
  await fresh.check();
  expect(f.host.permissions.diagnostics().leases).toBe(1);
  await f.qq.close();
  expect(fresh.signal.aborted).toBe(true);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
});

it('keeps the owner snapshot and saved management view available when QQ is disabled', async () => {
  const f = await setup(false, false, true);
  expect(f.host.isEnabled(QQ_FEATURE_PLUGIN_ID)).toBe(false);
  f.runtime.setQQStatusProvider(() => f.qq.status());
  const snapshot = await f.runtime.snapshot();
  expect(snapshot.qq?.sources).toHaveLength(2);
  expect(
    snapshot.qq?.sources.every(
      (entry) => entry.source === 'disabled' && entry.phase === 'disabled',
    ),
  ).toBe(true);
  const view = await f.qq.view();
  expect(isQQView(view)).toBe(true);
  const policy = await f.qq.judgePolicyPorts().read();
  expect(policy.settings).toEqual(view.policy.settings.judge);
  const saved = await f.qq
    .judgePolicyPorts()
    .save(policy.revision, { ...policy.settings, maxAttemptsPerHour: 1 });
  expect(saved.revision).toBeGreaterThan(policy.revision);
  expect((await f.qq.view()).policy.settings.judge.maxAttemptsPerHour).toBe(1);
  expect(() => f.qq.policy()).toThrow();
  await expect(f.qq.captureParticipantAuthority()).rejects.toBeInstanceOf(Error);
  expect(() =>
    f.qq.sourceFor({
      protocol: 'official',
      sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
      instanceId: 'default',
      accountId: 'fixture',
    }),
  ).toThrow();
  expect(f.starts()).toEqual({ official: 0, onebot: 0 });
  const profile = await f.runtime.profile();
  const configured = await f.host.configs.save(
    { pluginId: 'pet.companion-host', instanceId: 'default' },
    { ...profile.data, enabledOptionalPlugins: [QQ_OFFICIAL_PLUGIN_ID] },
    profile.revision,
  );
  expect(configured.ok).toBe(true);
  const unavailable = (await f.runtime.snapshot()).qq?.sources.find(
    (entry) => entry.protocol === 'official',
  );
  expect(unavailable).toMatchObject({ desiredEnabled: true, source: 'unavailable' });
  expect(f.starts().official).toBe(0);
});

it('does not block the owner snapshot when a disabled QQ feature has invalid saved policy', async () => {
  const f = await setup(false, false, true, true);
  f.runtime.setQQStatusProvider(() => f.qq.status());
  expect(
    (await f.runtime.snapshot()).qq?.sources.every((entry) => entry.source === 'disabled'),
  ).toBe(true);
  await expect(f.qq.view()).rejects.toBeInstanceOf(Error);
  await expect(f.qq.judgePolicyPorts().read()).rejects.toBeInstanceOf(Error);
  await expect(f.qq.captureParticipantAuthority()).rejects.toBeInstanceOf(Error);
});

it('retires the participant lease when the shared feature owner stops', async () => {
  const f = await setup();
  const old = await f.qq.captureParticipantAuthority();
  await f.host.setEnabled(QQ_FEATURE_PLUGIN_ID, false);
  expect(old.signal.aborted).toBe(true);
  await expect(old.check()).rejects.toBeInstanceOf(Error);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  await f.host.setEnabled(QQ_FEATURE_PLUGIN_ID, true);
  const fresh = await f.qq.captureParticipantAuthority();
  expect(fresh.signal).not.toBe(old.signal);
  await fresh.check();
});

it('rejects a QQ view when a real policy CAS lands during a gated old judge view', async () => {
  const f = await setup();
  const before = await f.qq.view();
  const entered = latch();
  const release = latch();
  let calls = 0;
  f.qq.setJudge({
    async view() {
      calls++;
      if (calls === 1) {
        entered.resolve();
        await release.promise;
        return before.judge;
      }
      const policy = await f.qq.judgePolicyPorts().read();
      return {
        ...before.judge,
        settings: { ...policy.settings, connection: before.judge.settings.connection },
      };
    },
    save: async () => ({ error: null }),
    credential: async () => {},
    close: async () => {},
  });
  const pending = f.qq.view();
  await entered.promise;
  try {
    const saved = await f.host.configs.save(
      { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' },
      {
        ...before.policy.settings,
        judge: { ...before.policy.settings.judge, maxAttemptsPerHour: 1 },
      } as unknown as JsonObject,
      before.policy.revision,
    );
    expect(saved.ok).toBe(true);
    release.resolve();
    await expect(pending).rejects.toMatchObject({ error: { code: 'conflict' } });
    const current = await f.qq.view();
    expect(current.policy.revision).toBeGreaterThan(before.policy.revision);
    expect(current.policy.settings.judge.maxAttemptsPerHour).toBe(1);
    expect(current.judge.settings.maxAttemptsPerHour).toBe(1);
  } finally {
    release.resolve();
    await pending.catch(() => {});
  }
});

it('rejects a stale judge policy even when the saved policy revision is unchanged', async () => {
  const f = await setup();
  const current = await f.qq.view();
  f.qq.setJudge({
    view: async () => ({
      ...current.judge,
      settings: { ...current.judge.settings, maxAttemptsPerHour: 1 },
    }),
    save: async () => ({ error: null }),
    credential: async () => {},
    close: async () => {},
  });
  await expect(f.qq.view()).rejects.toMatchObject({ error: { code: 'conflict' } });
});

it('rechecks participant authority only for authority-relevant policy edits', async () => {
  const f = await setup();
  const spy = vi.spyOn(f.runtime, 'recheckInputAuthorities');
  const authority = await f.qq.captureParticipantAuthority();
  const before = (await f.qq.view()).policy;
  const voice = await f.qq.savePolicy({
    expectedRevision: before.revision,
    settings: { ...before.settings, voiceOutputEnabled: true },
  });
  expect(spy).not.toHaveBeenCalled();
  expect(authority.signal.aborted).toBe(false);
  await authority.check();
  const account = {
    protocol: 'official' as const,
    sourcePluginId: QQ_OFFICIAL_PLUGIN_ID,
    instanceId: 'default' as const,
    accountId: 'fixture',
  };
  await f.qq.savePolicy({
    expectedRevision: voice.policy.revision,
    settings: {
      ...voice.policy.settings,
      privateAllowlist: [{ account, scene: 'private', senderId: 'person' }],
    },
  });
  expect(spy).toHaveBeenCalledOnce();
  await expect(
    f.qq.savePolicy({ expectedRevision: before.revision, settings: before.settings }),
  ).rejects.toMatchObject({ error: { code: 'conflict' } });
});
