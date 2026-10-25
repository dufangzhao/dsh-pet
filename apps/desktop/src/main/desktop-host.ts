import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  RemoteRuntimeDriver,
  PluginManager,
  TaskSupervisor,
  discoverPlugins,
  type DiscoveryRoot,
} from '@pet/host-kernel';
import type { HostStatus } from '@pet/contracts';
export class DesktopHost {
  readonly manager: PluginManager;
  readonly tasks: TaskSupervisor;
  readonly driver: RemoteRuntimeDriver;
  #closing: Promise<{ exitConfirmed: boolean; forced: boolean }> | undefined;
  private constructor(driver: RemoteRuntimeDriver, manager: PluginManager) {
    this.driver = driver;
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
    const reference: { manager?: PluginManager } = {};
    const driver = new RemoteRuntimeDriver({
      executable: options.executable,
      workerEntry: options.workerEntry,
      roots,
      onFault: (owner) => {
        if (reference.manager) void reference.manager.reportFault(owner);
      },
    });
    const manager = new PluginManager({ driver, hostApiVersion: '1.0.0', platform: 'win32-x64' });
    reference.manager = manager;
    const host = new DesktopHost(driver, manager);
    const discovered = await discoverPlugins(roots);
    for (const candidate of discovered.plugins)
      manager.install(candidate.manifest, {
        directory: candidate.directory,
        origin: candidate.origin,
      });
    // Discovery never implies permission to activate a package.
    void driver.ready().catch(() => {});
    return host;
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
    await this.manager.shutdown();
    return this.driver.dispose();
  }
}
