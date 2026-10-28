import { definePlugin } from '@pet/plugin-sdk';
import { LOCAL_ASR_MAX_SECONDS, LOCAL_ASR_SAMPLE_RATE } from '@pet/contracts';
import { LocalAsrEngine } from './engine.js';
import { localModel } from './model-store.js';
export default definePlugin({
  activate(ctx) {
    const engine = new LocalAsrEngine();
    ctx.effect(() => () => engine.close());
    ctx.provide('local', {
      status: async () => ({ modelId: engine.modelId, errorCode: engine.error }),
      prepare: async (task, input) => {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          return { errorCode: 'asr-failed' };
        let id: string;
        try {
          id = localModel(input['model']).id;
        } catch {
          return { errorCode: 'asr-failed' };
        }
        const result = await engine.prepare(id, task.signal);
        return {
          modelId: result.modelId ?? null,
          errorCode: result.ok ? null : (result.errorCode ?? 'asr-failed'),
        };
      },
      transcribe: async (task, input) => {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          input['model'] !== engine.modelId
        )
          return { modelId: engine.modelId, text: '', errorCode: 'not-ready' };
        const opened = await ctx.host.media.openInput(task);
        if (!opened.ok) return { errorCode: opened.error.code, text: '' };
        const output = await ctx.host.media.openOutput(task);
        if (!output.ok) {
          opened.value.cancel();
          return { errorCode: output.error.code, text: '' };
        }
        const chunks: Float32Array[] = [];
        let count = 0;
        try {
          for await (const bytes of opened.value) {
            if (
              bytes.byteLength % 4 ||
              count + bytes.byteLength / 4 > LOCAL_ASR_MAX_SECONDS * LOCAL_ASR_SAMPLE_RATE
            )
              throw new Error('audio-budget');
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
              owned = new Float32Array(bytes.byteLength / 4);
            for (let i = 0; i < owned.length; i++) {
              const sample = view.getFloat32(i * 4, true);
              if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('audio-format');
              owned[i] = sample;
            }
            count += owned.length;
            chunks.push(owned);
          }
          const samples = new Float32Array(count);
          let offset = 0;
          for (const chunk of chunks) {
            samples.set(chunk, offset);
            offset += chunk.length;
          }
          const result = await engine.recognize(samples, task.signal, async (text) => {
            const sent = await output.value.write(new TextEncoder().encode(text));
            if (!sent.ok) throw new Error('output-ended');
          });
          if (result.ok && result.text) {
            const sent = await output.value.write(new TextEncoder().encode(result.text));
            if (!sent.ok) throw new Error('output-ended');
          }
          const ended = await output.value.end();
          return {
            modelId: result.modelId ?? engine.modelId,
            text: result.text ?? '',
            errorCode: result.ok && ended.ok ? null : (result.errorCode ?? 'asr-failed'),
          };
        } catch {
          return { modelId: engine.modelId, text: '', errorCode: 'asr-failed' };
        } finally {
          opened.value.cancel();
          output.value.cancel();
        }
      },
    });
  },
});
