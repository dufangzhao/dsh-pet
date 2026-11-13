import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeError,
  QQ_CODEC_PLUGIN_ID,
  QQ_OFFICIAL_PLUGIN_ID,
  QQ_ONEBOT_PLUGIN_ID,
  type JsonObject,
  type PluginManifest,
  type QQInputReceipt,
  type KernelError,
} from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import { FileConfigStore, KernelFault } from '@pet/host-kernel';
import { definePlugin } from '@pet/plugin-sdk';
import stateDefinition from '@pet/state-sqlite';
import { createCloudExecPlugin, parseConfig as parseExecutionConfig } from '@pet/cloud-exec';
import textDefinition from '@pet/text-client';
import { createCorticoPlugin, type ResponseClient } from '@pet/harness-cortico';
import {
  createMagpieConnectionPlugin,
  createMagpieNativeProvider,
  describeMagpieConfig,
} from '@pet/model-connection-magpie';
import {
  CompanionPluginHost,
  CompanionRuntime,
  companionHostDefinition,
  companionHostManifest,
  COMPANION_HOST_ID,
  createFixturePlugin,
  fixtureManifest,
  createFixtureModelPlugin,
  describeFixtureModel,
  fixtureModelManifest,
  FIXTURE_MODEL_CONNECTION,
  MAGPIE_CONNECTION,
  type ModelConnectionPortsFor,
  type ModelConnectionRegistration,
  type ServicePluginRegistration,
} from '@pet/companion-runtime';
import { createMagpieAsrPlugin, parseMagpieAsrSettings } from '@pet/asr-magpie';
import { createSharedVoicePlugin } from '@pet/shared-voice';
import { type VoiceAsrRegistration, type VoiceAsrPortsFor } from '@pet/companion-runtime';
import { ModelConnectionController } from './model-controller.js';
import { VoiceController } from './voice-controller.js';
import { createMagpieSpeechPlugin, parseMagpieSpeechSettings } from '@pet/tts-magpie';
import { createSharedSpeechPlugin } from '@pet/shared-speech';
import type { SpeechTtsRegistration, SpeechTtsPortsFor } from '@pet/companion-runtime';
import { SpeechController } from './speech-controller.js';
import { serveText, type TextService } from './server.js';
import { createSharedQQPlugin } from '@pet/shared-qq';
import { createOfficialQqPlugin } from '@pet/qq-official';
import { createOneBotQqPlugin } from '@pet/qq-onebot';
import {
  createQqMediaCodecPlugin,
  parseCodecConfig,
  type CodecImagePin,
} from '@pet/qq-media-codec';
import { createMagpieConnectionPlugin as createQQJudgePlugin } from '@pet/qq-participation-magpie';
import { QQController, type QQControllerOptions } from './qq-controller.js';
import { QQIngress } from './qq-ingress.js';
import { QQJudgeController } from './qq-judge.js';
import { createQQJudgeNativeProvider } from './qq-judge-native.mjs';
import { QQAudio } from './qq-audio.js';
import { createMaterialStore, type HostMaterialStore } from './material-store.js';
import { createReplyMaterialResolver } from './reply-materials.js';
import { qqGroupSettings } from './qq-policy.js';
import { createQQMediaTransfer, type QQMediaTransfer } from './qq-media-transfer.js';
import { QQDeliveryController } from './qq-delivery.js';
import { createQQDeliverySource } from './qq-delivery-transport.js';

export interface CompanionServiceOptions {
  readonly dataDirectory: string;
  readonly token: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly publicOrigin?: string;
  readonly projectRoot?: string;
  readonly image?: string;
  readonly mode?: 'scripted' | 'model';
  readonly model?: string;
  readonly modelBaseUrl?: string;
  readonly modelApiKey?: string;
  /** Explicit synthetic composition seam, not proof of a live model connection. */
  readonly client?: ResponseClient;
  readonly connectionPlugins?: readonly ((
    portsFor: ModelConnectionPortsFor,
  ) => ModelConnectionRegistration)[];
  readonly voicePlugins?: readonly ((portsFor: VoiceAsrPortsFor) => VoiceAsrRegistration)[];
  readonly speechPlugins?: readonly ((portsFor: SpeechTtsPortsFor) => SpeechTtsRegistration)[];
  /** Host-only controlled composition seams; these are not Web configuration fields. */
  readonly qqController?: QQControllerOptions;
  readonly codecPin?: CodecImagePin;
  readonly onQQInputReceipt?: (receipt: QQInputReceipt) => void;
  readonly name?: string;
  readonly persona?: string;
  readonly onError?: (error: unknown) => void;
}
export interface CompanionService {
  readonly url: string;
  readonly runtime: CompanionRuntime;
  readonly host: CompanionPluginHost;
  readonly models: ModelConnectionController;
  readonly voice: VoiceController;
  readonly speech: SpeechController;
  readonly qq: QQController;
  readonly ingress: QQIngress;
  readonly audio: QQAudio;
  readonly materials: HostMaterialStore;
  readonly delivery: QQDeliveryController;
  close(): Promise<void>;
}
async function manifest(directory: string): Promise<PluginManifest> {
  const value: unknown = JSON.parse(await readFile(path.join(directory, 'plugin.json'), 'utf8'));
  const result = validateManifest(value);
  if (!result.ok) throw new KernelFault(result.error.code);
  return result.value;
}

export async function createCompanionService(
  options: CompanionServiceOptions,
): Promise<CompanionService> {
  if (options.modelApiKey !== undefined && !options.modelBaseUrl)
    throw new KernelFault('invalid-input');
  const root = options.projectRoot ?? fileURLToPath(new URL('../../../', import.meta.url));
  const data = path.resolve(options.dataDirectory);
  const directories = {
    runtime: path.join(root, 'packages/companion-runtime'),
    state: path.join(root, 'plugins/state-sqlite'),
    cloud: path.join(root, 'plugins/cloud-exec'),
    harness: path.join(root, 'plugins/harness-cortico'),
    text: path.join(root, 'plugins/text-client'),
    magpie: path.join(root, 'plugins/model-connection-magpie'),
    voice: path.join(root, 'plugins/shared-voice'),
    asr: path.join(root, 'plugins/asr-magpie'),
    speech: path.join(root, 'plugins/shared-speech'),
    tts: path.join(root, 'plugins/tts-magpie'),
    qq: path.join(root, 'plugins/shared-qq'),
    qqOfficial: path.join(root, 'plugins/qq-official'),
    qqOnebot: path.join(root, 'plugins/qq-onebot'),
    qqJudge: path.join(root, 'plugins/qq-participation-magpie'),
    qqCodec: path.join(root, 'plugins/qq-media-codec'),
  };
  const [
    stateManifest,
    cloudManifest,
    harnessManifest,
    textManifest,
    magpieManifest,
    voiceManifest,
    asrManifest,
    speechManifest,
    ttsManifest,
    qqManifest,
    qqOfficialManifest,
    qqOnebotManifest,
    qqJudgeManifest,
    qqCodecManifest,
  ] = await Promise.all([
    manifest(directories.state),
    manifest(directories.cloud),
    manifest(directories.harness),
    manifest(directories.text),
    manifest(directories.magpie),
    manifest(directories.voice),
    manifest(directories.asr),
    manifest(directories.speech),
    manifest(directories.tts),
    manifest(directories.qq),
    manifest(directories.qqOfficial),
    manifest(directories.qqOnebot),
    manifest(directories.qqJudge),
    manifest(directories.qqCodec),
  ]);
  const rawCodecLock: unknown = JSON.parse(
    await readFile(path.join(directories.qqCodec, 'codec-image.lock.json'), 'utf8'),
  );
  if (!rawCodecLock || typeof rawCodecLock !== 'object' || Array.isArray(rawCodecLock))
    throw new KernelFault('invalid-input');
  const codecLock = rawCodecLock as Record<string, unknown>;
  const codecPin = parseCodecConfig({
    imageId: String(codecLock['imageId']),
    manifestSha256: String(codecLock['manifestSha256']),
  });
  const hostDataDirectory = path.join(data, 'plugin-data', COMPANION_HOST_ID);
  const artifactRoots = new Map([
    [cloudManifest.id, path.join(data, 'plugin-data', cloudManifest.id, 'jobs')],
  ]);
  const configRoot = path.join(data, 'configuration');
  await mkdir(configRoot, { recursive: true, mode: 0o700 });
  const configStore = new FileConfigStore(configRoot);
  const savedProfile = await configStore.read({
    pluginId: COMPANION_HOST_ID,
    instanceId: 'default',
  });
  const savedDisabled = savedProfile ? savedProfile.data['disabledPlugins'] : [];
  if (
    !Array.isArray(savedDisabled) ||
    !savedDisabled.every((id): id is string => typeof id === 'string') ||
    (savedProfile && savedProfile.schemaVersion !== companionHostManifest.config?.version)
  )
    throw new KernelFault('not-ready');
  const disabled = new Set(savedDisabled);
  const savedExecution = await configStore.read({
    pluginId: cloudManifest.id,
    instanceId: 'default',
  });
  const savedImage = savedExecution?.data['image'];
  if (
    savedExecution?.data['workspaceDirectory'] !== undefined &&
    savedExecution.data['workspaceDirectory'] !== 'jobs'
  )
    throw new KernelFault('conflict');
  const executionEnabled =
    !disabled.has(cloudManifest.id) &&
    Boolean(
      options.image ??
      (typeof savedImage === 'string' && savedImage !== 'unconfigured' ? savedImage : undefined),
    );
  let runtime: CompanionRuntime | undefined;
  let host: CompanionPluginHost | undefined;
  let http: TextService | undefined;
  let models: ModelConnectionController | undefined;
  let voice: VoiceController | undefined;
  let speech: SpeechController | undefined;
  let qq: QQController | undefined;
  let judge: QQJudgeController | undefined;
  let ingress: QQIngress | undefined;
  let audio: QQAudio | undefined;
  let materials: HostMaterialStore | undefined;
  let mediaTransfer: QQMediaTransfer | undefined;
  let delivery: QQDeliveryController | undefined;
  let offTerminal: (() => void) | undefined;
  const cleanup = async (): Promise<void> => {
    let failure: unknown;
    for (const close of [
      () => offTerminal?.(),
      () => http?.close(),
      () => ingress?.close(),
      () => delivery?.close(),
      () => mediaTransfer?.close(),
      () => audio?.close(),
      () => qq?.close(),
      () => judge?.close(),
      () => speech?.close(),
      () => voice?.close(),
      () => runtime?.close(),
      () => materials?.close(),
      () => models?.close(),
      () => host?.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  };
  const requireQQ = (): QQController => {
    if (!qq) throw new KernelFault('not-ready');
    return qq;
  };
  const requireJudge = (): QQJudgeController => {
    if (!judge) throw new KernelFault('not-ready');
    return judge;
  };
  const requireAudio = (): QQAudio => {
    if (!audio) throw new KernelFault('not-ready');
    return audio;
  };
  const requireSpeech = (): SpeechController => {
    if (!speech) throw new KernelFault('not-ready');
    return speech;
  };
  const requireVoice = (): VoiceController => {
    if (!voice) throw new KernelFault('not-ready');
    return voice;
  };
  const requireRuntime = (): CompanionRuntime => {
    if (!runtime) throw new KernelFault('not-ready');
    return runtime;
  };
  const requireModels = (): ModelConnectionController => {
    if (!models) throw new KernelFault('not-ready');
    return models;
  };
  const portsFor: ModelConnectionPortsFor = (context) =>
    requireModels().connections.portsFor(context);
  const corticoKey = `${harnessManifest.id}/cortico`;
  const fixtureKey = `${fixtureManifest.id}/fixture`;
  const profileOverrides: JsonObject = {};
  if (options.name !== undefined) profileOverrides['name'] = options.name;
  if (options.persona !== undefined) profileOverrides['persona'] = options.persona;
  if (options.mode !== undefined) profileOverrides['modelMode'] = options.mode;
  if (options.client) profileOverrides['modelConnection'] = FIXTURE_MODEL_CONNECTION;
  const magpieOverrides: JsonObject = {};
  if (options.model !== undefined) magpieOverrides['model'] = options.model;
  if (options.modelBaseUrl !== undefined) {
    magpieOverrides['baseUrl'] = options.modelBaseUrl;
    let endpoint: URL;
    try {
      endpoint = new URL(options.modelBaseUrl);
    } catch {
      throw new KernelFault('invalid-input');
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
      magpieOverrides['authMode'] = 'gateway-key';
  }
  if (options.modelApiKey !== undefined) magpieOverrides['authMode'] = 'gateway-key';
  const fixtureModel = options.model ?? 'connection-fixture';
  const connections: ModelConnectionRegistration[] = [
    {
      manifest: magpieManifest,
      directory: directories.magpie,
      preset: 'allow',
      enabled: false,
      hostCredentials: ['model-api-key'],
      definition: createMagpieConnectionPlugin(portsFor),
      connection: {
        providerId: 'magpie',
        describeConfig: describeMagpieConfig,
        nativeProvider: createMagpieNativeProvider,
      },
      ...(Object.keys(magpieOverrides).length ? { config: magpieOverrides } : {}),
    },
    {
      manifest: fixtureModelManifest,
      directory: directories.runtime,
      preset: 'allow',
      enabled: false,
      definition: createFixtureModelPlugin(portsFor, options.client, fixtureModel),
      connection: {
        providerId: 'fixture',
        describeConfig: (config) => describeFixtureModel(config, fixtureModel),
      },
    },
    {
      manifest: qqJudgeManifest,
      directory: directories.qqJudge,
      preset: 'allow',
      enabled: false,
      hostCredentials: ['model-api-key'],
      definition: createQQJudgePlugin(portsFor),
      connection: {
        providerId: 'magpie',
        purpose: 'qq-participation',
        describeConfig: describeMagpieConfig,
        nativeProvider: createQQJudgeNativeProvider,
      },
    },
    ...(options.connectionPlugins ?? []).map((create) => create(portsFor)),
  ];
  const asrPortsFor: VoiceAsrPortsFor = (context) => requireVoice().providers.portsFor(context);
  const asrRegistrations: VoiceAsrRegistration[] = [
    {
      manifest: asrManifest,
      directory: directories.asr,
      preset: 'allow',
      enabled: !disabled.has(asrManifest.id),
      hostCredentials: ['asr-api-key'],
      definition: createMagpieAsrPlugin(asrPortsFor),
      asr: {
        providerId: 'magpie',
        label: 'Magpie',
        synthetic: false,
        parseConfig: parseMagpieAsrSettings,
      },
    },
    ...(options.voicePlugins ?? []).map((create) => create(asrPortsFor)),
  ];
  const speechPortsFor: SpeechTtsPortsFor = (context) =>
    requireSpeech().providers.portsFor(context);
  const speechRegistrations: SpeechTtsRegistration[] = [
    {
      manifest: ttsManifest,
      directory: directories.tts,
      preset: 'allow',
      enabled: !disabled.has(ttsManifest.id),
      hostCredentials: ['tts-api-key'],
      definition: createMagpieSpeechPlugin(speechPortsFor),
      tts: {
        providerId: 'magpie',
        label: 'Magpie',
        synthetic: false,
        parseConfig: parseMagpieSpeechSettings,
      },
    },
    ...(options.speechPlugins ?? []).map((create) => create(speechPortsFor)),
  ];
  const registrations: ServicePluginRegistration[] = [
    {
      manifest: companionHostManifest,
      directory: directories.runtime,
      definition: companionHostDefinition,
      preset: 'allow',
      enabled: true,
      protected: true,
      dataDirectory: hostDataDirectory,
      ...(Object.keys(profileOverrides).length ? { config: profileOverrides } : {}),
    },
    {
      manifest: stateManifest,
      directory: directories.state,
      definition: stateDefinition,
      preset: 'allow',
      enabled: !disabled.has(stateManifest.id),
      dataDirectory: path.join(data, 'state'),
    },
    {
      manifest: cloudManifest,
      directory: directories.cloud,
      definition: createCloudExecPlugin({
        readMaterial: (request, consume) => requireRuntime().readWorkMaterial(request, consume),
      }),
      preset: 'allow',
      enabled: executionEnabled,
      initialConfig: { image: 'unconfigured', workspaceDirectory: 'jobs' },
      ...(options.image !== undefined ? { config: { image: options.image } } : {}),
      dataDirectory: path.join(data, 'plugin-data', cloudManifest.id),
    },
    {
      manifest: harnessManifest,
      directory: directories.harness,
      preset: 'allow',
      enabled: false,
      definition: definePlugin({
        async activate(context) {
          const current = requireRuntime();
          const profile = await current.profile();
          const foreground = await requireModels().foreground(context.owner);
          return createCorticoPlugin(
            {
              name: profile.name,
              persona: profile.persona,
              profileRevision: profile.revision,
              ...foreground,
            },
            current.harnessPorts(corticoKey, profile),
          ).activate(context);
        },
      }),
    },
    {
      manifest: fixtureManifest,
      directory: directories.runtime,
      preset: 'allow',
      enabled: false,
      definition: definePlugin({
        async activate(context) {
          const current = requireRuntime();
          return createFixturePlugin(
            current.harnessPorts(fixtureKey, await current.profile()),
          ).activate(context);
        },
      }),
    },
    {
      manifest: textManifest,
      directory: directories.text,
      definition: textDefinition,
      preset: 'allow',
      enabled: !disabled.has(textManifest.id),
    },
    ...connections,
    {
      manifest: qqManifest,
      directory: directories.qq,
      preset: 'allow',
      enabled: false,
      definition: createSharedQQPlugin((context) => requireQQ().featurePorts(context)),
    },
    {
      manifest: qqOfficialManifest,
      directory: directories.qqOfficial,
      preset: 'allow',
      enabled: false,
      hostCredentials: ['qq-official-app-secret'],
      definition: definePlugin({
        async activate(context) {
          const controller = requireQQ();
          await controller.prepareSource(context);
          return createOfficialQqPlugin((source) => controller.officialPorts(source)).activate(
            context,
          );
        },
      }),
    },
    {
      manifest: qqOnebotManifest,
      directory: directories.qqOnebot,
      preset: 'allow',
      enabled: false,
      hostCredentials: ['qq-onebot-access-token'],
      definition: definePlugin({
        async activate(context) {
          const controller = requireQQ();
          await controller.prepareSource(context);
          return createOneBotQqPlugin((source) => controller.onebotPorts(source)).activate(context);
        },
      }),
    },
    {
      manifest: qqCodecManifest,
      directory: directories.qqCodec,
      preset: 'allow',
      enabled: false,
      initialConfig: { imageId: codecPin.imageId, manifestSha256: codecPin.manifestSha256 },
      ...(options.codecPin
        ? {
            config: {
              imageId: options.codecPin.imageId,
              manifestSha256: options.codecPin.manifestSha256,
            },
          }
        : {}),
      definition: createQqMediaCodecPlugin((context) => requireAudio().codecPorts(context)),
    },
    {
      manifest: voiceManifest,
      directory: directories.voice,
      preset: 'allow',
      enabled: false,
      definition: createSharedVoicePlugin((context) => requireVoice().featurePorts(context)),
    },
    {
      manifest: speechManifest,
      directory: directories.speech,
      preset: 'allow',
      enabled: false,
      definition: createSharedSpeechPlugin((context) => requireSpeech().featurePorts(context)),
    },
    ...speechRegistrations.map((registration) => ({
      ...registration,
      enabled: false,
      definition: definePlugin({
        async activate(context) {
          await requireSpeech().providerPorts(context);
          return registration.definition.activate(context);
        },
      }),
    })),
    ...asrRegistrations.map((registration) => ({
      ...registration,
      enabled: false,
      definition: definePlugin({
        async activate(context) {
          await requireVoice().providerPorts(context);
          return registration.definition.activate(context);
        },
      }),
    })),
  ];
  try {
    host = await CompanionPluginHost.create({
      dataDirectory: data,
      plugins: registrations,
      changed: () => runtime?.notify(),
    });
    const execution = await host.configs.get({ pluginId: cloudManifest.id, instanceId: 'default' });
    if (!execution.ok) throw new KernelFault(execution.error.code);
    const executionConfig = parseExecutionConfig(execution.value.data);
    if (!executionConfig.ok) throw new KernelFault(executionConfig.error.code);
    const profile = await host.configs.get({ pluginId: COMPANION_HOST_ID, instanceId: 'default' });
    if (!profile.ok) throw new KernelFault(profile.error.code);
    runtime = new CompanionRuntime(host, {
      mode: profile.value.data['modelMode'] === 'model' ? 'model' : 'scripted',
      statePluginId: stateManifest.id,
      stateProviderId: 'sqlite',
      executionPluginId: cloudManifest.id,
      executionProviderId: 'docker',
      executionTimeoutMs: executionConfig.value.timeoutMs,
      optionalPluginIds: [QQ_OFFICIAL_PLUGIN_ID, QQ_ONEBOT_PLUGIN_ID],
      profileOverrides: {
        name: options.name !== undefined,
        persona: options.persona !== undefined,
      },
    });
    models = new ModelConnectionController(host, runtime, connections, (owner, baseUrl) =>
      requireJudge().transport(owner, baseUrl),
    );
    runtime.setModelControls(models);
    if (options.modelApiKey && options.modelBaseUrl)
      await models.seedEnvironment(MAGPIE_CONNECTION, options.modelApiKey, options.modelBaseUrl);
    await models.initialize();
    await runtime.initialize();
    voice = new VoiceController(host, runtime, asrRegistrations);
    await voice.initialize();
    speech = new SpeechController(host, runtime, speechRegistrations);
    await speech.initialize();
    materials = await createMaterialStore({ directory: hostDataDirectory, host, state: runtime });
    speech.setCanonicalTextResolver(materials.resolvePetCanonicalText);
    audio = new QQAudio({ host, runtime, voice, speech, materials });
    qq = new QQController(host, runtime, models.connections, options.qqController);
    judge = new QQJudgeController(host, runtime, models.connections, qq.judgePolicyPorts());
    qq.setJudge(judge);
    mediaTransfer = createQQMediaTransfer({ host, runtime, qq, materials, audio });
    ingress = new QQIngress(host, runtime, qq, {
      judge,
      prepareMedia: mediaTransfer.prepareInput,
      ...(options.onQQInputReceipt ? { onReceipt: options.onQQInputReceipt } : {}),
    });
    qq.setIngress(ingress.handlers);
    qq.setCodecStatusProvider(() => requireAudio().codecStatus());
    const activeMaterials = materials;
    const activeQQ = qq;
    const activeIngress = ingress;
    runtime.setInputPorts({
      resolveInput: activeMaterials.resolveInput,
      storeFullText: activeMaterials.storeFullText,
      grantForWorkResult: (origin) => activeIngress.grantForWorkResult(origin),
      conversationWindow: (origin) => {
        const audience = origin.audience;
        if (audience.kind !== 'qq-group') throw new KernelFault('invalid-input');
        const group = qqGroupSettings(
          activeQQ.policy().settings,
          audience.account,
          audience.groupId,
        );
        return { maxMessages: group.contextMessages, maxAgeMs: group.contextMaxAgeMs };
      },
      prepareWork: mediaTransfer.prepareWork,
      readWorkMaterial: async (request, access, consume) => {
        try {
          await activeMaterials.withMaterial(
            request.selection.materialId,
            access,
            async (reference, chunks) => {
              await consume({
                sizeBytes: reference.sizeBytes,
                sha256: reference.sha256,
                chunks,
                check: () => access.check(),
              });
            },
          );
          return { ok: true, value: null };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof KernelFault ? error.error : makeError('internal', false),
          };
        }
      },
      resolveReplyAttachment: createReplyMaterialResolver({
        host,
        runtime,
        materials,
        artifactRoots,
      }),
    });
    delivery = new QQDeliveryController({
      host,
      runtime,
      materials,
      audio,
      policy: async () => activeQQ.policy(),
      sourceFor: (account) => createQQDeliverySource(activeQQ.sourceFor(account)),
      allowOfficialProactive: async (grant) => {
        if (grant.origin.kind !== 'qq-proactive' || grant.origin.audience.kind !== 'qq-group')
          return false;
        await grant.check();
        const audience = grant.origin.audience;
        return qqGroupSettings(activeQQ.policy().settings, audience.account, audience.groupId)
          .proactive.enabled;
      },
      ...(options.onError ? { onError: (error: KernelError) => options.onError?.(error) } : {}),
    });
    const activeDelivery = delivery;
    offTerminal = runtime.onInputTerminal((event) => activeDelivery.enqueue(event));
    await qq.initialize();
    await judge.initialize();
    runtime.setQQStatusProvider(() => activeQQ.status());
    if (!disabled.has(QQ_CODEC_PLUGIN_ID)) await host.setEnabled(QQ_CODEC_PLUGIN_ID, true);
    http = await serveText({
      runtime,
      host,
      models,
      voice,
      speech,
      qq,
      materials,
      token: options.token,
      clientPluginId: textManifest.id,
      clientDirectory: path.join(directories.text, 'dist'),
      artifactRoots,
      ...(options.hostname ? { hostname: options.hostname } : {}),
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    });
    let closing: Promise<void> | undefined;
    return {
      url: http.url,
      host,
      runtime,
      models,
      voice,
      speech,
      qq,
      ingress,
      audio,
      materials,
      delivery,
      close() {
        return (closing ??= cleanup());
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
