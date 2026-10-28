import { mkdir } from 'node:fs/promises';
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
} from '@pet/host-kernel';
import {
  makeError,
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
    const configs = new ConfigService(
      new FileConfigStore(configRoot),
      (owner) => reference.manager?.isLive(owner) === true,
    );
    const manager = new PluginManager({
      driver,
      ...(options.protectedPackages ? { protectedPackages: options.protectedPackages } : {}),
      trust: async (snapshot) => permission.isTrusted(snapshot.owner),
      hostApiVersion: '1.0.0',
      platform: 'win32-x64',
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
      readiness: (snapshot, candidate) =>
        checkHostReadiness(
          snapshot.owner,
          snapshot.manifest,
          candidate,
          configs,
          credentials !== undefined,
          options.adapters,
        ),
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
  availableBuiltins(): readonly ConsoleBuiltinPackage[] {
    return this.builtins
      .available()
      .filter((pkg) => !this.manager.get({ pluginId: pkg.pluginId, instanceId: 'default' }));
  }
  async restoreBuiltin(pluginId: string, expectedDigest: string): Promise<Result<null>> {
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
