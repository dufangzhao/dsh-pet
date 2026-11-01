import { definePlugin } from '@pet/plugin-sdk';
import { APPLICATION_DEFAULTS } from '@pet/contracts';
import type { JsonValue, JsonObject } from '@pet/contracts';
const object = (value: JsonValue): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
export default definePlugin({
  async migrateConfig(request) {
    if (request.fromVersion !== 1 || request.toVersion !== 2)
      throw new Error('unsupported-profile-version');
    return { ...structuredClone(APPLICATION_DEFAULTS), ...request.data };
  },
  activate(ctx) {
    ctx.provide('profile', {
      read: async () => {
        const current = await ctx.host.config.get();
        return current.ok
          ? { owner: { ...ctx.owner }, revision: current.value.revision, data: current.value.data }
          : { errorCode: current.error.code };
      },
      change: async (task, input) => {
        const body = object(input);
        const patch = body ? object(body['patch'] ?? null) : null;
        if (
          !body ||
          !patch ||
          !Number.isSafeInteger(body['expectedRevision']) ||
          (body['expectedRevision'] as number) < 1
        )
          return { errorCode: 'invalid-input' };
        if (!ctx.host.config.save) return { errorCode: 'not-ready' };
        const current = await ctx.host.config.get();
        if (!current.ok) return { errorCode: current.error.code };
        if (current.value.revision !== body['expectedRevision']) return { errorCode: 'conflict' };
        const saved = await ctx.host.config.save(
          task,
          { ...current.value.data, ...patch },
          current.value.revision,
        );
        return saved.ok
          ? {
              owner: { ...ctx.owner },
              revision: saved.value.snapshot.revision,
              data: saved.value.snapshot.data,
              changeMode: saved.value.changeMode,
            }
          : { errorCode: saved.error.code };
      },
    });
  },
});
