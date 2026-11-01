import { definePlugin } from '@pet/plugin-sdk';
import { LOCAL_ASR_MAX_SECONDS, LOCAL_ASR_SAMPLE_RATE, type JsonValue } from '@pet/contracts';
import { transcribeOpenAI } from './transcription.js';
export default definePlugin({
  activate(ctx) {
    ctx.provide('openai', {
      prepare: async () => ({ modelId: 'openai', errorCode: null }),
      transcribe: async (task, input) => {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          input['model'] !== 'openai' ||
          typeof input['cloudModel'] !== 'string' ||
          typeof input['cloudBaseUrl'] !== 'string'
        )
          return { text: '', errorCode: 'invalid-input' };
        const model = input['cloudModel'],
          baseUrl = input['cloudBaseUrl'];
        const opened = await ctx.host.media.openInput(task);
        if (!opened.ok) return { text: '', errorCode: opened.error.code };
        const output = await ctx.host.media.openOutput(task);
        if (!output.ok) {
          opened.value.cancel();
          return { text: '', errorCode: output.error.code };
        }
        try {
          const chunks: Float32Array[] = [];
          let count = 0;
          for await (const bytes of opened.value) {
            if (
              bytes.byteLength % 4 ||
              count + bytes.byteLength / 4 > LOCAL_ASR_MAX_SECONDS * LOCAL_ASR_SAMPLE_RATE
            )
              throw new Error('audio-format');
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
              chunk = new Float32Array(bytes.byteLength / 4);
            for (let i = 0; i < chunk.length; i++) {
              const sample = view.getFloat32(i * 4, true);
              if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('audio-format');
              chunk[i] = sample;
            }
            count += chunk.length;
            chunks.push(chunk);
          }
          const samples = new Float32Array(count);
          let offset = 0;
          for (const chunk of chunks) {
            samples.set(chunk, offset);
            offset += chunk.length;
          }
          if (!ctx.host.credentials) return { text: '', errorCode: 'not-ready' };
          const used = await ctx.host.credentials.withSecret(task, 'api-key', (key, signal) =>
            transcribeOpenAI(samples, model, key, signal, fetch, baseUrl),
          );
          const result: JsonValue = used.ok ? used.value : { text: '', errorCode: used.error.code };
          if (
            result &&
            typeof result === 'object' &&
            !Array.isArray(result) &&
            typeof result['text'] === 'string' &&
            result['text']
          ) {
            const sent = await output.value.write(new TextEncoder().encode(result['text']));
            if (!sent.ok) return { text: '', errorCode: sent.error.code };
          }
          const ended = await output.value.end();
          return ended.ok ? result : { text: '', errorCode: ended.error.code };
        } catch {
          return { text: '', errorCode: task.signal.aborted ? 'cancelled' : 'audio-format' };
        } finally {
          opened.value.cancel();
          output.value.cancel();
        }
      },
    });
  },
});
