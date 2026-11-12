import { definePlugin } from '@pet/plugin-sdk';
import { SPEECH_FORMAT } from '@pet/contracts';

/** Main binds this source's lifetime to the single Pet playback owner. */
export default definePlugin({
  activate(context) {
    context.provide('renderer', {
      describe: async () => ({ ...SPEECH_FORMAT, streaming: true, renderer: true }),
    });
  },
});
