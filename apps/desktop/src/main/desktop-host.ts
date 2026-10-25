import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  RemoteRuntimeDriver,
  PluginManager,
  TaskSupervisor,
  discoverPlugins,
  type DiscoveryRoot,
  ConfigService,
  FileConfigStore,
  PluginDataDirectories,
} from '@pet/host-kernel';
import { makeError, type HostStatus } from '@pet/contracts';
export class DesktopHost {
  readonly manager: PluginManager;
  readonly tasks: TaskSupervisor;
  readonly driver: RemoteRuntimeDriver;
  readonly configs: ConfigService;
  readonly dataDirectories: PluginDataDirectories;
  #closing: Promise<{ exitConfirmed: boolean; forced: boolean }> | undefined;
  private constructor(
    driver: RemoteRuntimeDriver,
    manager: PluginManager,
    configs: ConfigService,
    dataDirectories: PluginDataDirectories,
  ) {
    this.driver = driver;
    this.configs = configs;
    this.dataDirectories = dataDirectories;
    this.manager = manager;
    this.tasks = new TaskSupervisor(manager);
  }
  static async create(options: {
    executable: string;
    workerEntry: string;
    builtinDirectory: string;
    userDirectory: string;
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
    const reference: { manager?: PluginManager } = {};
    const driver = new RemoteRuntimeDriver({
      executable: options.executable,
      workerEntry: options.workerEntry,
      roots,
      onFault: (owner) => {
        if (reference.manager) void reference.manager.reportFault(owner);
      },
    });
    const configs = new ConfigService(
      new FileConfigStore(configRoot),
      (owner) => reference.manager?.isLive(owner) === true,
    );
    const dataDirectories = new PluginDataDirectories(dataRoot);
    const manager = new PluginManager({
      driver,
      hostApiVersion: '1.0.0',
      platform: 'win32-x64',
      readiness: async (snapshot, candidate) => {
        if (snapshot.manifest.permissions?.length || snapshot.manifest.resources?.length)
          return makeError('not-ready', false);
        const identity = {
          pluginId: snapshot.owner.pluginId,
          instanceId: snapshot.owner.instanceId,
        };
        const definition = configs.definition(identity);
        if (!definition || !definition.validate(candidate).ok || !(await configs.get(identity)).ok)
          return makeError('not-ready', false);
        return null;
      },
    });
    reference.manager = manager;
    const host = new DesktopHost(driver, manager, configs, dataDirectories);
    try {
      const discovered = await discoverPlugins(roots);
      for (const candidate of discovered.plugins) {
        manager.install(candidate.manifest, {
          directory: candidate.directory,
          origin: candidate.origin,
        });
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
  shutdown(): Promise<{ exitConfirmed: boolean; forced: boolean }> {
    return (this.#closing ??= this.stop());
  }
  private async stop(): Promise<{ exitConfirmed: boolean; forced: boolean }> {
    this.tasks.shutdown();
    this.configs.close();
    await this.manager.shutdown();
    return this.driver.dispose();
  }
}
