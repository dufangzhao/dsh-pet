import { mkdir } from 'node:fs/promises';
import {
  SHARED_FORBIDDEN_PLUGIN_IDS,
  presentationOnlyChange,
} from './shared-composition-policy.js';
import path from 'node:path';
import { createHostPermissions } from './host-permissions.js';
import { checkHostReadiness, type HostAdapterAvailability } from './host-readiness.js';
import { removeUserPlugin } from './plugin-removal.js';
import { ApprovalInbox } from './approval-inbox.js';
import { BuiltinRegistry } from './builtin-registry.js';
import type { PermissionService, PermissionControl } from '@pet/host-kernel';
import {
  RemoteRuntimeDriver,
  PluginManager,
  TaskSupervisor,
  discoverPlugins,
  type DiscoveryRoot,
  ConfigService,
  FileConfigStore,
  PluginDataDirectories,
  createRuntimeHostPort,
  type RuntimeHostPort,
  type HostServicesOptions,
  CredentialBroker,
  FileCiphertextStore,
  SecretRedactor,
  credentialPermissionAuthorizer,
  type SecretCipher,
  type RuntimeDriver,
} from '@pet/host-kernel';
import {
  makeError,
  PLATFORM_TARGETS,
  DESKTOP_COMPANION_PLUGIN_ID,
  type OwnerRef,
  type PlatformTarget,
  type JsonObject,
  type HostStatus,
  type ConsoleBuiltinPackage,
  type Result,
} from '@pet/contracts';
export class DesktopHost {
  readonly manager: PluginManager;
  readonly tasks: TaskSupervisor;
  readonly driver: RemoteRuntimeDriver;
  readonly configs: ConfigService;
  readonly dataDirectories: PluginDataDirectories;
  readonly permissions: PermissionService;
  readonly permissionControl: PermissionControl;
  readonly approvals: ApprovalInbox;
  readonly builtins: BuiltinRegistry;
  readonly registerSource: ReturnType<typeof createHostPermissions>['register'];
  readonly describeTrust: ReturnType<typeof createHostPermissions>['describeTrust'];
  readonly getPackage: ReturnType<typeof createHostPermissions>['getPackage'];
  readonly verifyTrust: ReturnType<typeof createHostPermissions>['verifyTrust'];
  readonly credentials: CredentialBroker | undefined;
  readonly #configurationObservers = new Map<string, Set<(revision: number) => void>>();
  #configurationObserverFaults = 0;
  #sharedCompanion = false;
  #closing: Promise<{ exitConfirmed: boolean; forced: boolean }> | undefined;
  private constructor(
    driver: RemoteRuntimeDriver,
    manager: PluginManager,
    configs: ConfigService,
    dataDirectories: PluginDataDirectories,
    permissions: PermissionService,
    permissionControl: PermissionControl,
    tasks: TaskSupervisor,
    approval: ApprovalInbox,
    builtins: BuiltinRegistry,
    source: ReturnType<typeof createHostPermissions>,
    credentials?: CredentialBroker,
  ) {
    this.driver = driver;
    this.configs = configs;
    this.dataDirectories = dataDirectories;
    this.manager = manager;
    this.tasks = tasks;
    this.permissions = permissions;
    this.permissionControl = permissionControl;
    this.approvals = approval;
    this.builtins = builtins;
    this.registerSource = source.register;
    this.describeTrust = source.describeTrust;
    this.getPackage = source.getPackage;
    this.verifyTrust = source.verifyTrust;
    this.credentials = credentials;
  }
  static async create(options: {
    executable: string;
    sharedCompanion?: boolean;
    companionLifecycle?: {
      readonly sourcePluginId: string;
      stopFor(owner: OwnerRef): Promise<void>;
    };
    onChanged?: () => void;
    workerEntry: string;
    builtinDirectory: string;
    userDirectory: string;
    cipher?: SecretCipher;
    protectedPackages?: Readonly<Record<string, string>>;
    approvalTimeoutMs?: number;
    adapters?: HostAdapterAvailability;
    media?: Pick<HostServicesOptions, 'input' | 'output' | 'capabilityTask'>;
  }): Promise<DesktopHost> {
    await mkdir(options.userDirectory, { recursive: true });
    const roots: DiscoveryRoot[] = [
      { directory: path.resolve(options.builtinDirectory), origin: 'builtin' },
      { directory: path.resolve(options.userDirectory), origin: 'user' },
    ];
    const configRoot = path.join(path.dirname(options.userDirectory), 'configuration');
    const dataRoot = path.join(path.dirname(options.userDirectory), 'plugin-data');
    await mkdir(configRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    const dataDirectories = new PluginDataDirectories(dataRoot);
    const vaultRoot = path.join(path.dirname(options.userDirectory), 'vault');
    if (options.cipher) await mkdir(vaultRoot, { recursive: true });
    const reference: {
      manager?: PluginManager;
      tasks?: TaskSupervisor;
      hostPort?: RuntimeHostPort;
      configurationCommit?: (pluginId: string, revision: number) => void;
    } = {};
    const builtins = await BuiltinRegistry.create(path.dirname(options.userDirectory));
    const approval = new ApprovalInbox(options.approvalTimeoutMs ?? 30000);
    const permission = createHostPermissions(reference, approval, options.approvalTimeoutMs);
    const credentials = options.cipher
      ? new CredentialBroker({
          cipher: options.cipher,
          store: new FileCiphertextStore(vaultRoot),
          authorize: credentialPermissionAuthorizer(permission.service),
          redactor: new SecretRedactor(),
        })
      : undefined;
    const driver = new RemoteRuntimeDriver({
      executable: options.executable,
      workerEntry: options.workerEntry,
      roots,
      dataDirectory: async (owner) => {
        const snapshot = reference.manager?.get(owner);
        if (
          !snapshot?.manifest.permissions?.some(
            (p) => p.kind === 'files' && p.scope === 'plugin-data',
          )
        )
          return undefined;
        const allocated = await dataDirectories.get({
          pluginId: owner.pluginId,
          instanceId: owner.instanceId,
        });
        if (!allocated.ok) throw new Error('Plugin data directory unavailable');
        return allocated.value;
      },
      host: {
        allowJson: (value) => reference.hostPort?.allowJson?.(value) !== false,
        allowFrame: (frame) => reference.hostPort?.allowFrame?.(frame) !== false,
        forget: (streamId) => reference.hostPort?.forget?.(streamId),
        useCredential: (...args) =>
          reference.hostPort?.useCredential?.(...args) ??
          Promise.resolve({ ok: false, error: makeError('not-ready', false) }),
        ...(options.media?.input
          ? {
              input: (ref, writer) => {
                if (reference.hostPort?.input) reference.hostPort.input(ref, writer);
                else writer.cancel();
              },
            }
          : {}),
        ...(options.media?.output
          ? {
              output: (ref, reader) => {
                if (reference.hostPort?.output) reference.hostPort.output(ref, reader);
                else reader.cancel();
              },
            }
          : {}),
        signalFor: (owner, taskId) => reference.hostPort?.signalFor(owner, taskId) ?? null,
        request: (owner, action, payload, context) =>
          reference.hostPort?.request(owner, action, payload, context) ??
          Promise.resolve({ ok: false, error: makeError('not-ready', false) }),
      },
      onFault: (owner) => {
        if (reference.manager)
          void reference.manager.reportFault(owner).then(() => options.onChanged?.());
      },
    });
    const configs = new (class extends ConfigService {
      override async save(
        ...args: Parameters<ConfigService['save']>
      ): ReturnType<ConfigService['save']> {
        if (options.sharedCompanion && args[0].pluginId === 'pet.profile') {
          const current = await this.get(args[0]);
          if (!current.ok) return current;
          const candidate = args[1];
          if (
            !candidate ||
            typeof candidate !== 'object' ||
            Array.isArray(candidate) ||
            !presentationOnlyChange(current.value.data, candidate as JsonObject)
          )
            return { ok: false, error: makeError('permission-denied', false) };
        }
        const result = await super.save(...args);
        if (result.ok) {
          try {
            reference.configurationCommit?.(args[0].pluginId, result.value.snapshot.revision);
          } catch {
            /* A committed Config cannot be reported as uncommitted. Observer records its own fault. */
          }
        }
        return result;
      }
    })(new FileConfigStore(configRoot), (owner) => reference.manager?.isLive(owner) === true);
    const lifecycle = options.companionLifecycle;
    const managedDriver: RuntimeDriver = lifecycle
      ? {
          start(activation, registrar) {
            const session = driver.start(activation, registrar);
            if (activation.owner.pluginId !== lifecycle.sourcePluginId) return session;
            return {
              ready: session.ready,
              async stop() {
                const outcomes = await Promise.allSettled([
                  Promise.resolve().then(() => lifecycle.stopFor(activation.owner)),
                  Promise.resolve().then(() => session.stop()),
                ]);
                if (outcomes.some((outcome) => outcome.status === 'rejected'))
                  throw new Error('Client cleanup incomplete');
              },
            };
          },
        }
      : driver;
    const actualPlatform = `${process.platform}-${process.arch}`;
    if (
      options.sharedCompanion &&
      !(PLATFORM_TARGETS as readonly string[]).includes(actualPlatform)
    )
      throw new Error('Unsupported shared desktop platform');
    const manager = new PluginManager({
      driver: managedDriver,
      ...(options.protectedPackages ? { protectedPackages: options.protectedPackages } : {}),
      trust: async (snapshot) => permission.isTrusted(snapshot.owner),
      hostApiVersion: '1.0.0',
      platform: options.sharedCompanion ? (actualPlatform as PlatformTarget) : 'win32-x64',
      removeInstallation: async (snapshot, installation) => {
        const removed =
          installation.origin === 'builtin'
            ? await builtins.mark(snapshot.owner.pluginId, true)
            : await removeUserPlugin(options.userDirectory, snapshot, installation);
        if (!removed) return false;
        permission.forget({
          pluginId: snapshot.owner.pluginId,
          instanceId: snapshot.owner.instanceId,
        });
        return true;
      },
      readiness: (snapshot, candidate) => {
        if (options.sharedCompanion && SHARED_FORBIDDEN_PLUGIN_IDS.has(snapshot.owner.pluginId))
          return Promise.resolve(makeError('not-ready', false));
        const clientSource =
          options.sharedCompanion === true &&
          snapshot.owner.pluginId === DESKTOP_COMPANION_PLUGIN_ID;
        return checkHostReadiness(
          snapshot.owner,
          snapshot.manifest,
          candidate,
          configs,
          credentials !== undefined || clientSource,
          options.adapters,
        );
      },
    });
    reference.manager = manager;
    const tasks = new TaskSupervisor(manager);
    reference.tasks = tasks;
    reference.hostPort = createRuntimeHostPort({
      manager,
      tasks,
      configs,
      permissions: permission.service,
      ...(options.onChanged ? { changed: options.onChanged } : {}),
      ...options.media,
      ...(credentials ? { credentials } : {}),
    });
    const host = new DesktopHost(
      driver,
      manager,
      configs,
      dataDirectories,
      permission.service,
      permission.control,
      tasks,
      approval,
      builtins,
      permission,
      credentials,
    );
    host.#sharedCompanion = options.sharedCompanion === true;
    reference.configurationCommit = (pluginId, revision) => {
      for (const observer of host.#configurationObservers.get(pluginId) ?? []) {
        try {
          observer(revision);
        } catch {
          host.#configurationObserverFaults++;
        }
      }
    };
    try {
      const discovered = await discoverPlugins(roots);
      for (const candidate of discovered.plugins) {
        const protectedPackage =
          candidate.origin === 'builtin' &&
          options.protectedPackages?.[candidate.manifest.id] !== undefined;
        builtins.register(candidate, protectedPackage);
        if (candidate.origin === 'builtin' && builtins.removed(candidate.manifest.id)) continue;
        const installed = manager.install(candidate.manifest, {
          directory: candidate.directory,
          origin: candidate.origin,
        });
        if (!installed.ok || installed.value.state === 'rejected') continue;
        permission.register(candidate);
        const identity = { pluginId: candidate.manifest.id, instanceId: 'default' };
        if (configs.register(identity, candidate.manifest).ok) await configs.initialize(identity);
      }
      // Discovery never implies permission to activate a package.
      void driver.ready().catch(() => {});
      return host;
    } catch {
      await host.shutdown();
      throw new Error('Host initialization failed');
    }
  }
  get configurationObserverFailures(): number {
    return this.#configurationObserverFaults;
  }
  onConfigurationCommit(pluginId: string, observer: (revision: number) => void): () => void {
    const observers =
      this.#configurationObservers.get(pluginId) ?? new Set<(revision: number) => void>();
    this.#configurationObservers.set(pluginId, observers);
    observers.add(observer);
    return () => {
      observers.delete(observer);
    };
  }
  availableBuiltins(): readonly ConsoleBuiltinPackage[] {
    return this.builtins
      .available()
      .filter((pkg) => !this.manager.get({ pluginId: pkg.pluginId, instanceId: 'default' }));
  }
  async restoreBuiltin(pluginId: string, expectedDigest: string): Promise<Result<null>> {
    if (this.#sharedCompanion && SHARED_FORBIDDEN_PLUGIN_IDS.has(pluginId))
      return { ok: false, error: makeError('not-ready', false) };
    const identity = { pluginId, instanceId: 'default' };
    if (this.manager.get(identity)) return { ok: false, error: makeError('conflict', false) };
    const candidate = await this.builtins.verified(pluginId, expectedDigest);
    if (!candidate) return { ok: false, error: makeError('package-changed', false) };
    if (!(await this.builtins.mark(pluginId, false)))
      return { ok: false, error: makeError('unavailable', false) };
    const installed = this.manager.install(candidate.manifest, {
      directory: candidate.directory,
      origin: 'builtin',
    });
    if (!installed.ok) return installed;
    if (installed.value.state !== 'rejected') {
      this.configs.register(identity, candidate.manifest);
      this.registerSource(candidate);
      await this.configs.initialize(identity);
    }
    return { ok: true, value: null };
  }
  status(): HostStatus {
    const plugins = this.manager.list();
    const tasks = this.tasks.diagnostics();
    return Object.freeze({
      version: 1,
      runtime: this.driver.status().state,
      installedPlugins: plugins.length,
      activePlugins: plugins.filter((p) => p.state === 'active').length,
      unreadyPlugins: plugins.filter((p) => p.state === 'unready').length,
      pendingRestartPlugins: plugins.filter((p) => p.state === 'pending_restart').length,
      runningTasks: tasks.activeTasks,
      pendingWork: tasks.pendingWork,
    });
  }
  stopAll(): HostStatus {
    this.tasks.cancelAll();
    return this.status();
  }
  shutdown(): Promise<{ exitConfirmed: boolean; forced: boolean }> {
    return (this.#closing ??= this.stop());
  }
  private async stop(): Promise<{ exitConfirmed: boolean; forced: boolean }> {
    this.tasks.shutdown();
    this.configs.close();
    this.permissions.close();
    this.approvals.close();
    this.credentials?.dispose();
    await this.manager.shutdown();
    const stopped = await this.driver.dispose();
    if (stopped.exitConfirmed) this.credentials?.redactor.clear();
    return stopped;
  }
}
