import { randomUUID } from 'node:crypto';
import type { JsonObject, JsonValue, PluginManifest } from '@pet/contracts';
import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import type {
  ModelConnectionDescription,
  ModelConnectionPortsFor,
  ResponseClient,
} from './model-connection-types.js';
import { MODEL_CONNECTION_CAPABILITY } from './model-connection-types.js';

export const FIXTURE_MODEL_CONNECTION = 'pet.model-connection-fixture/fixture';
export const fixtureModelManifest: PluginManifest = {
  schemaVersion: 1,
  id: 'pet.model-connection-fixture',
  version: '0.1.0',
  displayName: { en: 'Synthetic connection fixture', 'zh-CN': '模拟模型连接' },
  description: {
    en: 'Deterministic native connection without an external model',
    'zh-CN': '不调用外部模型的原生连接验证',
  },
  license: 'MIT',
  host: '^1.0.0',
  platforms: ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'],
  entries: { runtime: 'src/fixture-model.ts' },
  provides: [
    {
      id: 'fixture',
      capability: MODEL_CONNECTION_CAPABILITY,
      features: {
        nativeResponses: 1,
        methodPermissions: { describe: [{ kind: 'files', scope: 'plugin-data', access: 'read' }] },
      },
    },
  ],
  permissions: [{ kind: 'files', scope: 'plugin-data', access: 'read-write' }],
};

export function describeFixtureModel(
  _config: JsonObject,
  model = 'connection-fixture',
): ModelConnectionDescription {
  return {
    label: '模拟连接（无真实模型）',
    synthetic: true,
    settings: null,
    model,
    credentialRequired: false,
    credentialWritable: false,
  };
}

export function createFixtureModelClient(): ResponseClient {
  return {
    async respond(request, options = {}) {
      options.signal?.throwIfAborted();
      const now = Math.floor(Date.now() / 1000);
      return {
        response: {
          id: `fixture-${randomUUID()}`,
          object: 'response',
          created_at: now,
          completed_at: now,
          status: 'completed',
          incomplete_details: null,
          model: request.model ?? '',
          previous_response_id: null,
          instructions: null,
          error: null,
          output: [
            {
              type: 'message',
              id: `fixture-message-${randomUUID()}`,
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: '模拟连接检查/回复：OK（未调用真实模型）',
                  annotations: [],
                  logprobs: [],
                },
              ],
            },
          ],
          tools: [],
          tool_choice: 'auto',
          truncation: 'disabled',
          parallel_tool_calls: false,
          text: { format: { type: 'text' } },
          top_p: 1,
          presence_penalty: 0,
          frequency_penalty: 0,
          top_logprobs: 0,
          temperature: 1,
          reasoning: null,
          usage: null,
          max_output_tokens: request.max_output_tokens ?? null,
          max_tool_calls: null,
          store: false,
          background: false,
          service_tier: 'default',
          metadata: null,
          safety_identifier: null,
          prompt_cache_key: null,
        },
        origin: {
          instance: 'fixture',
          module: 'pet.model-connection-fixture',
          model: request.model ?? '',
          compatibilityDomain: FIXTURE_MODEL_CONNECTION,
        },
        attempts: [],
      };
    },
  };
}

export function createFixtureModelPlugin(
  portsFor: ModelConnectionPortsFor,
  client: ResponseClient = createFixtureModelClient(),
  model = 'connection-fixture',
): PluginDefinition {
  return definePlugin({
    activate(context) {
      context.provide('fixture', {
        describe: async () =>
          ({ ...describeFixtureModel(context.config, model) }) as unknown as JsonValue,
      });
      context.effect(() => portsFor(context).bind({ model, client }));
    },
  });
}
