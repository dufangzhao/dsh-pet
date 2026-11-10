import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import { COMPANION_MAX_TEXT, VOICE_MAX_PCM_BYTES, VOICE_SAMPLE_RATE } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { NativeAsrInput, VoiceAsrPortsFor } from '@pet/companion-runtime';
import { pcmWave } from '@pet/audio-capture/wave';
import { normalizeAsrCatalog, parseMagpieAsrSettings } from './config.js';
export {
  parseMagpieAsrSettings,
  resolveMiMoAsr,
  normalizeAsrCatalog,
  classifyVoiceModel,
} from './config.js';

async function wave(input: NativeAsrInput, signal: AbortSignal): Promise<Uint8Array> {
  if (
    input.format.encoding !== 'f32le' ||
    input.format.sampleRate !== VOICE_SAMPLE_RATE ||
    input.format.channels !== 1 ||
    !Number.isSafeInteger(input.samples) ||
    input.samples < 0 ||
    input.samples * 4 > VOICE_MAX_PCM_BYTES
  )
    throw new KernelFault('audio-format');
  const raw = new Uint8Array(input.samples * 4);
  let offset = 0;
  try {
    for await (const frame of input.audio) {
      signal.throwIfAborted();
      if (!frame.byteLength || frame.byteLength % 4 || offset + frame.byteLength > raw.byteLength)
        throw new KernelFault('audio-format');
      raw.set(frame, offset);
      offset += frame.byteLength;
    }
  } finally {
    input.audio.cancel();
  }
  if (offset !== raw.byteLength) throw new KernelFault('audio-format');
  const samples = new Float32Array(input.samples),
    view = new DataView(raw.buffer);
  for (let n = 0; n < samples.length; n++) samples[n] = view.getFloat32(n * 4, true);
  try {
    return pcmWave(samples);
  } catch {
    throw new KernelFault('audio-format');
  }
}
export function createMagpieAsrPlugin(portsFor: VoiceAsrPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const settings = parseMagpieAsrSettings(context.config);
      const ports = portsFor(context);
      const transport = ports.authorizedMagpie(settings.baseUrl);
      context.provide('magpie', {
        describe: async () => ({ role: 'asr', protocols: ['mimo-native'], synthetic: false }),
      });
      context.effect(() => () => transport.close());
      context.effect(() =>
        ports.bind({
          catalog: async (signal) => normalizeAsrCatalog(await transport.catalog(signal)),
          transcribe: async (input, signal) => {
            if (!settings.modelRef) throw new KernelFault('not-ready');
            if (input.modelRef !== settings.modelRef) throw new KernelFault('permission-denied');
            const wav = await wave(input, signal);
            if (!input.samples) return { kind: 'no-speech' };
            const value = await transport.mimoAsr({ modelRef: settings.modelRef, wav }, signal);
            if (
              !value ||
              typeof value !== 'object' ||
              !('choices' in value) ||
              !Array.isArray(value.choices)
            )
              throw new KernelFault('asr-failed');
            const choice = value.choices[0];
            if (
              !choice ||
              typeof choice !== 'object' ||
              !choice.message ||
              typeof choice.message !== 'object'
            )
              throw new KernelFault('asr-failed');
            const message = choice.message;
            if (
              typeof message.content !== 'string' ||
              message.tool_calls?.length ||
              message.function_call ||
              choice.finish_reason === 'length' ||
              choice.finish_reason === 'tool_calls'
            )
              throw new KernelFault('asr-failed');
            const text = message.content.trim();
            if (text.length > COMPANION_MAX_TEXT) throw new KernelFault('quota-exceeded');
            return text ? { kind: 'final', text } : { kind: 'no-speech' };
          },
        }),
      );
    },
  });
}
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
