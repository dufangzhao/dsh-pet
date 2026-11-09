import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonObject, PluginManifest } from '@pet/contracts';
import { validateManifest } from '@pet/contracts/validation';
import { FileConfigStore, KernelFault } from '@pet/host-kernel';
import { definePlugin } from '@pet/plugin-sdk';
import stateDefinition from '@pet/state-sqlite';
import cloudDefinition, { parseConfig as parseExecutionConfig } from '@pet/cloud-exec';
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
import { ModelConnectionController } from './model-controller.js';
import { serveText, type TextService } from './server.js';

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
  readonly name?: string;
  readonly persona?: string;
  readonly onError?: (error: unknown) => void;
}
export interface CompanionService {
  readonly url: string;
  readonly runtime: CompanionRuntime;
  readonly host: CompanionPluginHost;
  readonly models: ModelConnectionController;
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
  };
  const [stateManifest, cloudManifest, harnessManifest, textManifest, magpieManifest] =
    await Promise.all([
      manifest(directories.state),
      manifest(directories.cloud),
      manifest(directories.harness),
      manifest(directories.text),
      manifest(directories.magpie),
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
    ...(options.connectionPlugins ?? []).map((create) => create(portsFor)),
  ];
  const registrations: ServicePluginRegistration[] = [
    {
      manifest: companionHostManifest,
      directory: directories.runtime,
      definition: companionHostDefinition,
      preset: 'allow',
      enabled: true,
      protected: true,
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
      definition: cloudDefinition,
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
      profileOverrides: {
        name: options.name !== undefined,
        persona: options.persona !== undefined,
      },
    });
    models = new ModelConnectionController(host, runtime, connections);
    runtime.setModelControls(models);
    if (options.modelApiKey && options.modelBaseUrl)
      await models.seedEnvironment(MAGPIE_CONNECTION, options.modelApiKey, options.modelBaseUrl);
    await models.initialize();
    await runtime.initialize();
    http = await serveText({
      runtime,
      host,
      models,
      token: options.token,
      clientPluginId: textManifest.id,
      clientDirectory: path.join(directories.text, 'dist'),
      artifactRoots: new Map([
        [cloudManifest.id, path.join(data, 'plugin-data', cloudManifest.id, 'jobs')],
      ]),
      ...(options.hostname ? { hostname: options.hostname } : {}),
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    });
    const activeHost = host;
    const activeRuntime = runtime;
    const activeHttp = http;
    const activeModels = models;
    let closing: Promise<void> | undefined;
    return {
      url: http.url,
      host,
      runtime,
      models,
      close() {
        return (closing ??= (async () => {
          await activeHttp.close();
          try {
            await activeRuntime.close();
          } finally {
            try {
              await activeModels.close();
            } finally {
              await activeHost.close();
            }
          }
        })());
      },
    };
  } catch (error) {
    await http?.close();
    try {
      await runtime?.close();
    } finally {
      await models?.close();
      await host?.close();
    }
    throw error;
  }
}
