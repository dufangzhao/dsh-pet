import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import { makeError, type CompanionAgentView, type JsonValue } from '@pet/contracts';
import {
  createCorticoHarness,
  type CorticoHarnessOptions,
  type CorticoHarnessPorts,
  type HarnessInput,
} from './harness.mjs';

export { createCorticoHarness } from './harness.mjs';
export type {
  HarnessProductContext,
  HarnessProfileBinding,
  CorticoHarness,
  CorticoHarnessOptions,
  CorticoHarnessPorts,
  HarnessInput,
  HarnessOrigin,
  HarnessOutput,
  ResponseClient,
} from './harness.mjs';

async function receipt(operation: () => Promise<void>): Promise<JsonValue> {
  try {
    await operation();
    return { ok: true, value: null };
  } catch (error) {
    const code =
      error instanceof TypeError
        ? 'invalid-input'
        : error instanceof DOMException && error.name === 'AbortError'
          ? 'cancelled'
          : 'unavailable';
    return { ok: false, error: { ...makeError(code) } };
  }
}

/** The service composes this ordinary definition with its authorized product ports. */
export function createCorticoPlugin(
  options: Omit<CorticoHarnessOptions, 'dataDirectory'>,
  ports: CorticoHarnessPorts,
): PluginDefinition {
  return definePlugin({
    async activate(ctx) {
      if (!ctx.dataDirectory) throw new Error('Cortico requires granted plugin-data storage');
      let status: CompanionAgentView['status'] = 'unavailable';
      const harness = await createCorticoHarness(
        { ...options, dataDirectory: ctx.dataDirectory },
        {
          ...ports,
          status(next, error) {
            status = next;
            ports.status(next, error);
          },
        },
      );
      ctx.effect(() => () => harness.close());
      ctx.provide('cortico', {
        status: async () => ({ status, mode: options.mode }),
        accept: async (task, input) => {
          if (task.signal.aborted) return { ok: false, error: { ...makeError('cancelled') } };
          // The adapter validates the unknown JSON at this trust boundary before queueing it.
          return receipt(() => harness.accept(input as unknown as HarnessInput));
        },
        stopForeground: async (_task, input: JsonValue) => {
          if (input !== null) return { ok: false, error: { ...makeError('invalid-input') } };
          return receipt(() => harness.stopForeground());
        },
      });
    },
  });
}

// Generic loading cannot manufacture the product ports or a model credential authority.
// The service uses createCorticoPlugin to mount the functioning provider through PluginManager.
export default definePlugin({
  activate(ctx) {
    ctx.provide('cortico', {
      status: async () => ({
        status: 'unavailable',
        reason: 'The service must bind product ports with createCorticoPlugin.',
      }),
    });
  },
});
