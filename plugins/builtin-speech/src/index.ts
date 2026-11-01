import { definePlugin } from '@pet/plugin-sdk';
import { isSpeechOutputRequest, SPEECH_OUTPUT_SAMPLE_RATE } from '@pet/contracts';
import { synthesizePetTones } from './tones.js';

export default definePlugin({
  activate(ctx) {
    ctx.provide('tones', {
      synthesize: async (task, input) => {
        if (!isSpeechOutputRequest(input)) return { errorCode: 'invalid-input' };
        const bytes = synthesizePetTones(input.text, task.signal);
        const opened = await ctx.host.media.openOutput(task);
        if (!opened.ok) return { errorCode: opened.error.code };
        try {
          for (let offset = 0; offset < bytes.byteLength; offset += 65536) {
            task.signal.throwIfAborted();
            const sent = await opened.value.write(bytes.slice(offset, offset + 65536));
            if (!sent.ok) return { errorCode: sent.error.code };
          }
          const ended = await opened.value.end();
          if (!ended.ok) return { errorCode: ended.error.code };
          return {
            utteranceId: input.utteranceId,
            codec: 'pcm-s16le',
            sampleRate: SPEECH_OUTPUT_SAMPLE_RATE,
            channels: 1,
            frames: bytes.byteLength / 2,
            media: { ...opened.value.reference, owner: { ...opened.value.reference.owner } },
          };
        } finally {
          opened.value.cancel();
        }
      },
    });
  },
});
