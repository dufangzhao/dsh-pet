import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { definePlugin } from '@pet/plugin-sdk';
import {
  defaultQQPolicySettings,
  QQ_FEATURE_PLUGIN_ID,
  QQ_CODEC_PLUGIN_ID,
  VOICE_ASR_PROVIDER,
  makeError,
  type PluginManifest,
  type CompanionInputOrigin,
  type QQProtocol,
  type QQAccountRef,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import {
  CompanionPluginHost,
  CompanionRuntime,
  ModelConnections,
  companionHostDefinition,
  companionHostManifest,
  STATE_CAPABILITY,
  type RuntimeInputAccess,
  type ServicePluginRegistration,
} from '@pet/companion-runtime';
import statePlugin from '@pet/state-sqlite';
import { createSharedQQPlugin } from '@pet/shared-qq';
import { createOfficialQqPlugin } from '@pet/qq-official';
import { createOneBotQqPlugin } from '@pet/qq-onebot';
import { createQqMediaCodecPlugin } from '@pet/qq-media-codec';
import { createSharedVoicePlugin } from '@pet/shared-voice';
import { parseMagpieAsrSettings } from '@pet/asr-magpie';
import { QQController } from './qq-controller.js';
import { QQAudio } from './qq-audio.js';
import { VoiceController } from './voice-controller.js';
import { SpeechController } from './speech-controller.js';
import { createMaterialStore, type HostMaterialStore } from './material-store.js';
import { createQQMediaTransfer, type QQMediaTransfer } from './qq-media-transfer.js';
import type { QQMappedInput, QQRemoteMaterial } from './qq-input.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const value = Buffer.alloc(data.length + 12);
    value.writeUInt32BE(data.length);
    value.write(type, 4);
    data.copy(value, 8);
    value.writeUInt32BE(crc32(value.subarray(4, value.length - 4)), value.length - 4);
    return value;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 255, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function wave(): Buffer {
  const output = Buffer.alloc(44 + 32000);
  output.write('RIFF');
  output.writeUInt32LE(output.length - 8, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(16000, 24);
  output.writeUInt32LE(32000, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(32000, 40);
  for (let at = 0; at < 16000; at++)
    output.writeInt16LE(
      Math.round(10000 * Math.sin((2 * Math.PI * 220 * at) / 16000)),
      44 + at * 2,
    );
  return output;
}
async function fixture(options: { expectedOfficialCloseFailure?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'qq-transfer-test-'));
  const payloads = new Map<string, Buffer>([
    ['file', Buffer.from('actual binary bytes'.repeat(1000))],
    ['image', png()],
    ['voice', wave()],
  ]);
  const calls: { protocol: string; action: string; data: unknown }[] = [];
  const controls = {
    asrText: '实际语音正文',
    badComplete: false,
    failPhysical: false,
    holdPhysical: false,
    physicalEntered: deferred(),
    physicalRelease: deferred(),
  };
  const server = createServer((request, response) => {
    void (async () => {
      const key = request.url?.slice(1) ?? '',
        payload = payloads.get(key);
      if (!payload) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': payload.length,
      });
      for (let at = 0; at < payload.length; at += 65536) {
        if (response.destroyed) return;
        if (!response.write(payload.subarray(at, at + 65536)))
          await new Promise<void>((resolve) => {
            const finish = () => {
              response.off('drain', finish);
              response.off('close', finish);
              resolve();
            };
            response.once('drain', finish);
            response.once('close', finish);
          });
      }
      response.end();
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No controlled peer');
  const base = `http://127.0.0.1:${address.port}`;
  const physical = async () => {
    controls.physicalEntered.resolve();
    if (controls.holdPhysical) await controls.physicalRelease.promise;
    if (controls.failPhysical) throw new KernelFault('unavailable');
  };
  const manifestNames = [
    'state-sqlite',
    'shared-qq',
    'qq-official',
    'qq-onebot',
    'shared-voice',
    'asr-magpie',
    'qq-media-codec',
  ] as const;
  const manifestEntries = await Promise.all(
    manifestNames.map(
      async (name) =>
        [
          name,
          JSON.parse(
            await readFile(
              new URL(`../../../plugins/${name}/plugin.json`, import.meta.url),
              'utf8',
            ),
          ) as PluginManifest,
        ] as const,
    ),
  );
  const manifests = Object.fromEntries(manifestEntries);
  const refs: {
    qq?: QQController;
    voice?: VoiceController;
    speech?: SpeechController;
    audio?: QQAudio;
    materials?: HostMaterialStore;
    transfer?: QQMediaTransfer;
    host?: CompanionPluginHost;
    connections?: ModelConnections;
  } = {};
  const need = <K extends keyof typeof refs>(key: K): NonNullable<(typeof refs)[K]> => {
    const value = refs[key];
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const registrations: ServicePluginRegistration[] = [];
  const asrDefinition = definePlugin({
    async activate(context) {
      const ports = await need('voice').providerPorts(context);
      context.provide('magpie', { describe: async () => ({ nativeAsr: true }) });
      context.effect(() =>
        ports.bind({
          catalog: async () => [],
          transcribe: async (input, signal) => {
            let bytes = 0;
            for await (const chunk of input.audio) {
              signal.throwIfAborted();
              bytes += chunk.length;
            }
            expect(bytes).toBe(input.samples * 4);
            calls.push({ protocol: 'asr', action: 'transcribe', data: input.samples });
            return { kind: 'final', text: controls.asrText };
          },
        }),
      );
    },
  });
  for (const manifest of [companionHostManifest, ...Object.values(manifests)]) {
    const directory = path.join(root, 'sources', manifest.id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest));
    const definition =
      manifest.id === companionHostManifest.id
        ? companionHostDefinition
        : manifest.id === 'pet.state-sqlite'
          ? statePlugin
          : manifest.id === QQ_FEATURE_PLUGIN_ID
            ? createSharedQQPlugin((context) => need('qq').featurePorts(context))
            : manifest.id === 'pet.qq-official'
              ? definePlugin({
                  async activate(context) {
                    await need('qq').prepareSource(context);
                    return createOfficialQqPlugin((ctx) => need('qq').officialPorts(ctx)).activate(
                      context,
                    );
                  },
                })
              : manifest.id === 'pet.qq-onebot'
                ? definePlugin({
                    async activate(context) {
                      await need('qq').prepareSource(context);
                      return createOneBotQqPlugin((ctx) => need('qq').onebotPorts(ctx)).activate(
                        context,
                      );
                    },
                  })
                : manifest.id === 'pet.shared-voice'
                  ? createSharedVoicePlugin((context) => need('voice').featurePorts(context))
                  : manifest.id === 'pet.asr-magpie'
                    ? asrDefinition
                    : createQqMediaCodecPlugin((context) => need('audio').codecPorts(context));
    registrations.push({
      manifest,
      definition,
      directory,
      enabled: ['pet.state-sqlite', companionHostManifest.id].includes(manifest.id),
      preset: 'allow',
      ...(['pet.qq-official', 'pet.qq-onebot', 'pet.asr-magpie'].includes(manifest.id)
        ? {
            hostCredentials: [
              manifest.id === 'pet.qq-official'
                ? 'qq-official-app-secret'
                : manifest.id === 'pet.qq-onebot'
                  ? 'qq-onebot-access-token'
                  : 'asr-api-key',
            ],
          }
        : {}),
    });
  }
  cleanups.push(async () => {
    controls.physicalRelease.resolve();
    let error: unknown;
    for (const close of [
      () => refs.transfer?.close(),
      () => refs.audio?.close(),
      () => refs.materials?.close(),
      () => refs.voice?.close(),
      () => refs.speech?.close(),
      async () => {
        if (!options.expectedOfficialCloseFailure) {
          await refs.qq?.close();
          return;
        }
        await expect(refs.qq?.close()).rejects.toMatchObject({ error: { code: 'internal' } });
        expect(
          refs.host?.manager.get({ pluginId: 'pet.qq-official', instanceId: 'default' })?.state,
        ).toBe('pending_restart');
        expect(refs.host?.tasks.diagnostics().pendingWork).toBe(0);
      },
      async () => {
        if (!options.expectedOfficialCloseFailure) {
          await refs.host?.close();
          return;
        }
        await expect(refs.host?.close()).rejects.toMatchObject({
          name: 'Error',
          message: 'Runtime cleanup incomplete',
        });
        expect(
          refs.host?.manager
            .list()
            .filter((entry) => entry.state !== 'disabled')
            .map((entry) => ({ pluginId: entry.owner.pluginId, state: entry.state })),
        ).toEqual([{ pluginId: 'pet.qq-official', state: 'pending_restart' }]);
      },
      () => {
        if (options.expectedOfficialCloseFailure) refs.host?.permissions.close();
      },
      () => {
        if (options.expectedOfficialCloseFailure) refs.host?.configs.close();
      },
      () => {
        expect(refs.host?.tasks.diagnostics().pendingWork).toBe(0);
        expect(refs.host?.permissions.diagnostics().leases).toBe(0);
      },
    ]) {
      try {
        await close();
      } catch (caught) {
        error ??= caught;
      }
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (
      path.dirname(root) !== tmpdir() ||
      !path.basename(root).startsWith('qq-transfer-test-') ||
      (await realpath(root)) !== root
    )
      throw new Error('Unexpected root');
    await rm(root, { recursive: true });
    if (error) throw error;
  });
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(root, 'host'),
    plugins: registrations,
  });
  refs.host = host;
  host.bind(STATE_CAPABILITY, 'pet.state-sqlite', 'sqlite');
  const runtime = new CompanionRuntime(host, {
    mode: 'scripted',
    statePluginId: 'pet.state-sqlite',
    stateProviderId: 'sqlite',
    executionPluginId: 'none',
    executionProviderId: 'none',
    executionTimeoutMs: 1000,
    optionalPluginIds: ['pet.qq-official', 'pet.qq-onebot'],
  });
  const connections = new ModelConnections(host, [], () => {
    throw new Error('No main model');
  });
  refs.connections = connections;
  const qq = new QQController(host, runtime, connections, {
    officialFactory: (_host, binding) => {
      const closed = deferred(),
        abort = new AbortController();
      const unavailable = async () => ({
        ok: false as const,
        error: makeError('not-ready'),
        dispatched: false,
      });
      return {
        media: {
          inline: unavailable,
          prepare: unavailable,
          putPart: unavailable,
          finishPart: unavailable,
          commit: unavailable,
          readAttachment: async (input, signal, check) => {
            await check();
            expect(input.url.startsWith(base + '/')).toBe(true);
            calls.push({ protocol: 'official', action: 'download', data: input });
            const local = new AbortController(),
              joined = AbortSignal.any([signal, local.signal]);
            const response = await fetch(input.url, { signal: joined });
            if (!response.body) throw new Error('No body');
            const done = deferred();
            const settled = done.promise.then(physical);
            void settled.catch(() => {});
            return {
              body: {
                async *[Symbol.asyncIterator]() {
                  try {
                    for await (const chunk of response.body!) {
                      await check();
                      yield chunk;
                    }
                  } finally {
                    done.resolve();
                  }
                },
              },
              settled,
              cancel: () => {
                local.abort();
                done.resolve();
              },
            };
          },
        },
        openGateway: async () => {
          await binding.check();
          return {
            id: 'official-connection',
            signal: abort.signal,
            frames: {
              async *[Symbol.asyncIterator]() {
                yield JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } });
                yield JSON.stringify({
                  op: 0,
                  t: 'READY',
                  s: 1,
                  d: { session_id: 's', user: { id: 'bot' } },
                });
                await closed.promise;
              },
            },
            settled: closed.promise,
            identify: async () => {},
            resume: async () => {},
            heartbeat: async () => {},
            close: async () => {
              abort.abort();
              closed.resolve();
            },
          };
        },
        send: unavailable,
        upload: unavailable,
        close: async () => {
          abort.abort();
          closed.resolve();
        },
      };
    },
    onebotFactory: (_host, binding) => {
      const closed = deferred(),
        abort = new AbortController(),
        frames = new Readable({ objectMode: true, read() {} });
      let used = false;
      return {
        nextPeer: async () => {
          await binding.check();
          if (used) {
            await closed.promise;
            throw new KernelFault('cancelled');
          }
          used = true;
          return {
            id: 'onebot-connection',
            selfId: binding.settings.accountId,
            signal: abort.signal,
            frames,
            settled: closed.promise,
            send: async (raw) => {
              const packet = raw;
              calls.push({ protocol: 'onebot-v11', action: packet.action, data: packet.params });
              frames.push(
                JSON.stringify({
                  status: 'ok',
                  retcode: 0,
                  echo: packet.echo,
                  data: { url: base + '/file' },
                }),
              );
              return { ok: true, value: null };
            },
            openMedia: (request, signal) => {
              calls.push({ protocol: 'onebot-v11', action: request.action, data: request.params });
              const local = new AbortController(),
                joined = AbortSignal.any([signal, local.signal]);
              const done = deferred();
              const settled = done.promise.then(physical);
              void settled.catch(() => {});
              const key =
                request.action === 'download_file_image_stream'
                  ? 'image'
                  : request.action === 'download_file_record_stream'
                    ? 'voice'
                    : 'file';
              const envelope = (data: unknown) =>
                JSON.stringify({
                  status: 'ok',
                  retcode: 0,
                  echo: request.echo,
                  stream: 'stream-action',
                  data,
                });
              return {
                sent: Promise.resolve({ ok: true, value: null }),
                settled,
                frames: {
                  async *[Symbol.asyncIterator]() {
                    try {
                      const response = await fetch(base + '/' + key, { signal: joined });
                      if (!response.body) throw new Error('No bytes');
                      const total = Number(response.headers.get('content-length'));
                      yield envelope({
                        type: 'stream',
                        data_type: 'file_info',
                        file_name: key + '.bin',
                        file_size: total,
                        chunk_size: 65536,
                      });
                      let index = 0,
                        bytes = 0;
                      for await (const chunk of response.body) {
                        bytes += chunk.length;
                        yield envelope({
                          type: 'stream',
                          data_type: 'file_chunk',
                          index: index++,
                          data: Buffer.from(chunk).toString('base64'),
                          size: chunk.length,
                          base64_size: Buffer.from(chunk).toString('base64').length,
                          progress: 0,
                        });
                      }
                      yield envelope({
                        type: 'response',
                        data_type: 'file_complete',
                        file_name: key + '.bin',
                        total_chunks: index,
                        total_bytes: bytes + (controls.badComplete ? 1 : 0),
                      });
                    } finally {
                      done.resolve();
                    }
                  },
                },
                close: async () => {
                  local.abort();
                  done.resolve();
                  await settled;
                },
              };
            },
            close: async () => {
              abort.abort();
              frames.push(null);
              closed.resolve();
            },
          };
        },
        close: async () => {
          abort.abort();
          frames.push(null);
          closed.resolve();
        },
      };
    },
  });
  refs.qq = qq;
  const policy = defaultQQPolicySettings();
  qq.setJudge({
    view: async () => ({
      sourcePluginId: 'pet.qq-participation-magpie',
      configRevision: 1,
      appliedRevision: null,
      settings: {
        ...policy.judge,
        connection: { baseUrl: 'http://127.0.0.1:1/v1', model: '', authMode: 'local-client-id' },
      },
      bindingId: null,
      credential: {
        available: true,
        writable: false,
        version: 'fixture',
        source: 'local-client-id',
      },
      readiness: 'unconfigured',
      active: 0,
      admittedAttempts: 0,
      inputTokens: null,
      outputTokens: null,
      error: null,
    }),
    save: async () => ({ error: null }),
    credential: async () => {},
    close: async () => {},
  });
  qq.setIngress({ official: async () => {}, onebot: async () => {} });
  await qq.initialize();
  for (const protocol of ['official', 'onebot-v11'] as const) {
    let view = await qq.view();
    const source = view.sources.find((s) => s.protocol === protocol);
    if (!source) throw new Error('No source');
    view = await qq.saveSource({
      protocol,
      expectedRevision: source.configRevision,
      settings:
        protocol === 'official'
          ? { protocol, appId: 'fixture-account', scenes: ['private', 'group'] }
          : {
              protocol,
              accountId: '900',
              channelMode: 'universal',
              mediaProfile: 'snowluma-v11',
              mode: 'reverse-ws',
              listenHost: '127.0.0.1',
              listenPort: 0,
              path: '/qq',
            },
    });
    const saved = view.sources.find((s) => s.protocol === protocol);
    if (!saved) throw new Error('No source');
    await qq.credential({
      protocol,
      expectedRevision: saved.configRevision,
      expectedCredentialVersion: saved.credential.version,
      value: 'synthetic-key-not-live',
    });
    await qq.setPlugin(
      protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot',
      true,
      'enable-' + protocol,
    );
    await vi.waitFor(async () =>
      expect((await qq.status()).sources.find((s) => s.protocol === protocol)?.phase).toBe('ready'),
    );
  }
  const ar = registrations.find((r) => r.manifest.id === 'pet.asr-magpie');
  if (!ar) throw new Error('No ASR');
  const voice = new VoiceController(host, runtime, [
    {
      ...ar,
      enabled: true,
      asr: {
        providerId: 'magpie',
        label: 'synthetic',
        synthetic: true,
        parseConfig: parseMagpieAsrSettings,
      },
    },
  ]);
  refs.voice = voice;
  await voice.initialize();
  const voiceView = await voice.view();
  await voice.saveProvider({
    providerRef: VOICE_ASR_PROVIDER,
    expectedRevision: voiceView.providers[0]?.configRevision,
    settings: {
      baseUrl: 'http://127.0.0.1:1/v1',
      modelRef: 'xiaomi/mimo-v2.5-asr',
      authMode: 'local-client-id',
      protocol: 'mimo-native',
    },
  });
  const speech = new SpeechController(host, runtime, []);
  refs.speech = speech;
  const materialDirectory = path.join(root, 'material');
  await mkdir(materialDirectory);
  const materials = await createMaterialStore({
    host,
    state: runtime,
    directory: materialDirectory,
  });
  refs.materials = materials;
  const audio = new QQAudio({ host, runtime, voice, speech, materials });
  refs.audio = audio;
  const codec = await host.configs.get({ pluginId: QQ_CODEC_PLUGIN_ID, instanceId: 'default' });
  if (!codec.ok) throw new Error('No config');
  const pin = JSON.parse(
    await readFile(
      new URL('../../../plugins/qq-media-codec/codec-image.lock.json', import.meta.url),
      'utf8',
    ),
  ) as { imageId: string; manifestSha256: string };
  const written = await host.configs.save(
    { pluginId: QQ_CODEC_PLUGIN_ID, instanceId: 'default' },
    { imageId: pin.imageId, manifestSha256: pin.manifestSha256 },
    codec.value.revision,
  );
  if (!written.ok) throw new Error('No config');
  await host.setEnabled(QQ_CODEC_PLUGIN_ID, true);
  const transfer = createQQMediaTransfer({ host, runtime, qq, materials, audio });
  refs.transfer = transfer;
  let count = 0;
  const account = (protocol: QQProtocol): QQAccountRef => ({
    protocol,
    sourcePluginId: protocol === 'official' ? 'pet.qq-official' : 'pet.qq-onebot',
    instanceId: 'default',
    accountId: protocol === 'official' ? 'fixture-account' : '900',
  });
  const input = async (protocol: QQProtocol, parts: readonly QQRemoteMaterial[], group = false) => {
    const id = 'input-' + ++count,
      ac = account(protocol),
      actor = group
        ? { account: ac, scene: 'group' as const, senderId: '101', groupId: '200' }
        : { account: ac, scene: 'private' as const, senderId: '101' };
    const route = {
      kind: 'qq' as const,
      account: ac,
      scene: actor.scene,
      targetId: group ? '200' : '101',
      reference: { eventId: null, messageId: '1', occurredAt: Date.now(), displayReference: null },
    };
    const origin: CompanionInputOrigin = {
      kind: 'qq',
      inputId: id,
      principalId: 'alice',
      audience: group
        ? { kind: 'qq-group', account: ac, groupId: '200' }
        : { kind: 'person-private', principalId: 'alice' },
      route,
      policyRevision: qq.policy().revision,
      actor,
      eventKey: 'event-' + id,
      messageId: '1',
      trigger: 'direct',
      quote: null,
    };
    const materialIds = parts.map((_, index) => id + '-material-' + index);
    const created = await runtime.state('createInput', {
      id,
      commandId: 'command-' + id,
      origin,
      evidence: { originalText: 'authored' },
      materialIds,
    });
    const abort = new AbortController(),
      authority = { allowed: true };
    const access: RuntimeInputAccess = {
      scope: { kind: 'conversation', audience: origin.audience, principalId: origin.principalId },
      signal: abort.signal,
      check: async () => {
        if (!authority.allowed) throw new KernelFault('permission-denied');
      },
    };
    const mapped: QQMappedInput = {
      eventKey: origin.eventKey,
      observationId: 'observation-' + id,
      actor,
      route,
      text: 'authored',
      quote: null,
      mentioned: false,
      self: false,
      machine: false,
      contextOnly: false,
      observedAt: Date.now(),
      materials: parts,
      fileEvidence: null,
    };
    await qq.captureParticipantAuthority();
    return { input: created.admission, mapped, source: qq.sourceFor(ac), access, abort, authority };
  };
  const part = (
    protocol: QQProtocol,
    kind: 'file' | 'image' | 'voice',
    quoted = false,
  ): QQRemoteMaterial =>
    protocol === 'official'
      ? {
          protocol,
          kind,
          quoted,
          attachment: {
            url: base + '/' + kind,
            filename: kind + '.bin',
            content_type:
              kind === 'voice'
                ? 'audio/wav'
                : kind === 'image'
                  ? 'image/png'
                  : 'application/octet-stream',
            size: payloads.get(kind)?.length ?? null,
            width: null,
            height: null,
            voice_wav_url: null,
            asr_refer_text: 'DO NOT TRUST REPORTED ASR',
          },
        }
      : {
          protocol,
          kind,
          quoted,
          segment: {
            type: kind === 'voice' ? 'record' : kind,
            data: {
              file_id: kind + '-ref',
              name: kind + '.bin',
              file_size: payloads.get(kind)?.length ?? null,
            },
          },
        };
  return {
    root,
    host,
    runtime,
    qq,
    materials,
    audio,
    transfer,
    controls,
    payloads,
    calls,
    base,
    part,
    input,
    account,
  };
}

it.each([
  ['official', false],
  ['official', true],
  ['onebot-v11', false],
  ['onebot-v11', true],
] as const)(
  'streams %s %s file and actual PNG in materialId order under real driver/State/byteplane',
  async (protocol, group) => {
    const f = await fixture(),
      a = await f.input(protocol, [f.part(protocol, 'file'), f.part(protocol, 'image')], group);
    const result = await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.materials.map((m) => m.id)).toEqual(a.input.materialIds);
    expect(result.materials.map((m) => m.kind)).toEqual(['file', 'image']);
    expect(result.materials[1]?.mediaType).toBe('image/png');
    expect(result.materials[0]?.sha256).toBe(hash(f.payloads.get('file')!));
    expect(result.transcript).toBe('');
    if (protocol === 'onebot-v11')
      expect(
        f.calls.some((c) => c.action === (group ? 'get_group_file_url' : 'get_private_file_url')),
      ).toBe(true);
  },
  30000,
);

it('downloads real original/wav fallback voice and keeps quoted ASR in notice notes only', async () => {
  const f = await fixture();
  let current = f.part('official', 'voice');
  const quoted = f.part('official', 'voice', true);
  if (quoted.protocol !== 'official') throw new Error('No official quote');
  const quote = {
    ...quoted,
    attachment: { ...quoted.attachment, voice_wav_url: f.base + '/file' },
  };
  if (current.protocol !== 'official') throw new Error('No part');
  current = {
    ...current,
    attachment: {
      ...current.attachment,
      url: null,
      filename: 'original.silk',
      voice_wav_url: f.base + '/voice',
      size: 9999999,
    },
  };
  const a = await f.input('official', [current, quote]);
  const result = await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access);
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(result.transcript).toBe('实际语音正文');
  expect(result.notes).toEqual(['引用语音转写（资料，不代表当前作者陈述）：\n实际语音正文']);
  expect(result.materials[0]?.name).toBe('original.wav');
  expect(result.materials.every((m) => m.durationMs === 1000)).toBe(true);
  expect(f.calls.filter((c) => c.protocol === 'asr')).toHaveLength(2);
}, 30000);

it('does not replace a captured connection or perform IO after denied scope', async () => {
  const f = await fixture(),
    a = await f.input('official', [f.part('official', 'file')]);
  const before = f.calls.length;
  expect(
    await f.transfer.prepareInput(
      a.input,
      a.mapped,
      { ...a.source, connectionId: 'another' },
      a.access,
    ),
  ).toMatchObject({ ok: false, error: { code: 'stale-owner' }, cleanup: 'settled' });
  a.authority.allowed = false;
  expect(await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
    cleanup: 'settled',
  });
  expect(f.calls).toHaveLength(before);
}, 30000);

it('does not send EOF to store when native download terminal evidence is wrong', async () => {
  const f = await fixture(),
    a = await f.input('onebot-v11', [f.part('onebot-v11', 'file')]);
  f.controls.badComplete = true;
  expect(await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access)).toMatchObject({
    ok: false,
    cleanup: 'unknown',
  });
  await expect(
    f.runtime.state('getMaterial', { id: a.input.materialIds[0]!, scope: a.access.scope }),
  ).rejects.toMatchObject({ error: { code: 'unavailable' } });
  expect(await readdir(path.join(f.root, 'material/materials/staging'))).toEqual([]);
}, 30000);

it('waits actual native physical join before EOF/metadata and close does not fake settlement', async () => {
  const f = await fixture(),
    a = await f.input('official', [f.part('official', 'file')]);
  f.controls.holdPhysical = true;
  let done = false;
  const work = f.transfer.prepareInput(a.input, a.mapped, a.source, a.access).then((value) => {
    done = true;
    return value;
  });
  await f.controls.physicalEntered.promise;
  expect(done).toBe(false);
  await expect(
    f.runtime.state('getMaterial', { id: a.input.materialIds[0]!, scope: a.access.scope }),
  ).rejects.toMatchObject({ error: { code: 'unavailable' } });
  let closed = false;
  const closing = f.transfer.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  f.controls.physicalRelease.resolve();
  expect(await work).toMatchObject({ ok: false, cleanup: 'unknown' });
  await closing;
  expect(await readdir(path.join(f.root, 'material/materials/staging'))).toEqual([]);
}, 30000);

it('loads a visible observed file through exact native lookup and reuses its current-input canonical material', async () => {
  const f = await fixture(),
    a = await f.input('onebot-v11', [], true),
    id = 'observe-file-evidence';
  await f.runtime.state('observe', {
    observation: {
      id,
      audience: a.input.origin.audience,
      principalId: 'bob',
      observedAt: Date.now(),
      text: 'not loaded metadata',
      quotedText: null,
      materialIds: [],
      fileEvidence: {
        kind: 'qq-file',
        account: f.account('onebot-v11'),
        groupId: '200',
        fileId: 'actual-file-id',
        busId: '0',
        name: 'evidence.bin',
        reportedSize: f.payloads.get('file')!.length,
      },
    },
  });
  const request = {
    title: 'read evidence',
    code: 'read only',
    materials: [{ materialId: id, inputName: 'evidence.bin' }],
  };
  const ready = await f.transfer.prepareWork(a.input, request, a.access);
  const canonical = ready.materials?.[0]?.materialId;
  expect(canonical).toMatch(/^material-[a-f0-9]{64}$/);
  expect(ready.materials?.[0]?.inputName).toBe('evidence.bin');
  expect(ready.code).toBe(request.code);
  expect(f.calls.filter((c) => c.action === 'get_group_file_url')).toHaveLength(1);
  expect(f.calls.find((c) => c.action === 'get_group_file_url')?.data).toEqual({
    group_id: '200',
    file_id: 'actual-file-id',
    busid: 0,
  });
  const stored = await f.runtime.state('getMaterial', { id: canonical!, scope: a.access.scope });
  expect(stored.inputId).toBe(a.input.id);
  expect(stored.observationId).toBe(id);
  expect(stored.reference?.originInputIds).toEqual([a.input.id]);
  const clock = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(clock + 24 * 60 * 60 * 1000);
  expect(await f.transfer.prepareWork(a.input, request, a.access)).toEqual(ready);
  expect(f.calls.filter((c) => c.action === 'get_group_file_url')).toHaveLength(1);
}, 30000);

it.each(['expired', 'cross-group', 'metadata-only'] as const)(
  'does not guess observed-file bytes for %s evidence',
  async (mode) => {
    const f = await fixture(),
      a = await f.input('onebot-v11', [], true),
      id = 'observe-file-refuse';
    const audience = a.input.origin.audience;
    if (audience.kind !== 'qq-group') throw new Error('No group');
    await f.runtime.state('observe', {
      observation: {
        id,
        audience: mode === 'cross-group' ? { ...audience, groupId: '201' } : audience,
        principalId: 'bob',
        observedAt: mode === 'expired' ? Date.now() - 24 * 60 * 60 * 1000 : Date.now(),
        text: 'metadata',
        quotedText: null,
        materialIds: [],
        fileEvidence:
          mode === 'metadata-only'
            ? null
            : {
                kind: 'qq-file',
                account: f.account('onebot-v11'),
                groupId: mode === 'cross-group' ? '201' : '200',
                fileId: 'actual-file-id',
                busId: null,
                name: 'evidence.bin',
                reportedSize: null,
              },
      },
    });
    const before = f.calls.length;
    await expect(
      f.transfer.prepareWork(
        a.input,
        {
          title: 'read evidence',
          code: 'never runs',
          materials: [{ materialId: id, inputName: 'evidence.bin' }],
        },
        a.access,
      ),
    ).rejects.toBeDefined();
    expect(f.calls).toHaveLength(before);
  },
  30000,
);

it('verifies ready material selections without downloading or changing the worker request', async () => {
  const f = await fixture(),
    a = await f.input('onebot-v11', [f.part('onebot-v11', 'file')]);
  const result = await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access);
  if (!result.ok) throw new Error('No material');
  const request = {
      title: 'read existing',
      code: 'unchanged',
      materials: [{ materialId: result.materials[0]!.id, inputName: 'existing.bin' }],
    },
    before = f.calls.length;
  expect(await f.transfer.prepareWork(a.input, request, a.access)).toEqual(request);
  expect(f.calls).toHaveLength(before);
}, 30000);

it('enforces actual aggregate32MiB even when both original file sizes are unreported', async () => {
  const f = await fixture();
  f.payloads.set('file', Buffer.alloc(17 * 1024 * 1024, 7));
  const original = f.part('onebot-v11', 'file');
  if (original.protocol !== 'onebot-v11') throw new Error('No part');
  const part = {
    ...original,
    segment: { ...original.segment, data: { file_id: 'actual-file', name: 'file.bin' } },
  };
  const a = await f.input('onebot-v11', [part, part]);
  expect(await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access)).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
    cleanup: 'unknown',
  });
  expect(
    (await f.runtime.state('getMaterial', { id: a.input.materialIds[0]!, scope: a.access.scope }))
      .reference?.sizeBytes,
  ).toBe(17 * 1024 * 1024);
  expect(await readdir(path.join(f.root, 'material/materials/staging'))).toEqual([]);
}, 30000);

it('counts current and quoted real transcripts together and never truncates a partial combined result', async () => {
  const f = await fixture();
  f.controls.asrText = 'x'.repeat(4000);
  const a = await f.input('onebot-v11', [
    f.part('onebot-v11', 'voice'),
    f.part('onebot-v11', 'voice', true),
  ]);
  expect(await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access)).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
    cleanup: 'settled',
  });
  expect(f.calls.filter((c) => c.protocol === 'asr')).toHaveLength(2);
}, 30000);

it.each(['participant', 'feature-epoch'] as const)(
  'does not revive an in-flight native transfer after %s revocation',
  async (mode) => {
    const f = await fixture(),
      a = await f.input('official', [f.part('official', 'file')]);
    f.controls.holdPhysical = true;
    const work = f.transfer.prepareInput(a.input, a.mapped, a.source, a.access);
    await f.controls.physicalEntered.promise;
    if (mode === 'participant') {
      a.authority.allowed = false;
      a.abort.abort();
    } else {
      f.host.permissionControl.setPreset(
        { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' },
        'deny',
      );
      f.host.permissionControl.setPreset(
        { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' },
        'allow',
      );
    }
    f.controls.physicalRelease.resolve();
    expect(await work).toMatchObject({ ok: false, cleanup: 'unknown' });
    await expect(
      f.runtime.state('getMaterial', { id: a.input.materialIds[0]!, scope: a.access.scope }),
    ).rejects.toMatchObject({ error: { code: 'unavailable' } });
    expect(await readdir(path.join(f.root, 'material/materials/staging'))).toEqual([]);
  },
  30000,
);

it.each(['official', 'onebot-v11'] as const)(
  'retains actual %s cleanup failure facts after native settled rejection',
  async (protocol) => {
    const f = await fixture({ expectedOfficialCloseFailure: protocol === 'official' }),
      a = await f.input(protocol, [f.part(protocol, 'file')]);
    f.controls.failPhysical = true;
    expect(await f.transfer.prepareInput(a.input, a.mapped, a.source, a.access)).toMatchObject({
      ok: false,
      cleanup: protocol === 'official' ? 'failed' : 'unknown',
    });
  },
  30000,
);
