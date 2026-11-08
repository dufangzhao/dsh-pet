import { definePlugin } from '@pet/plugin-sdk';
export default definePlugin({
  activate(context) {
    context.provide('client', {
      describe: async () => {
        const current = await context.host.config.get();
        if (!current.ok) return { errorCode: current.error.code };
        return {
          version: 1,
          baseUrl: current.value.data['baseUrl'] ?? '',
          configRevision: current.value.revision,
        };
      },
    });
  },
});
