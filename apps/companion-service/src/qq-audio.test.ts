import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { definePlugin } from '@pet/plugin-sdk';
import {
  QQ_FEATURE_PLUGIN_ID,
  QQ_CODEC_PLUGIN_ID,
  VOICE_ASR_PROVIDER,
  SPEECH_TTS_PROVIDER,
  QQ_REPLY_TEXT_SEPARATOR,
  type PluginManifest,
  type CompanionInputOrigin,
  type CompanionMessage,
  type QQDeliveryView,
  type QQDeliveryPart,
  type QQDeliveryAttempt,
} from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import statePlugin from '@pet/state-sqlite';
import {
  CompanionPluginHost,
  CompanionRuntime,
  companionHostDefinition,
  companionHostManifest,
  STATE_CAPABILITY,
  type ServicePluginRegistration,
  type RuntimeInputAccess,
} from '@pet/companion-runtime';
import { createMagpieAsrPlugin, parseMagpieAsrSettings } from '@pet/asr-magpie';
import { createMagpieSpeechPlugin, parseMagpieSpeechSettings } from '@pet/tts-magpie';
import { createSharedVoicePlugin } from '@pet/shared-voice';
import { createSharedSpeechPlugin } from '@pet/shared-speech';
import { createQqMediaCodecPlugin } from '@pet/qq-media-codec';
import { VoiceController } from './voice-controller.js';
import { SpeechController } from './speech-controller.js';
import { createMaterialStore, type HostMaterialStore } from './material-store.js';
import { QQAudio } from './qq-audio.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function* stream(bytes: Uint8Array) {
  for (let at = 0; at < bytes.length; at += 64 * 1024) yield bytes.subarray(at, at + 64 * 1024);
}
function wave(seconds: number): Buffer {
  const samples = Math.round(seconds * 16000),
    output = Buffer.alloc(44 + samples * 2);
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
  output.writeUInt32LE(samples * 2, 40);
  for (let at = 0; at < samples; at++)
    output.writeInt16LE(
      Math.round(
        12000 * Math.sin((at * 2 * Math.PI * (220 + Math.floor(at / 320000) * 73)) / 16000),
      ),
      44 + at * 2,
    );
  return output;
}
const account = {
  protocol: 'onebot-v11' as const,
  sourcePluginId: 'pet.qq-onebot',
  instanceId: 'default' as const,
  accountId: '900',
};
function origin(id: string): CompanionInputOrigin {
  return {
    kind: 'qq',
    inputId: id,
    principalId: 'alice',
    audience: { kind: 'person-private', principalId: 'alice' },
    policyRevision: 1,
    actor: { account, scene: 'private', senderId: '101' },
    eventKey: `event-${id}`,
    messageId: '1',
    trigger: 'direct',
    quote: null,
    route: {
      kind: 'qq',
      account,
      scene: 'private',
      targetId: '101',
      reference: { eventId: null, messageId: '1', occurredAt: Date.now(), displayReference: null },
    },
  };
}
async function fixture(
  options: {
    asrFail?: number;
    holdAsr?: number;
    ttsFinish?: string;
    ttsFrames?: number;
    noAsrGrant?: boolean;
    asrText?: string;
    holdEncode?: boolean;
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qq-audio-test-'));
  const asr: { frames: number; frequency: number; authorization: string | undefined }[] = [],
    tts: string[] = [];
  const held = deferred(),
    release = deferred();
  const controls = { codecAvailable: true };
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        model: string;
        messages: { content: string | { input_audio?: { data: string } }[] }[];
      };
      expect(request.url).toBe('/v1/magpie/native/xiaomi/v1/chat/completions');
      if (body.model === 'mimo-v2.5-asr') {
        expect(request.headers['user-agent']).toBe('dsh-pet-voice/1');
        const content = body.messages[0]?.content;
        if (!Array.isArray(content)) throw new Error('No ASR content');
        const encoded = content.find((part) => part.input_audio)?.input_audio?.data;
        if (!encoded?.startsWith('data:audio/wav;base64,')) throw new Error('No actual WAV');
        const wav = Buffer.from(encoded.slice('data:audio/wav;base64,'.length), 'base64');
        const frames = (wav.length - 44) / 2,
          powers = [];
        for (let which = 0; which < 6; which++) {
          let sine = 0,
            cosine = 0;
          const frequency = 220 + which * 73;
          for (let at = 0; at < Math.min(frames, 16000); at++) {
            const value = wav.readInt16LE(44 + at * 2);
            sine += value * Math.sin((2 * Math.PI * frequency * at) / 16000);
            cosine += value * Math.cos((2 * Math.PI * frequency * at) / 16000);
          }
          powers.push(sine * sine + cosine * cosine);
        }
        asr.push({
          frames,
          frequency: 220 + powers.indexOf(Math.max(...powers)) * 73,
          authorization: request.headers.authorization,
        });
        if (options.holdAsr === asr.length) {
          held.resolve();
          await Promise.race([
            release.promise,
            new Promise<void>((resolve) => response.once('close', () => resolve())),
          ]);
        }
        if (response.destroyed) return;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            choices: [
              {
                message: { content: options.asrText ?? `span-${asr.length}` },
                finish_reason: options.asrFail === asr.length ? 'length' : 'stop',
              },
            ],
          }),
        );
      } else {
        expect(body.model).toBe('mimo-v2.5-tts');
        expect(request.headers['user-agent']).toBe('dsh-pet-speech/1');
        const text = body.messages[0]?.content;
        if (typeof text !== 'string') throw new Error('No exact TTS text');
        tts.push(text);
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frames = options.ttsFrames ?? 4800;
        for (let at = 0; at < frames; at += 12000) {
          if (response.destroyed) return;
          const bytes = Buffer.alloc(Math.min(12000, frames - at) * 2);
          for (let frame = 0; frame < bytes.length / 2; frame++)
            bytes.writeInt16LE(
              Math.round(10000 * Math.sin(((at + frame) * 2 * Math.PI * 220) / 24000)),
              frame * 2,
            );
          response.write(
            `data: ${JSON.stringify({ id: 'c', model: 'mimo-v2.5-tts', choices: [{ index: 0, delta: { audio: { id: 'a', data: bytes.toString('base64') } }, finish_reason: null }] })}\n\n`,
          );
        }
        response.end(
          `data: ${JSON.stringify({ id: 'c', model: 'mimo-v2.5-tts', choices: [{ index: 0, delta: {}, finish_reason: options.ttsFinish ?? 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      }
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No peer');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const names = [
    'state-sqlite',
    'shared-voice',
    'asr-magpie',
    'shared-speech',
    'tts-magpie',
    'shared-qq',
    'qq-media-codec',
  ] as const;
  const manifests = Object.fromEntries(
    await Promise.all(
      names.map(
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
    ),
  );
  const controllers: {
    voice?: VoiceController;
    speech?: SpeechController;
    audio?: QQAudio;
    material?: HostMaterialStore;
    host?: CompanionPluginHost;
  } = {};
  const needVoice = () => {
    if (!controllers.voice) throw new Error('No voice');
    return controllers.voice;
  };
  const needSpeech = () => {
    if (!controllers.speech) throw new Error('No speech');
    return controllers.speech;
  };
  const needAudio = () => {
    if (!controllers.audio) throw new Error('No audio');
    return controllers.audio;
  };
  const asrManifest = manifests['asr-magpie'],
    ttsManifest = manifests['tts-magpie'];
  if (!asrManifest || !ttsManifest) throw new Error('No manifests');
  const asrDefinition = createMagpieAsrPlugin((context) => needVoice().providers.portsFor(context));
  const ttsDefinition = createMagpieSpeechPlugin((context) =>
    needSpeech().providers.portsFor(context),
  );
  const registrations: ServicePluginRegistration[] = [];
  for (const manifest of [companionHostManifest, ...Object.values(manifests)]) {
    const pluginDirectory = path.join(directory, 'sources', manifest.id);
    await mkdir(pluginDirectory, { recursive: true });
    const effective =
      options.noAsrGrant && manifest.id === QQ_FEATURE_PLUGIN_ID
        ? {
            ...manifest,
            permissions: (manifest.permissions ?? []).filter(
              (permission) =>
                permission.kind !== 'capability-use' ||
                permission.capability !== 'companion.voice.asr@1',
            ),
          }
        : manifest;
    await writeFile(path.join(pluginDirectory, 'plugin.json'), JSON.stringify(effective));
    const definition =
      manifest.id === companionHostManifest.id
        ? companionHostDefinition
        : manifest.id === 'pet.state-sqlite'
          ? statePlugin
          : manifest.id === 'pet.shared-voice'
            ? createSharedVoicePlugin((context) => needVoice().featurePorts(context))
            : manifest.id === 'pet.shared-speech'
              ? createSharedSpeechPlugin((context) => needSpeech().featurePorts(context))
              : manifest.id === 'pet.asr-magpie'
                ? definePlugin({
                    async activate(context) {
                      await needVoice().providerPorts(context);
                      return asrDefinition.activate(context);
                    },
                  })
                : manifest.id === 'pet.tts-magpie'
                  ? definePlugin({
                      async activate(context) {
                        await needSpeech().providerPorts(context);
                        return ttsDefinition.activate(context);
                      },
                    })
                  : manifest.id === QQ_CODEC_PLUGIN_ID
                    ? createQqMediaCodecPlugin((context) => {
                        const ports = needAudio().codecPorts(context);
                        return {
                          bind: (native) =>
                            ports.bind({
                              ...native,
                              describe: async () => {
                                const value = await native.describe();
                                return {
                                  ...value,
                                  available: value.available && controls.codecAvailable,
                                };
                              },
                              encode: async (input, consume, signal) => {
                                if (options.holdEncode) {
                                  held.resolve();
                                  await release.promise;
                                  signal.throwIfAborted();
                                }
                                return native.encode(input, consume, signal);
                              },
                            }),
                        };
                      })
                    : definePlugin({
                        activate(context) {
                          context.provide('control', { describe: async () => ({}) });
                        },
                      });
    registrations.push({
      manifest: effective,
      definition,
      directory: pluginDirectory,
      preset: 'allow',
      enabled: ['pet.state-sqlite', companionHostManifest.id, QQ_FEATURE_PLUGIN_ID].includes(
        manifest.id,
      ),
      ...(['pet.asr-magpie', 'pet.tts-magpie'].includes(manifest.id)
        ? { hostCredentials: [manifest.id === 'pet.asr-magpie' ? 'asr-api-key' : 'tts-api-key'] }
        : {}),
    });
  }
  cleanups.push(async () => {
    release.resolve();
    let failure: unknown;
    for (const close of [
      () => controllers.audio?.close(),
      () => controllers.material?.close(),
      () => controllers.voice?.close(),
      () => controllers.speech?.close(),
      () => controllers.host?.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failure ??= error;
      }
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('qq-audio-test-') ||
      (await realpath(directory)) !== directory
    )
      throw new Error('Unexpected root');
    await rm(directory, { recursive: true });
    if (failure) throw failure;
  });
  const host = await CompanionPluginHost.create({
    dataDirectory: path.join(directory, 'host'),
    plugins: registrations,
  });
  controllers.host = host;
  host.bind(STATE_CAPABILITY, 'pet.state-sqlite', 'sqlite');
  const runtime = new CompanionRuntime(host, {
    mode: 'scripted',
    statePluginId: 'pet.state-sqlite',
    stateProviderId: 'sqlite',
    executionPluginId: 'none',
    executionProviderId: 'none',
    executionTimeoutMs: 1000,
  });
  const voice = new VoiceController(host, runtime, [
    {
      ...registrations.find((r) => r.manifest.id === asrManifest.id),
      manifest: asrManifest,
      directory: path.join(directory, 'sources', asrManifest.id),
      definition: asrDefinition,
      preset: 'allow',
      hostCredentials: ['asr-api-key'],
      enabled: true,
      asr: {
        providerId: 'magpie',
        label: 'controlled',
        synthetic: true,
        parseConfig: parseMagpieAsrSettings,
      },
    },
  ]);
  controllers.voice = voice;
  await voice.initialize();
  const speech = new SpeechController(host, runtime, [
    {
      ...registrations.find((r) => r.manifest.id === ttsManifest.id),
      manifest: ttsManifest,
      directory: path.join(directory, 'sources', ttsManifest.id),
      definition: ttsDefinition,
      preset: 'allow',
      hostCredentials: ['tts-api-key'],
      enabled: true,
      tts: {
        providerId: 'magpie',
        label: 'controlled',
        synthetic: true,
        parseConfig: parseMagpieSpeechSettings,
      },
    },
  ]);
  controllers.speech = speech;
  await speech.initialize();
  const av = await voice.view(),
    tv = await speech.view();
  await voice.saveProvider({
    providerRef: VOICE_ASR_PROVIDER,
    expectedRevision: av.providers[0]?.configRevision,
    settings: {
      baseUrl,
      modelRef: 'xiaomi/mimo-v2.5-asr',
      authMode: 'local-client-id',
      protocol: 'mimo-native',
    },
  });
  await speech.saveProvider({
    providerRef: SPEECH_TTS_PROVIDER,
    expectedRevision: tv.providers[0]?.configRevision,
    settings: {
      baseUrl,
      modelRef: 'xiaomi/mimo-v2.5-tts',
      authMode: 'local-client-id',
      protocol: 'mimo-native-pcm16-sse',
      voice: 'Mia',
    },
  });
  const materialDirectory = path.join(directory, 'material');
  await mkdir(materialDirectory);
  const materials = await createMaterialStore({
    host,
    state: runtime,
    directory: materialDirectory,
  });
  controllers.material = materials;
  const audio = new QQAudio({ host, runtime, materials, voice, speech });
  controllers.audio = audio;
  const pin = JSON.parse(
    await readFile(
      new URL('../../../plugins/qq-media-codec/codec-image.lock.json', import.meta.url),
      'utf8',
    ),
  ) as { imageId: string; manifestSha256: string };
  const config = await host.configs.get({ pluginId: QQ_CODEC_PLUGIN_ID, instanceId: 'default' });
  if (!config.ok) throw new KernelFault(config.error.code);
  const saved = await host.configs.save(
    { pluginId: QQ_CODEC_PLUGIN_ID, instanceId: 'default' },
    { imageId: pin.imageId, manifestSha256: pin.manifestSha256 },
    config.value.revision,
  );
  if (!saved.ok) throw new KernelFault(saved.error.code);
  await host.setEnabled(QQ_CODEC_PLUGIN_ID, true);
  expect((await audio.preflightCodec()).source).toBe('ready');
  const policy = await host.configs.get({ pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' });
  if (!policy.ok) throw new KernelFault(policy.error.code);
  const policySaved = await host.configs.save(
    { pluginId: QQ_FEATURE_PLUGIN_ID, instanceId: 'default' },
    { ...policy.value.data, voiceOutputEnabled: true },
    policy.value.revision,
  );
  if (!policySaved.ok) throw new KernelFault(policySaved.error.code);
  let count = 0;
  const input = async (materialIds: string[] = []) => {
    const id = `input-${++count}`,
      source = origin(id);
    const created = await runtime.state('createInput', {
      id,
      commandId: `command-${id}`,
      origin: source,
      evidence: { originalText: 'synthetic' },
      materialIds,
    });
    const controller = new AbortController(),
      authority = { allowed: true };
    const access: RuntimeInputAccess = {
      scope: { kind: 'conversation', audience: source.audience, principalId: source.principalId },
      signal: controller.signal,
      check: async () => {
        if (!authority.allowed) throw new KernelFault('permission-denied');
      },
    };
    return { admission: created.admission, origin: source, access, controller, authority };
  };
  const delivery = async (
    texts: string[],
    accepted: boolean | 'unknown' | 'cleanup-unknown' = true,
    representation: 'inline' | 'document' | 'canonical-document' = 'inline',
  ) => {
    const a = await input();
    const messages: CompanionMessage[] = [];
    const body = texts.join(QQ_REPLY_TEXT_SEPARATOR);
    const document =
      representation === 'inline'
        ? undefined
        : await materials.storeFullText(
            { id: `batch-document-${count}`, text: body, origin: a.origin },
            a.access,
          );
    for (const [index, text] of texts.entries())
      messages.push(
        await runtime.state('appendMessage', {
          id: `output-${count}-${index}`,
          inputId: a.admission.id,
          role: 'assistant',
          text:
            representation === 'canonical-document'
              ? 'EXPLICIT NOTICE STUB MUST NOT BE SPOKEN'
              : text,
          audience: a.origin.audience,
          origins: [a.origin],
          ...(representation === 'canonical-document' && document
            ? { materials: [document], content: { kind: 'text-document', material: document } }
            : {}),
        }),
      );
    if (a.origin.route.kind !== 'qq') throw new Error('No QQ origin route');
    const part: QQDeliveryPart = {
      id: `part-${count}`,
      index: 0,
      requirement: 'mandatory-text',
      content: { kind: 'inline-text', text: body, sha256: hash(body) },
      preparation: 'ready',
      error: null,
      msgSeq: null,
      upload: null,
      send: null,
    };
    let record: QQDeliveryView = {
      id: `delivery-${count}`,
      messageIds: messages.map((m) => m.id),
      origins: [a.origin],
      audience: a.origin.audience,
      route: a.origin.route,
      textRepresentation: 'inline',
      mode: 'onebot',
      eligibilityExpiresAt: null,
      allowedMessageParts: 8,
      phase: 'prepared',
      outcome: 'pending',
      parts: [
        part,
        {
          ...part,
          id: `voice-${count}`,
          index: 1,
          requirement: 'optional-voice',
          content: { kind: 'voice', messageIds: messages.map((m) => m.id), material: null },
          preparation: 'pending',
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: null,
    };
    if (document) {
      const notice = '完整回复见附件。';
      record = {
        ...record,
        textRepresentation: 'text-document',
        parts: [
          { ...part, content: { kind: 'inline-text', text: notice, sha256: hash(notice) } },
          {
            ...part,
            id: `document-${count}`,
            index: 1,
            content: { kind: 'material', material: document },
          },
          {
            ...record.parts[1],
            id: `voice-${count}`,
            index: 2,
            requirement: 'optional-voice',
            content: { kind: 'voice', messageIds: messages.map((m) => m.id), material: null },
            preparation: 'pending',
            error: null,
            msgSeq: null,
            upload: null,
            send: null,
          },
        ],
      };
    }
    record = await runtime.state('createDelivery', { delivery: record });
    if (accepted) {
      for (const target of record.parts.filter((p) => p.requirement === 'mandatory-text')) {
        const documentPart = target.content.kind === 'material',
          slot = documentPart ? 'upload' : 'send';
        const attempt: QQDeliveryAttempt = {
          id: `attempt-${count}-${target.index}`,
          operation: documentPart ? 'upload-and-send' : 'send',
          phase: 'claimed',
          outcome: 'pending',
          correlationId: null,
          receipt: null,
          cleanup: 'pending',
          startedAt: Date.now(),
          settledAt: null,
          error: null,
        };
        await runtime.state('claimDeliveryAttempt', { id: record.id, partId: target.id, attempt });
        record = await runtime.state('getDelivery', { id: record.id, scope: a.access.scope });
        record = await runtime.state('updateDelivery', {
          delivery: {
            ...record,
            phase: 'sending',
            updatedAt: Date.now(),
            parts: record.parts.map((p) =>
              p.id === target.id ? { ...p, [slot]: { ...attempt, phase: 'dispatched' } } : p,
            ),
          },
        });
        record = await runtime.state('updateDelivery', {
          delivery: {
            ...record,
            updatedAt: Date.now(),
            parts: record.parts.map((p) =>
              p.id === target.id
                ? {
                    ...p,
                    [slot]: {
                      ...attempt,
                      phase: 'settled',
                      outcome: accepted === 'unknown' ? 'unknown' : 'accepted',
                      cleanup: accepted === 'cleanup-unknown' ? 'unknown' : 'settled',
                      settledAt: Date.now(),
                      receipt:
                        accepted === 'unknown'
                          ? null
                          : {
                              messageId: documentPart ? null : 'remote-accepted',
                              fileId: documentPart ? 'accepted-document' : null,
                              transferId: null,
                              sequence: null,
                              sequenceAuthoritative: null,
                            },
                    },
                  }
                : p,
            ),
          },
        });
      }
    }
    return { ...a, messages, record, body };
  };
  return {
    controls,
    host,
    runtime,
    voice,
    speech,
    materials,
    audio,
    asr,
    tts,
    input,
    delivery,
    held,
    release,
  };
}

it('decodes real120s into all six actual ASR WAV spans with one frozen provider and preserved original', async () => {
  const f = await fixture();
  await f.host.setEnabled('pet.shared-voice', false);
  const a = await f.input(['recording']);
  const result = await f.audio.transcribe(
    {
      inputId: a.admission.id,
      materialId: 'recording',
      name: 'qq-recording.wav',
      encoded: stream(wave(120)),
    },
    a.access,
  );
  expect(result.transcript).toBe('span-1\nspan-2\nspan-3\nspan-4\nspan-5\nspan-6');
  expect(f.asr.map((call) => call.frames)).toEqual(Array(6).fill(320000));
  expect(f.asr.map((call) => call.frequency)).toEqual([220, 293, 366, 439, 512, 585]);
  expect(f.asr.every((call) => call.authorization === 'Bearer magpie-dsh-pet')).toBe(true);
  expect(result.material.durationMs).toBe(120000);
  expect(f.tts).toEqual([]);
}, 30000);

it.each(['failure', 'source-change', 'codec-disable', 'caller-cancel', 'role-revoke'] as const)(
  'does not publish partial transcript on %s and joins the native source',
  async (mode) => {
    const f = await fixture(mode === 'failure' ? { asrFail: 2 } : { holdAsr: 2 });
    const a = await f.input(['retained']);
    const work = f.audio
      .transcribe(
        {
          inputId: a.admission.id,
          materialId: 'retained',
          name: 'original.wav',
          encoded: stream(wave(60)),
        },
        a.access,
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    if (mode !== 'failure') {
      await Promise.race([
        f.held.promise,
        work.then((error) => {
          if (error) throw error;
        }),
      ]);
      if (mode === 'codec-disable') await f.host.setEnabled(QQ_CODEC_PLUGIN_ID, false);
      else if (mode === 'caller-cancel' || mode === 'role-revoke') {
        if (mode === 'role-revoke') a.authority.allowed = false;
        a.controller.abort();
      } else {
        const view = await f.voice.view();
        await f.voice.saveProvider({
          providerRef: VOICE_ASR_PROVIDER,
          expectedRevision: view.providers[0]?.configRevision,
          settings: view.providers[0]?.settings,
        });
      }
    }
    expect(await work).not.toBe(null);
    expect(f.asr).toHaveLength(2);
    const stored = await f.runtime.state('getMaterial', { id: 'retained', scope: a.access.scope });
    expect(stored.phase).toBe('ready');
  },
  30000,
);

it('refuses over120s before ASR and enforces the real QQ ASR source capability', async () => {
  const f = await fixture();
  const a = await f.input(['oversize']);
  await expect(
    f.audio.transcribe(
      {
        inputId: a.admission.id,
        materialId: 'oversize',
        name: 'long.wav',
        encoded: stream(wave(120 + 1 / 16000)),
      },
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  expect(f.asr).toEqual([]);
  const denied = await fixture({ noAsrGrant: true });
  const b = await denied.input(['denied']);
  await expect(
    denied.audio.transcribe(
      { inputId: b.admission.id, materialId: 'denied', name: 'test.wav', encoded: stream(wave(1)) },
      b.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(denied.asr).toEqual([]);
}, 30000);

it('QQ audio close waits its actual parked encoded input and releases the whole ASR/codec authority', async () => {
  const f = await fixture(),
    a = await f.input(['parked']);
  const entered = deferred(),
    release = deferred();
  const work = f.audio
    .transcribe(
      {
        inputId: a.admission.id,
        materialId: 'parked',
        name: 'original.wav',
        encoded: (async function* () {
          entered.resolve();
          await release.promise;
          yield wave(1);
        })(),
      },
      a.access,
    )
    .then(
      () => null,
      (error: unknown) => error,
    );
  await entered.promise;
  let closed = false;
  const closing = f.audio.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  release.resolve();
  expect(await work).not.toBe(null);
  await closing;
  expect(f.asr).toEqual([]);
  expect(f.host.tasks.diagnostics().pendingWork).toBe(0);
  expect(f.host.permissions.diagnostics().leases).toBe(0);
}, 30000);

it('does not return an over8000-unit combined transcript while retaining the verified recording', async () => {
  const f = await fixture({ asrText: 'x'.repeat(4000) }),
    a = await f.input(['long-transcript']);
  await expect(
    f.audio.transcribe(
      {
        inputId: a.admission.id,
        materialId: 'long-transcript',
        name: 'original.wav',
        encoded: stream(wave(40)),
      },
      a.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  expect(f.asr).toHaveLength(2);
  expect(
    (await f.runtime.state('getMaterial', { id: 'long-transcript', scope: a.access.scope })).phase,
  ).toBe('ready');
}, 30000);

it('gates voice on State accepted text and exports all formal messages through real TTS+SILK without Pet', async () => {
  const f = await fixture();
  await f.host.setEnabled('pet.shared-speech', false);
  const unaccepted = await f.delivery(['not accepted'], false);
  await expect(
    f.audio.exportVoice(
      {
        inputId: unaccepted.admission.id,
        deliveryId: unaccepted.record.id,
        messages: unaccepted.messages,
      },
      unaccepted.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(f.tts).toEqual([]);
  const batch = await f.delivery(['formal say one', 'formal say two']);
  const result = await f.audio.exportVoice(
    { inputId: batch.admission.id, deliveryId: batch.record.id, messages: batch.messages },
    batch.access,
  );
  expect(f.tts.join('')).toBe(batch.body);
  expect(result.kind).toBe('voice');
  expect(result.mediaType).toBe('audio/silk');
  const data = await f.materials.withMaterial(result.id, batch.access, async (_ref, bytes) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of bytes) chunks.push(chunk);
    return Buffer.concat(chunks);
  });
  expect(data.subarray(0, 10)).toEqual(Buffer.from('\x02#!SILK_V3'));
  expect(f.asr).toEqual([]);
}, 30000);

it('rejects missing/order-altered message batches before any TTS', async () => {
  const f = await fixture(),
    batch = await f.delivery(['first', 'second']);
  await expect(
    f.audio.exportVoice(
      {
        inputId: batch.admission.id,
        deliveryId: batch.record.id,
        messages: batch.messages.slice(1),
      },
      batch.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  await expect(
    f.audio.exportVoice(
      {
        inputId: batch.admission.id,
        deliveryId: batch.record.id,
        messages: [...batch.messages].reverse(),
      },
      batch.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(f.tts).toEqual([]);
}, 30000);

it.each(['document', 'canonical-document'] as const)(
  'reads complete %s body and never synthesizes its delivery/canonical notice',
  async (representation) => {
    const f = await fixture();
    const body = '完整正文🌳。'.repeat(700);
    const batch = await f.delivery([body], true, representation);
    const material = await f.audio.exportVoice(
      { inputId: batch.admission.id, deliveryId: batch.record.id, messages: batch.messages },
      batch.access,
    );
    expect(f.tts.join('')).toBe(body);
    expect(f.tts).toHaveLength(2);
    expect(f.tts.join('')).not.toContain('NOTICE STUB');
    expect(material.mediaType).toBe('audio/silk');
  },
  30000,
);

it.each(['unknown', 'cleanup-unknown'] as const)(
  'does zero synthesis after mandatory %s facts',
  async (outcome) => {
    const f = await fixture(),
      batch = await f.delivery(['text'], outcome);
    await expect(
      f.audio.exportVoice(
        { inputId: batch.admission.id, deliveryId: batch.record.id, messages: batch.messages },
        batch.access,
      ),
    ).rejects.toMatchObject({ error: { code: 'permission-denied' } });
    expect(f.tts).toEqual([]);
  },
  30000,
);

it('preserves full accepted document when combined formal text exceeds the M5 synthesis budget', async () => {
  const f = await fixture(),
    batch = await f.delivery(['A'.repeat(4000), 'B'.repeat(4000)], true, 'document');
  await expect(
    f.audio.exportVoice(
      { inputId: batch.admission.id, deliveryId: batch.record.id, messages: batch.messages },
      batch.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'quota-exceeded' } });
  expect(f.tts).toEqual([]);
  expect(
    (await f.runtime.state('getDelivery', { id: batch.record.id, scope: batch.access.scope }))
      .parts[1]?.upload?.outcome,
  ).toBe('accepted');
}, 30000);

it('does not turn native codec non-reusability into settled availability', async () => {
  const f = await fixture();
  f.controls.codecAvailable = false;
  expect(await f.audio.preflightCodec()).toMatchObject({
    source: 'unavailable',
    cleanup: 'unknown',
  });
  expect(f.tts).toEqual([]);
  expect(f.asr).toEqual([]);
}, 30000);

it('does not start synthesis when the actual pinned codec image is absent', async () => {
  const f = await fixture(),
    batch = await f.delivery(['text']);
  const config = await f.host.configs.get({ pluginId: QQ_CODEC_PLUGIN_ID, instanceId: 'default' });
  if (!config.ok) throw new KernelFault(config.error.code);
  const saved = await f.host.configs.save(
    { pluginId: QQ_CODEC_PLUGIN_ID, instanceId: 'default' },
    { ...config.value.data, imageId: `sha256:${'0'.repeat(64)}` },
    config.value.revision,
  );
  if (!saved.ok) throw new KernelFault(saved.error.code);
  await f.host.setEnabled(QQ_CODEC_PLUGIN_ID, false);
  await f.host.setEnabled(QQ_CODEC_PLUGIN_ID, true);
  await expect(
    f.audio.exportVoice(
      { inputId: batch.admission.id, deliveryId: batch.record.id, messages: batch.messages },
      batch.access,
    ),
  ).rejects.toMatchObject({ error: { code: 'not-ready' } });
  expect(f.tts).toEqual([]);
}, 30000);

it('keeps the TTS source frozen through pending codec encoding and waits actual old-owner retirement', async () => {
  const f = await fixture({ holdEncode: true }),
    batch = await f.delivery(['complete text']);
  const work = f.audio
    .exportVoice(
      { inputId: batch.admission.id, deliveryId: batch.record.id, messages: batch.messages },
      batch.access,
    )
    .then(
      () => null,
      (error: unknown) => error,
    );
  await Promise.race([
    f.held.promise,
    work.then((error) => {
      if (error) throw error;
    }),
  ]);
  const view = await f.speech.view();
  let changed = false;
  const change = f.speech
    .saveProvider({
      providerRef: SPEECH_TTS_PROVIDER,
      expectedRevision: view.providers[0]?.configRevision,
      settings: view.providers[0]?.settings,
    })
    .then(() => {
      changed = true;
    });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(changed).toBe(false);
  f.release.resolve();
  expect(await work).not.toBe(null);
  await change;
  const record = await f.runtime.state('getDelivery', {
    id: batch.record.id,
    scope: batch.access.scope,
  });
  expect(record.parts[0]?.send?.outcome).toBe('accepted');
  expect(record.parts[1]?.content.kind === 'voice' && record.parts[1].content.material).toBe(null);
}, 30000);

it.each(['length', 'over120'] as const)(
  'keeps accepted mandatory text when optional voice %s fails',
  async (mode) => {
    const f = await fixture({
      ttsFinish: mode === 'length' ? 'length' : 'stop',
      ttsFrames: mode === 'over120' ? 2_880_001 : 4800,
    });
    const batch = await f.delivery(['mandatory canonical']);
    await expect(
      f.audio.exportVoice(
        { inputId: batch.admission.id, deliveryId: batch.record.id, messages: batch.messages },
        batch.access,
      ),
    ).rejects.toBeDefined();
    const record = await f.runtime.state('getDelivery', {
      id: batch.record.id,
      scope: batch.access.scope,
    });
    expect(record.parts[0]?.send?.outcome).toBe('accepted');
    expect(record.parts[1]?.content.kind === 'voice' && record.parts[1].content.material).toBe(
      null,
    );
  },
  30000,
);
