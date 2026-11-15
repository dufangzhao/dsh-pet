import { definePlugin, type PluginContext, type PluginDefinition } from '@pet/plugin-sdk';
import { isQQPolicySettings, type QQPolicySettings } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';

/** Host-private policy binding; no management bearer or participant grant crosses JSON. */
export interface SharedQQPorts {
  bind(policy: QQPolicySettings): () => Promise<void>;
}
export type SharedQQPortsFor = (context: PluginContext) => SharedQQPorts;

export function createSharedQQPlugin(portsFor: SharedQQPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      if (!isQQPolicySettings(context.config)) throw new KernelFault('invalid-input');
      const policy = context.config;
      const ports = portsFor(context);
      context.provide('control', {
        describe: async () => ({
          protocols: ['official', 'onebot-v11'],
          textRequired: true,
          voiceAdditive: true,
        }),
      });
      context.effect(() => ports.bind(policy));
    },
  });
}

export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
