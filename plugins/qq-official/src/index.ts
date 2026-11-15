import { isQQSourceSettings, type QQOfficialSettings } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import { OfficialQqDriver } from './driver.js';
import type { OfficialQqPortsFor } from './ports.js';

export * from './wire.js';
export * from './ports.js';
export * from './driver.js';

export function parseOfficialQqSettings(config: unknown): QQOfficialSettings {
  if (!isQQSourceSettings(config) || config.protocol !== 'official')
    throw new KernelFault('invalid-input');
  return { protocol: 'official', appId: config.appId, scenes: [...config.scenes] };
}
export function createOfficialQqPlugin(portsFor: OfficialQqPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const settings = parseOfficialQqSettings(context.config);
      const configured = settings.appId.length > 0 && settings.scenes.length > 0;
      context.provide('official', {
        describe: async () => ({
          protocol: settings.protocol,
          appId: settings.appId,
          scenes: [...settings.scenes],
          configured,
          transport: 'production-ws',
          nativeWire: true,
        }),
      });
      if (!configured) return;
      const ports = portsFor(context);
      const driver = new OfficialQqDriver(ports.authorizedOfficial(settings), ports.observer);
      // Register cleanup before binding, so a failed binding cannot strand the native handle.
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
      // Only the source-active controller starts driver.start under its tracked source task.
    },
  });
}
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
