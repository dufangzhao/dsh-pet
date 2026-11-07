import { definePlugin } from '@pet/plugin-sdk';
import type { PluginTask } from '@pet/plugin-sdk';
import type { JsonValue } from '@pet/contracts';
import { makeError } from '@pet/contracts';
import { SqliteState } from './state.js';
import { STATE_METHODS } from './types.js';

export { SqliteState } from './state.js';
export * from './types.js';

export default definePlugin({
  activate(ctx) {
    const dataDirectory = ctx.dataDirectory;
    if (!dataDirectory) throw new Error('state-data-directory-required');
    let state: SqliteState | undefined;
    ctx.effect(() => {
      const opened = new SqliteState({ dataDirectory });
      state = opened;
      return () => {
        opened.close();
        state = undefined;
      };
    });
    ctx.provide(
      'sqlite',
      Object.fromEntries(
        STATE_METHODS.map((method) => [
          method,
          async (task: PluginTask, input: JsonValue) => {
            const result = task.signal.aborted
              ? { ok: false, error: makeError('cancelled') }
              : state
                ? state.invoke(method, input)
                : { ok: false, error: makeError('not-ready') };
            // These validated data-only Result shapes are JSON, distinct from transport Result.
            return JSON.parse(JSON.stringify(result)) as JsonValue;
          },
        ]),
      ),
    );
  },
});
