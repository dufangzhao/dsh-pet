import {
  SPEECH_OUTPUT_IPC,
  MEDIA_MAX_CHUNK_BYTES,
  makeError,
  type Result,
  type SpeechOutputBridge,
  type SpeechOutputSnapshot,
  type SpeechOutputAudioEvent,
} from '@pet/contracts';

export function createSpeechOutputBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  listenChanged: (listener: () => void) => () => void,
  listenAudio: (
    listener: (event: SpeechOutputAudioEvent, payload?: Uint8Array) => void,
  ) => () => void,
): SpeechOutputBridge {
  const call =
    <T>(channel: string, count: number) =>
    async (...args: unknown[]): Promise<Result<T>> => {
      if (args.length !== count) return { ok: false, error: makeError('invalid-input', false) };
      try {
        return (await invoke(channel, ...args)) as Result<T>;
      } catch {
        return { ok: false, error: makeError('unavailable', false) };
      }
    };
  return Object.freeze({
    version: 1,
    getSnapshot: call<SpeechOutputSnapshot>(SPEECH_OUTPUT_IPC.snapshot, 0),
    speak: call<null>(SPEECH_OUTPUT_IPC.speak, 1),
    stop: call<SpeechOutputSnapshot>(SPEECH_OUTPUT_IPC.stop, 0),
    saveSettings: call<SpeechOutputSnapshot>(SPEECH_OUTPUT_IPC.saveSettings, 1),
    reportPlayback: call<null>(SPEECH_OUTPUT_IPC.playback, 1),
    onChanged(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected speech callback');
      return listenChanged(args[0] as () => void);
    },
    onAudio(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected speech audio callback');
      const listener = args[0] as (event: SpeechOutputAudioEvent, payload?: Uint8Array) => void;
      return listenAudio((event, payload) => {
        if (event.kind === 'chunk') {
          if (
            !(payload instanceof Uint8Array) ||
            !payload.byteLength ||
            payload.byteLength > MEDIA_MAX_CHUNK_BYTES ||
            payload.byteLength !== event.byteLength
          )
            return;
          listener(event, Uint8Array.from(payload));
        } else if (payload === undefined) listener(event);
      });
    },
  });
}
