import { definePlugin } from '@pet/plugin-sdk';
export default definePlugin({
  activate(ctx) {
    ctx.provide('default', {
      describe: async () => ({
        renderer: 'original-minimal-svg',
        moods: ['idle', 'listening', 'thinking', 'responding', 'error'],
      }),
    });
  },
});
