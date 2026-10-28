import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  FileConfigStore,
  verifyDiscoveredPlugin,
  type DiscoveredPlugin,
  type StoredConfig,
} from '@pet/host-kernel';
import type { ConsoleBuiltinPackage } from '@pet/contracts';
const identity = { pluginId: 'host.builtin-policy', instanceId: 'default' };
export const packageDigest = (source: DiscoveredPlugin) =>
  createHash('sha256')
    .update(
      JSON.stringify({ origin: source.origin, directory: source.directory, files: source.files }),
    )
    .digest('hex');
/** Packaged code remains read-only; this ledger records deliberate feature removal. */
export class BuiltinRegistry {
  readonly #sources = new Map<string, DiscoveredPlugin>();
  readonly #protected = new Set<string>();
  private constructor(
    private readonly store: FileConfigStore,
    private record: StoredConfig,
  ) {}
  static async create(directory: string): Promise<BuiltinRegistry> {
    const policyRoot = path.join(directory, 'host-settings');
    await mkdir(policyRoot, { recursive: true });
    const store = new FileConfigStore(policyRoot);
    let record = await store.read(identity);
    if (!record) {
      record = { format: 1, ...identity, schemaVersion: 1, revision: 1, data: { removed: [] } };
      if (!(await store.compareAndSet(identity, null, record)))
        throw new Error('Builtin policy unavailable');
    }
    const removed = record.data['removed'];
    if (
      record.schemaVersion !== 1 ||
      Object.keys(record.data).length !== 1 ||
      !Array.isArray(removed) ||
      removed.length > 256 ||
      !removed.every((value) => typeof value === 'string' && value.length <= 128)
    )
      throw new Error('Builtin policy unavailable');
    return new BuiltinRegistry(store, record);
  }
  register(source: DiscoveredPlugin, protectedPackage: boolean): void {
    if (source.origin !== 'builtin') return;
    this.#sources.set(source.manifest.id, source);
    if (protectedPackage) this.#protected.add(source.manifest.id);
  }
  removed(id: string): boolean {
    return !this.#protected.has(id) && (this.record.data['removed'] as string[]).includes(id);
  }
  available(): readonly ConsoleBuiltinPackage[] {
    return [...this.#sources.values()]
      .filter((source) => this.removed(source.manifest.id))
      .map((source) => ({
        pluginId: source.manifest.id,
        name:
          source.manifest.displayName['zh-CN'] ?? Object.values(source.manifest.displayName)[0]!,
        version: source.manifest.version,
        digest: packageDigest(source),
        permissions: source.manifest.permissions ?? [],
      }));
  }
  async mark(id: string, removed: boolean): Promise<boolean> {
    if (!this.#sources.has(id) || this.#protected.has(id)) return false;
    const ids = new Set(this.record.data['removed'] as string[]);
    if (removed) ids.add(id);
    else ids.delete(id);
    const next: StoredConfig = {
      ...this.record,
      revision: this.record.revision + 1,
      data: { removed: [...ids].sort() },
    };
    if (!(await this.store.compareAndSet(identity, this.record.revision, next))) return false;
    this.record = next;
    return true;
  }
  async verified(id: string, expectedDigest: string): Promise<DiscoveredPlugin | null> {
    const source = this.#sources.get(id);
    return source &&
      this.removed(id) &&
      packageDigest(source) === expectedDigest &&
      (await verifyDiscoveredPlugin(source))
      ? source
      : null;
  }
}
