import {
  VOICE_INPUT_IPC,
  makeError,
  type VoiceInputBridge,
  type VoiceInputSnapshot,
  type Result,
} from '@pet/contracts';
export function createVoiceInputBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  listen: (listener: () => void) => () => void,
): VoiceInputBridge {
  const call =
    (channel: string, count: number) =>
    async (...args: unknown[]): Promise<Result<VoiceInputSnapshot>> => {
      if (args.length !== count) return { ok: false, error: makeError('invalid-input', false) };
      try {
        return (await invoke(channel, ...args)) as Result<VoiceInputSnapshot>;
      } catch {
        return { ok: false, error: makeError('unavailable', false) };
      }
    };
  return Object.freeze({
    version: 1,
    getSnapshot: call(VOICE_INPUT_IPC.snapshot, 0),
    saveSettings: call(VOICE_INPUT_IPC.saveSettings, 1),
    saveApiKey: call(VOICE_INPUT_IPC.saveApiKey, 1),
    start: call(VOICE_INPUT_IPC.start, 0),
    stop: call(VOICE_INPUT_IPC.stop, 0),
    installModel: call(VOICE_INPUT_IPC.installModel, 1),
    onChanged(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected voice input callback');
      return listen(args[0] as () => void);
    },
  });
}
