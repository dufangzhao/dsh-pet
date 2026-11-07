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
  CompanionPluginHost,
  CompanionRuntime,
  companionHostDefinition,
  companionHostManifest,
  COMPANION_HOST_ID,
  createFixturePlugin,
  fixtureManifest,
  type ServicePluginRegistration,
} from '@pet/companion-runtime';
import { createAuthorizedModelClient } from './model-client.js';
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
  readonly client?: ResponseClient;
  readonly name?: string;
  readonly persona?: string;
  readonly onError?: (error: unknown) => void;
}

export interface CompanionService {
  readonly url: string;
  readonly runtime: CompanionRuntime;
  readonly host: CompanionPluginHost;
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
  const root = options.projectRoot ?? fileURLToPath(new URL('../../../', import.meta.url));
  const data = path.resolve(options.dataDirectory);
  const directories = {
    runtime: path.join(root, 'packages/companion-runtime'),
    state: path.join(root, 'plugins/state-sqlite'),
    cloud: path.join(root, 'plugins/cloud-exec'),
    harness: path.join(root, 'plugins/harness-cortico'),
    text: path.join(root, 'plugins/text-client'),
  };
  const [stateManifest, cloudManifest, harnessManifest, textManifest] = await Promise.all([
    manifest(directories.state),
    manifest(directories.cloud),
    manifest(directories.harness),
    manifest(directories.text),
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
  let model: ReturnType<typeof createAuthorizedModelClient> | undefined;
  let modelClient: ResponseClient | undefined = options.client;
  const requireRuntime = (): CompanionRuntime => {
    if (!runtime) throw new KernelFault('not-ready');
    return runtime;
  };
  const mode = options.mode ?? 'scripted';
  const corticoKey = `${harnessManifest.id}/cortico`;
  const fixtureKey = `${fixtureManifest.id}/fixture`;
  const profileOverrides: JsonObject = {};
  if (options.name !== undefined) profileOverrides['name'] = options.name;
  if (options.persona !== undefined) profileOverrides['persona'] = options.persona;
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
      hostCredentials: ['model-api-key'],
      definition: definePlugin({
        async activate(context) {
          const current = requireRuntime();
          const profile = await current.profile();
          if (mode === 'model' && (!modelClient || !options.model))
            throw new KernelFault('not-ready');
          const definition = createCorticoPlugin(
            {
              name: profile.name,
              persona: profile.persona,
              mode,
              ...(options.model ? { model: options.model } : {}),
              ...(options.modelBaseUrl ? { baseUrl: options.modelBaseUrl } : {}),
              ...(modelClient ? { client: modelClient } : {}),
            },
            current.harnessPorts(corticoKey),
          );
          return definition.activate(context);
        },
      }),
    },
    {
      manifest: fixtureManifest,
      directory: directories.runtime,
      preset: 'allow',
      enabled: false,
      definition: definePlugin({
        activate(context) {
          return createFixturePlugin(requireRuntime().harnessPorts(fixtureKey)).activate(context);
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
  ];
  try {
    host = await CompanionPluginHost.create({
      dataDirectory: data,
      plugins: registrations,
      changed: () => runtime?.notify(),
    });
    if (mode === 'model' && !modelClient && options.modelApiKey && options.modelBaseUrl) {
      model = createAuthorizedModelClient(host, harnessManifest.id, {
        apiKey: options.modelApiKey,
        baseUrl: options.modelBaseUrl,
      });
      modelClient = model.client;
    }
    const execution = await host.configs.get({ pluginId: cloudManifest.id, instanceId: 'default' });
    if (!execution.ok) throw new KernelFault(execution.error.code);
    const executionConfig = parseExecutionConfig(execution.value.data);
    if (!executionConfig.ok) throw new KernelFault(executionConfig.error.code);
    runtime = new CompanionRuntime(host, {
      mode,
      statePluginId: stateManifest.id,
      stateProviderId: 'sqlite',
      executionPluginId: cloudManifest.id,
      executionProviderId: 'docker',
      executionTimeoutMs: executionConfig.value.timeoutMs,
    });
    await runtime.initialize();
    http = await serveText({
      runtime,
      host,
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
    let closing: Promise<void> | undefined;
    return {
      url: http.url,
      host,
      runtime,
      close() {
        return (closing ??= (async () => {
          await activeHttp.close();
          try {
            await activeRuntime.close();
          } finally {
            try {
              await model?.close();
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
      await model?.close();
      await host?.close();
    }
    throw error;
  }
}
