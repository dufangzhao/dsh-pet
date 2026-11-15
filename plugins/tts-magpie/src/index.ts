import { definePlugin, type PluginDefinition } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import { SPEECH_FORMAT, SPEECH_SEGMENT_MAX_CODE_POINTS, isSpeechFormat } from '@pet/contracts';
import type { SpeechTtsPortsFor } from '@pet/companion-runtime';
import { normalizeSpeechCatalog, parseMagpieSpeechSettings } from './config.js';
import { streamMiMoSpeech } from './stream.js';

export { parseMagpieSpeechSettings, normalizeSpeechCatalog, resolveMiMoSpeech } from './config.js';
export { streamMiMoSpeech, SpeechSseDecoder } from './stream.js';

export function createMagpieSpeechPlugin(portsFor: SpeechTtsPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const settings = parseMagpieSpeechSettings(context.config);
      const ports = portsFor(context);
      const transport = ports.authorizedMagpie(settings.baseUrl);
      context.provide('magpie', {
        describe: async () => ({
          role: 'tts',
          protocol: settings.protocol,
          format: { ...SPEECH_FORMAT },
          synthetic: false,
        }),
      });
      context.effect(() => () => transport.close());
      context.effect(() =>
        ports.bind({
          catalog: async (signal) => normalizeSpeechCatalog(await transport.catalog(signal)),
          synthesize: async (input, signal) => {
            if (
              !settings.modelRef ||
              input.modelRef !== settings.modelRef ||
              input.voice !== settings.voice ||
              !isSpeechFormat(input.format) ||
              typeof input.text !== 'string' ||
              !input.text.length ||
              [...input.text].length > SPEECH_SEGMENT_MAX_CODE_POINTS
            )
              throw new KernelFault('invalid-input');
            return streamMiMoSpeech(transport, input, signal);
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
