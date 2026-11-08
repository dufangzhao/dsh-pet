import type { JsonObject, ResponsesConnectionSettings } from '@pet/contracts';
import type { PluginContext, PluginDefinition } from '@pet/plugin-sdk';
import type { ResponseClient } from '@pet/harness-cortico';
import type { ServicePluginRegistration } from './plugin-host.js';

export type { ResponseClient } from '@pet/harness-cortico';
export const MODEL_CONNECTION_CAPABILITY = 'companion.model.connection@1';
export const MAGPIE_CONNECTION = 'pet.model-connection-magpie/magpie';

export interface TextModelBinding {
  readonly model: string;
  readonly client: ResponseClient;
}
export interface AuthorizedResponseTransport {
  readonly client: ResponseClient;
  close(): Promise<void>;
}
export interface ModelConnectionPorts {
  bind(binding: TextModelBinding): () => Promise<void>;
  authorizedResponses(baseUrl: string): AuthorizedResponseTransport;
}
export type ModelConnectionPortsFor = (context: PluginContext) => ModelConnectionPorts;
export interface ModelConnectionDescription {
  readonly label: string;
  readonly synthetic: boolean;
  readonly settings: ResponsesConnectionSettings | null;
  readonly model: string | null;
  readonly credentialRequired: boolean;
  readonly credentialWritable: boolean;
}
export interface ModelConnectionRegistration extends ServicePluginRegistration {
  readonly connection: {
    readonly providerId: string;
    describeConfig(config: JsonObject): ModelConnectionDescription;
  };
}
export type ModelConnectionFactory = (portsFor: ModelConnectionPortsFor) => PluginDefinition;
