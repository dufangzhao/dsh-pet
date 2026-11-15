import { definePlugin } from '@pet/plugin-sdk';
/** Device work is performed only by the bound console renderer under Main's lease. */
export default definePlugin({
  activate(context) {
    context.provide('renderer', {
      describe: async () => ({ encoding: 'f32le', sampleRate: 16000, channels: 1, renderer: true }),
    });
  },
});
