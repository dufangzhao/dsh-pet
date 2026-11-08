import path from 'node:path';
import { FileConfigStore, KernelFault, type StoredConfig } from '@pet/host-kernel';
const identity = { pluginId: 'host.application-state', instanceId: 'default' };
/** Reuse only the existing disabled-role ledger; guide/history migration fields stay untouched. */
export class SharedApplicationState {
  private constructor(
    private readonly store: FileConfigStore,
    private current: StoredConfig,
  ) {}
  static async create(directory: string): Promise<SharedApplicationState> {
    const store = new FileConfigStore(path.join(directory, 'host-settings'));
    let current = await store.read(identity);
    if (!current) {
      current = {
        format: 1,
        ...identity,
        schemaVersion: 1,
        revision: 1,
        data: { guideStep: 'welcome', completed: false, deferred: false, disabled: [] },
      };
      if (!(await store.compareAndSet(identity, null, current))) throw new KernelFault('conflict');
    }
    if (
      current.schemaVersion !== 1 ||
      !Array.isArray(current.data['disabled']) ||
      !current.data['disabled'].every((id) => typeof id === 'string')
    )
      throw new KernelFault('not-ready');
    return new SharedApplicationState(store, current);
  }
  disabled(id: string): boolean {
    return (this.current.data['disabled'] as string[]).includes(id);
  }
  async record(pluginId: string, enabled: boolean): Promise<void> {
    const disabled = new Set(this.current.data['disabled'] as string[]);
    if (enabled) disabled.delete(pluginId);
    else disabled.add(pluginId);
    const next = {
      ...this.current,
      revision: this.current.revision + 1,
      data: { ...this.current.data, disabled: [...disabled].sort() },
    };
    if (JSON.stringify(next.data['disabled']) === JSON.stringify(this.current.data['disabled']))
      return;
    if (!(await this.store.compareAndSet(identity, this.current.revision, next)))
      throw new KernelFault('conflict');
    this.current = next;
  }
}
