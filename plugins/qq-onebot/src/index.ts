import { isQQSourceSettings, type QQOneBotSettings } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import { OneBotQqDriver } from './driver.js';
import type { OneBotQqPortsFor } from './ports.js';

export * from './wire.js';
export * from './ports.js';
export * from './driver.js';

export function parseOneBotQqSettings(config: unknown): QQOneBotSettings {
  if (!isQQSourceSettings(config) || config.protocol !== 'onebot-v11')
    throw new KernelFault('invalid-input');
  return { ...config };
}
export function createOneBotQqPlugin(portsFor: OneBotQqPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const settings = parseOneBotQqSettings(context.config);
      const configured = settings.accountId.length > 0;
      context.provide('onebot', {
        describe: async () => ({
          protocol: settings.protocol,
          accountId: settings.accountId,
          configured,
          mode: settings.mode,
          channelMode: settings.channelMode,
          mediaProfile: settings.mediaProfile,
          nativeWire: true,
        }),
      });
      if (!configured) return;
      const ports = portsFor(context);
      const driver = new OneBotQqDriver(
        settings.accountId,
        ports.authorizedOneBot(settings),
        ports.observer,
      );
      context.effect(() => () => driver.close());
      context.effect(() => {
        const unbind = ports.bind(driver);
        return async () => {
          const results = await Promise.allSettled([
            driver.close(),
            Promise.resolve().then(unbind),
          ]);
          const failed = results.find((result) => result.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
        };
      });
    },
  });
}
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
