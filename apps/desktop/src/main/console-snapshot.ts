import type { ConsoleSnapshot, HostStatus } from '@pet/contracts';
import type { PluginSnapshot, RegisteredContribution } from '@pet/host-kernel';
export function consoleSnapshot(
  host: HostStatus,
  plugins: readonly PluginSnapshot[],
  app: ConsoleSnapshot['app'],
  contributions: readonly RegisteredContribution[],
): ConsoleSnapshot {
  return {
    version: 1,
    host,
    app,
    contributions: contributions.map((item) => ({
      owner: item.owner,
      id: item.id,
      kind: item.declaration.kind,
      title: item.declaration.title['zh-CN'] ?? Object.values(item.declaration.title)[0]!,
    })),
    plugins: plugins.map((plugin) => ({
      owner: plugin.owner,
      name: plugin.manifest.displayName['zh-CN'] ?? Object.values(plugin.manifest.displayName)[0]!,
      version: plugin.manifest.version,
      state: plugin.state,
      origin: plugin.origin,
      protected: plugin.protected,
      permissions: plugin.manifest.permissions ?? [],
      ...(plugin.reason ? { reason: plugin.reason } : {}),
    })),
  };
}
