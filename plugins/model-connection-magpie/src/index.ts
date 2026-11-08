import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import type { JsonObject, JsonValue } from '@pet/contracts';
import {
  parseResponsesConnectionSettings,
  type ModelConnectionDescription,
  type ModelConnectionPortsFor,
} from '@pet/companion-runtime';
import { KernelFault } from '@pet/host-kernel';

export { createMagpieNativeProvider } from './native-provider.mjs';
export const parseMagpieConfig = parseResponsesConnectionSettings;

export function describeMagpieConfig(config: JsonObject): ModelConnectionDescription {
  const settings = parseMagpieConfig(config);
  return {
    label: 'Magpie',
    synthetic: false,
    settings,
    model: settings.model || null,
    credentialRequired: settings.authMode === 'gateway-key',
    credentialWritable: settings.authMode === 'gateway-key',
  };
}

/** Ordinary plugin; the host binds credentials/native references, never a gateway process. */
export function createMagpieConnectionPlugin(portsFor: ModelConnectionPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const description = describeMagpieConfig(context.config);
      context.provide('magpie', {
        describe: async () => ({ ...description }) as unknown as JsonValue,
      });
      if (!description.model || !description.settings) return;
      const ports = portsFor(context);
      const transport = ports.authorizedResponses(description.settings.baseUrl);
      context.effect(() => () => transport.close());
      context.effect(() =>
        ports.bind({ model: description.model ?? '', client: transport.client }),
      );
    },
  });
}

// Generic loading cannot manufacture a host-native port or gateway credential.
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
