import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  makeError,
  type CompanionPluginView,
  type JsonObject,
  type JsonValue,
  type OwnerRef,
  type PlatformTarget,
  type PluginManifest,
  type Result,
} from '@pet/contracts';
import {
  capabilityPermissionAuthorizer,
  ConfigService,
  CordisRuntimeDriver,
  createPermissionKernel,
  createRuntimeHostPort,
  presetDecision,
  FileConfigStore,
  KernelFault,
  PluginManager,
  TaskSupervisor,
  type CapabilityAuthorizer,
  type PermissionControl,
  type PermissionPreset,
  type PermissionService,
  type RuntimeHostPort,
  type TaskHandle,
} from '@pet/host-kernel';
import type { PluginConfigSnapshot, PluginDefinition, PluginHostPort } from '@pet/plugin-sdk';
import { createPluginHostServices } from '@pet/plugin-sdk/host';

export interface ServicePluginRegistration {
  readonly manifest: PluginManifest;
  readonly directory: string;
  readonly definition: PluginDefinition;
  /** Explicit operator-selected grant for this known local package. */
  readonly preset: PermissionPreset;
  readonly enabled: boolean;
  readonly config?: JsonObject;
  /** Assigned by the service composition, never by a model or browser command. */
  readonly dataDirectory?: string;
  readonly protected?: boolean;
  /** Keys supported by a private host-provisioned transport, not a generic SDK secret API. */
  readonly hostCredentials?: readonly string[];
  readonly initialConfig?: JsonObject;
}

export const COMPANION_HOST_ID = 'pet.companion-host';
const identity = (pluginId: string) => ({ pluginId, instanceId: 'default' });

/** Pin the actual local package, including source-mode and built entry files. */
export function packageFingerprint(directory: string): string {
  const root = realpathSync(directory);
  const hash = createHash('sha256');
  let bytes = 0;
  let count = 0;
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      if (['node_modules', '.git', 'coverage'].includes(name)) continue;
      const file = path.join(current, name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new KernelFault('package-changed');
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        bytes += stat.size;
        count++;
        if (bytes > 32 * 1024 * 1024 || count > 4096) throw new KernelFault('quota-exceeded');
        hash.update(path.relative(root, file).replaceAll(path.sep, '/'));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
      }
    }
  };
  walk(root);
  return hash.digest('hex');
}

interface Source {
  readonly registration: ServicePluginRegistration;
  readonly fingerprint: string;
}

export interface ConfigurationCommit {
  readonly pluginId: string;
  readonly instanceId: string;
  readonly revision: number;
}
type ConfigurationObserver = (commit: ConfigurationCommit) => void;

export class CompanionPluginHost {
  private readonly handles = new Set<TaskHandle>();
  private closed = false;

  private constructor(
    readonly manager: PluginManager,
    readonly tasks: TaskSupervisor,
    readonly configs: ConfigService,
    readonly permissions: PermissionService,
    readonly permissionControl: PermissionControl,
    private readonly driver: CordisRuntimeDriver,
    private readonly sources: ReadonlyMap<string, Source>,
    private readonly authorize: CapabilityAuthorizer,
    private readonly changed: () => void,
    private readonly observedResults: Map<string, (value: JsonValue) => void>,
    private readonly configurationObservers: Set<ConfigurationObserver>,
    private readonly configurationFaults: { observers: number },
  ) {}

  static async create(options: {
    dataDirectory: string;
    plugins: readonly ServicePluginRegistration[];
    changed?: () => void;
  }): Promise<CompanionPluginHost> {
    const dataRoot = path.resolve(options.dataDirectory);
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const sources = new Map<string, Source>();
    for (const registration of options.plugins) {
      if (sources.has(registration.manifest.id)) throw new KernelFault('invalid-input');
      sources.set(registration.manifest.id, {
        registration,
        fingerprint: packageFingerprint(registration.directory),
      });
    }
    const ref: {
      manager?: PluginManager;
      tasks?: TaskSupervisor;
      hostPort?: RuntimeHostPort;
    } = {};
    const sourceFor = (id: string): Source => {
      const source = sources.get(id);
      if (!source) throw new KernelFault('not-ready');
      return source;
    };
    const fingerprint = (id: string): string | null => {
      const source = sources.get(id);
      if (!source) return null;
      try {
        return packageFingerprint(source.registration.directory);
      } catch {
        return null;
      }
    };
    const configurationRoot = path.join(dataRoot, 'configuration');
    await mkdir(configurationRoot, { recursive: true, mode: 0o700 });
    const configurationObservers = new Set<ConfigurationObserver>();
    const configurationFaults = { observers: 0 };
    const configs = new (class extends ConfigService {
      override async save(
        ...args: Parameters<ConfigService['save']>
      ): ReturnType<ConfigService['save']> {
        const saved = await super.save(...args);
        if (saved.ok) {
          const { pluginId, instanceId, revision } = saved.value.snapshot;
          for (const observer of configurationObservers) {
            try {
              observer({ pluginId, instanceId, revision });
            } catch {
              configurationFaults.observers++;
            }
          }
          if (saved.value.changeMode !== null && options.changed) {
            try {
              options.changed();
            } catch {
              configurationFaults.observers++;
            }
          }
        }
        // Observation cannot turn an already committed CAS into a reported write failure.
        // Observers fence only; asynchronous physical drain stays in the owning disposer/task.
        return saved;
      }
    })(new FileConfigStore(configurationRoot), (owner) => ref.manager?.isLive(owner) === true);
    const permission = createPermissionKernel({
      host: {
        fingerprint: (id) => fingerprint(id.pluginId),
        describe: (owner) => {
          const entry = ref.manager?.get(owner);
          const source = sources.get(owner.pluginId);
          return entry && source && entry.owner.generation === owner.generation
            ? { manifest: entry.manifest, digest: source.fingerprint }
            : null;
        },
        isLive: (owner) => ref.manager?.isLive(owner) === true,
        ownerSignal: (owner) => ref.manager?.ownerSignal(owner) ?? null,
        taskSignal: (id, owner) => ref.tasks?.taskSignal(id, owner) ?? null,
      },
    });
    const callPort = (): RuntimeHostPort => {
      if (!ref.hostPort) throw new KernelFault('not-ready');
      return ref.hostPort;
    };
    const sdkPort: PluginHostPort = {
      getConfig: async (owner) =>
        (await callPort().request(owner, 'config.get', null, {
          owner,
          requestId: randomUUID(),
          taskId: undefined,
          budgetMs: null,
          signal: ref.manager?.ownerSignal(owner) ?? AbortSignal.abort(),
        })) as Result<PluginConfigSnapshot>,
      saveConfig: async (owner, task, data, expectedRevision) =>
        (await callPort().request(
          owner,
          'config.save',
          { data, expectedRevision },
          {
            owner,
            requestId: randomUUID(),
            budgetMs: 30000,
            taskId: task.taskId,
            signal: task.signal,
          },
        )) as Awaited<ReturnType<NonNullable<PluginHostPort['saveConfig']>>>,
      invoke: (owner, task, capability, method, input) =>
        callPort().request(
          owner,
          'capability.invoke',
          { capability, method, input },
          {
            owner,
            requestId: randomUUID(),
            budgetMs: 30000,
            taskId: task.taskId,
            signal: task.signal,
          },
        ),
      openInput: async () => ({ ok: false, error: makeError('unavailable', false) }),
      openOutput: async () => ({ ok: false, error: makeError('unavailable', false) }),
    };
    const observedResults = new Map<string, (value: JsonValue) => void>();
    const driver = new CordisRuntimeDriver(async (activation) => {
      const source = sourceFor(activation.owner.pluginId);
      if (fingerprint(activation.owner.pluginId) !== source.fingerprint)
        throw new KernelFault('package-changed');
      const directory =
        source.registration.dataDirectory ??
        path.join(dataRoot, 'plugin-data', activation.owner.pluginId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const host = createPluginHostServices(
        { owner: activation.owner, signal: activation.signal },
        sdkPort,
      );
      return {
        activate: (context) =>
          source.registration.definition.activate({
            ...context,
            dataDirectory: directory,
            host,
            provide: (providerId, methods) =>
              context.provide(
                providerId,
                Object.fromEntries(
                  Object.entries(methods).map(([method, execute]) => [
                    method,
                    async (task, input) => {
                      const output = await execute(task, input);
                      // Observe the actual provider return even when logical cancellation won earlier.
                      observedResults.get(task.taskId)?.(output);
                      return output;
                    },
                  ]),
                ),
              ),
          }),
        ...(source.registration.definition.migrateConfig
          ? { migrateConfig: source.registration.definition.migrateConfig }
          : {}),
      };
    });
    const protectedPackages = Object.fromEntries(
      options.plugins
        .filter((plugin) => plugin.protected)
        .map((plugin) => [plugin.manifest.id, path.resolve(plugin.directory)]),
    );
    const manager = new PluginManager({
      driver,
      hostApiVersion: '1.0.0',
      platform: `${process.platform}-${process.arch}` as PlatformTarget,
      protectedPackages,
      cleanupTimeoutMs: 30000,
      trust: async (snapshot) =>
        permission.service.isTrusted(
          identity(snapshot.owner.pluginId),
          sourceFor(snapshot.owner.pluginId).fingerprint,
        ),
      readiness: async (snapshot) => {
        // This headless composition has no media, desktop-input or resource-download adapter.
        if (snapshot.manifest.resources?.length) return makeError('not-ready', false);
        for (const permission of snapshot.manifest.permissions ?? []) {
          if (!['capability-use', 'files', 'process', 'credentials'].includes(permission.kind))
            return makeError('unavailable', false);
          if (
            permission.kind === 'credentials' &&
            !permission.keys.every((key) =>
              sourceFor(snapshot.owner.pluginId).registration.hostCredentials?.includes(key),
            )
          )
            return makeError('not-ready', false);
        }
        return null;
      },
    });
    ref.manager = manager;
    const tasks = new TaskSupervisor({
      isActive: (owner) => manager.isActive(owner),
      isLive: (owner) => manager.isLive(owner),
      signal: (owner) => manager.ownerSignal(owner),
    });
    ref.tasks = tasks;
    ref.hostPort = createRuntimeHostPort({
      manager,
      tasks,
      configs,
      permissions: permission.service,
      ...(options.changed ? { changed: options.changed } : {}),
    });
    const host = new CompanionPluginHost(
      manager,
      tasks,
      configs,
      permission.service,
      permission.control,
      driver,
      sources,
      capabilityPermissionAuthorizer(permission.service, manager),
      options.changed ?? (() => {}),
      observedResults,
      configurationObservers,
      configurationFaults,
    );
    try {
      for (const { registration, fingerprint: digest } of sources.values()) {
        const installed = manager.install(registration.manifest, {
          directory: path.resolve(registration.directory),
          origin: 'builtin',
        });
        if (!installed.ok) throw new KernelFault(installed.error.code);
        if (installed.value.state === 'rejected') throw new KernelFault('not-ready');
        const id = identity(registration.manifest.id);
        const definition = configs.register(id, registration.manifest);
        if (!definition.ok) throw new KernelFault(definition.error.code);
        const existing = await configs.get(id);
        const configured =
          registration.config ?? (existing.ok ? undefined : registration.initialConfig);
        if (configured) {
          const data = {
            ...definition.value.defaults,
            ...(existing.ok ? existing.value.data : {}),
            ...configured,
          };
          const unchanged =
            existing.ok &&
            Object.keys(data).length === Object.keys(existing.value.data).length &&
            Object.entries(data).every(
              ([key, value]) => JSON.stringify(existing.value.data[key]) === JSON.stringify(value),
            );
          if (!unchanged) {
            const saved = await configs.save(id, data, existing.ok ? existing.value.revision : 0);
            if (!saved.ok) throw new KernelFault(saved.error.code);
          }
        } else {
          const initialized = await configs.initialize(id);
          if (!initialized.ok) throw new KernelFault(initialized.error.code);
        }
        if (
          !permission.control.confirmTrust(id, digest, true) ||
          !permission.control.setPreset(id, registration.preset)
        )
          throw new KernelFault('permission-denied');
      }
      for (const { registration } of sources.values()) {
        if (registration.enabled) await host.setEnabled(registration.manifest.id, true);
      }
      return host;
    } catch (error) {
      await host.close();
      throw error;
    }
  }

  onConfigurationCommit(observer: ConfigurationObserver): () => void {
    this.configurationObservers.add(observer);
    return () => {
      this.configurationObservers.delete(observer);
    };
  }

  configurationDiagnostics(): { observerFailures: number } {
    return { observerFailures: this.configurationFaults.observers };
  }

  owner(pluginId = COMPANION_HOST_ID): OwnerRef {
    const entry = this.manager.get(identity(pluginId));
    if (!entry || !this.manager.isActive(entry.owner)) throw new KernelFault('not-ready');
    return entry.owner;
  }

  bind(capability: string, pluginId: string, providerId: string): void {
    const result = this.manager.select(identity(COMPANION_HOST_ID), capability, {
      ...identity(pluginId),
      providerId,
    });
    if (!result.ok) throw new KernelFault(result.error.code);
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    if (this.closed) throw new KernelFault('not-ready');
    const id = identity(pluginId);
    if (!this.sources.has(pluginId)) throw new KernelFault('invalid-input');
    if (enabled) {
      const config = await this.configs.get(id);
      if (!config.ok) throw new KernelFault(config.error.code);
      const result = await this.manager.enable(id, config.value.data);
      if (!result.ok) throw new KernelFault(result.error.code);
      if (result.value.state !== 'active')
        throw new KernelFault(result.value.reason?.code ?? 'not-ready');
    } else {
      const result = await this.manager.disable(id);
      if (!result.ok) throw new KernelFault(result.error.code);
      if (result.value.state !== 'disabled')
        throw new KernelFault(result.value.reason?.code ?? 'unavailable');
    }
    this.changed();
  }

  verifySource(pluginId: string): boolean {
    const source = this.sources.get(pluginId);
    return !!source && this.permissions.isTrusted(identity(pluginId), source.fingerprint);
  }

  isEnabled(pluginId: string): boolean {
    return this.manager.get(identity(pluginId))?.state === 'active';
  }

  views(): CompanionPluginView[] {
    return this.manager.list().map((entry) => ({
      id: entry.owner.pluginId,
      name:
        entry.manifest.displayName['zh-CN'] ??
        entry.manifest.displayName['en'] ??
        entry.owner.pluginId,
      state: entry.state,
      desiredActive: entry.desiredActive,
      protected: entry.protected,
    }));
  }

  runCapability(
    capability: string,
    method: string,
    input: JsonValue,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
    observe?: (value: JsonValue) => void,
  ): TaskHandle {
    const started = this.tasks.invokeCapability(
      this.manager,
      this.owner(),
      capability,
      method,
      input,
      this.authorize,
      options,
    );
    if (!started.ok) throw new KernelFault(started.error.code);
    if (observe) this.observedResults.set(started.value.taskId, observe);
    this.track(started.value);
    return started.value;
  }

  async call(
    capability: string,
    method: string,
    input: JsonValue,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    const task = this.runCapability(capability, method, input, {
      timeoutMs: 30000,
      ...(signal ? { signal } : {}),
    });
    const result = await task.result;
    await task.settled;
    if (!result.ok) throw new KernelFault(result.error.code);
    return result.value;
  }

  /** Root work has service/plugin lifetime, not an HTTP request or foreground turn lifetime. */
  run(
    work: Parameters<TaskSupervisor['run']>[1],
    options: Parameters<TaskSupervisor['run']>[2] = {},
  ): TaskHandle {
    return this.runFor(COMPANION_HOST_ID, work, options);
  }

  runFor(
    pluginId: string,
    work: Parameters<TaskSupervisor['run']>[1],
    options: Parameters<TaskSupervisor['run']>[2] = {},
  ): TaskHandle {
    const result = this.tasks.run(this.owner(pluginId), work, options);
    if (!result.ok) throw new KernelFault(result.error.code);
    this.track(result.value);
    return result.value;
  }

  /** Activation can receive a read-only seed before it is allowed to start supervised work. */
  bootstrapGrant(owner: OwnerRef, capability: string): number | null {
    const source = this.sources.get(owner.pluginId);
    const entry = this.manager.get(identity(owner.pluginId));
    const policy = this.permissionControl.inspect(identity(owner.pluginId));
    if (
      !source ||
      !entry ||
      entry.state !== 'activating' ||
      entry.owner.generation !== owner.generation ||
      !policy ||
      policy.blocked ||
      !this.permissions.isTrusted(identity(owner.pluginId), source.fingerprint) ||
      !entry.manifest.permissions?.some(
        (permission) =>
          permission.kind === 'capability-use' && permission.capability === capability,
      ) ||
      presetDecision(policy.preset, { kind: 'capability-use', capability }) !== 'allow'
    )
      return null;
    return policy.epoch;
  }

  private track(handle: TaskHandle): void {
    this.handles.add(handle);
    void handle.settled.then(() => {
      this.handles.delete(handle);
      this.observedResults.delete(handle.taskId);
      handle.release();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.tasks.shutdown();
    await Promise.all([...this.handles].map((handle) => handle.settled));
    await this.manager.shutdown();
    await this.driver.dispose();
    this.permissions.close();
    this.configurationObservers.clear();
    this.configs.close();
  }
}
