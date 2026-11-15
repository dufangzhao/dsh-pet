import { definePlugin, type PluginContext, type PluginDefinition } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import type { JsonValue } from '@pet/contracts';

export interface LocalAgentLinkPorts {
  /** Bind the real plugin instance without borrowing a credential or dialing during activation. */
  bind(): () => Promise<void>;
  status(): Promise<JsonValue>;
}
export function createLocalAgentLinkPlugin(
  portsFor: (context: PluginContext) => LocalAgentLinkPorts,
): PluginDefinition {
  return definePlugin({
    activate(context) {
      const ports = portsFor(context);
      context.effect(() => ports.bind());
      context.provide('link', { status: async () => ports.status() });
    },
  });
}
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
