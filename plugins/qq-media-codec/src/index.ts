import { definePlugin, type PluginContext, type PluginDefinition } from '@pet/plugin-sdk';
import { KernelFault } from '@pet/host-kernel';
import type { JsonObject } from '@pet/contracts';
import { CodecDockerRunner, type CodecImagePin } from './job.js';

export {
  CodecDockerRunner,
  type CodecImagePin,
  type CodecOutput,
  type CodecJobReceipt,
} from './job.js';
export type QqCodecNative = {
  readonly decode: CodecDockerRunner['decode'];
  readonly encode: CodecDockerRunner['encode'];
  describe(): Promise<{ imageId: string; manifestSha256: string; available: boolean }>;
};
export type QqCodecPortsFor = (context: PluginContext) => {
  bind(native: QqCodecNative): () => Promise<void>;
};
export function parseCodecConfig(value: JsonObject): CodecImagePin {
  if (
    Object.keys(value).length !== 2 ||
    typeof value['imageId'] !== 'string' ||
    typeof value['manifestSha256'] !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value['imageId']) ||
    !/^[a-f0-9]{64}$/.test(value['manifestSha256'])
  )
    throw new KernelFault('not-ready');
  return { imageId: value['imageId'], manifestSha256: value['manifestSha256'] };
}
/** Activation only binds ports. Native Docker inspection/work starts under the host's active-source authority. */
export function createQqMediaCodecPlugin(portsFor: QqCodecPortsFor): PluginDefinition {
  return definePlugin({
    activate(context) {
      const ports = portsFor(context);
      let pending: Promise<CodecDockerRunner> | undefined;
      let runner: CodecDockerRunner | undefined;
      const get = (): Promise<CodecDockerRunner> => {
        context.signal.throwIfAborted();
        if (!context.dataDirectory) throw new KernelFault('not-ready');
        const directory = context.dataDirectory;
        return (pending ??= CodecDockerRunner.create({
          directory,
          pin: parseCodecConfig(context.config),
          sourceSignal: context.signal,
        }).then((value) => {
          runner = value;
          return value;
        }));
      };
      const native: QqCodecNative = {
        decode: async (input, consume, signal) => (await get()).decode(input, consume, signal),
        encode: async (input, consume, signal) => (await get()).encode(input, consume, signal),
        describe: async () => {
          const value = await get();
          const pin = parseCodecConfig(context.config);
          return { ...pin, available: value.reusable };
        },
      };
      context.effect(() => async () => {
        // A rejected preflight allocated no codec container, but its actual CLI still has to settle.
        if (pending)
          await pending.then(
            () => {},
            () => {},
          );
        if (runner) await runner.close();
      });
      context.effect(() => ports.bind(native));
      context.provide('docker', { describe: async () => native.describe() });
    },
  });
}
export default definePlugin({
  activate() {
    throw new KernelFault('not-ready');
  },
});
