import { definePlugin, type PluginContext, type PluginDefinition } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import type { JsonValue } from '@pet/contracts';

export interface LocalHostBridgePorts {
  /** Register the actual issuer owner; activation itself never listens or creates peer authority. */
  bind(): () => Promise<void>;
  status(): Promise<JsonValue>;
}
export function createLocalHostBridgePlugin(
  portsFor: (context: PluginContext) => LocalHostBridgePorts,
): PluginDefinition {
  return definePlugin({
    activate(context) {
      const ports = portsFor(context);
      context.effect(() => ports.bind());
      context.provide('bridge', { status: async () => ports.status() });
    },
  });
}
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
