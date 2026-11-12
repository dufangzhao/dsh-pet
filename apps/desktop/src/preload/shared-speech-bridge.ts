import {
  DESKTOP_SPEECH_IPC,
  DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES,
  isDesktopSpeechAudioEvent,
  makeError,
  type DesktopSpeechBridge,
  type DesktopSpeechAudioEvent,
  type Result,
} from '@pet/contracts';
type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export function createDesktopSpeechBridge(
  invoke: Invoke,
  listen: (listener: () => void) => () => void,
  audio: (listener: (event: unknown, payload?: Uint8Array) => void) => () => void,
): DesktopSpeechBridge {
  async function call<T>(channel: string, args: unknown[], count = 1): Promise<Result<T>> {
    if (args.length !== count) return { ok: false, error: makeError('invalid-input', false) };
    try {
      return (await invoke(channel, ...args)) as Result<T>;
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  }
  return Object.freeze<DesktopSpeechBridge>({
    version: 1,
    getState: (...args) => call(DESKTOP_SPEECH_IPC.getState, args, 0),
    readSpeech: (...args) => call(DESKTOP_SPEECH_IPC.readSpeech, args),
    saveTtsProvider: (...args) => call(DESKTOP_SPEECH_IPC.saveTtsProvider, args),
    readTtsCatalog: (...args) => call(DESKTOP_SPEECH_IPC.readTtsCatalog, args),
    stop: (...args) => call(DESKTOP_SPEECH_IPC.stop, args),
    playerReady: (...args) => call(DESKTOP_SPEECH_IPC.playerReady, args),
    consume: (...args) => call(DESKTOP_SPEECH_IPC.consume, args),
    reportPlayback: (...args) => call(DESKTOP_SPEECH_IPC.reportPlayback, args),
    reportReleased: (...args) => call(DESKTOP_SPEECH_IPC.reportReleased, args),
    onChanged(listener: () => void) {
      if (typeof listener !== 'function') throw new TypeError('Expected callback');
      return listen(listener);
    },
    onAudio(listener: (event: DesktopSpeechAudioEvent, payload?: Uint8Array) => void) {
      if (typeof listener !== 'function') throw new TypeError('Expected callback');
      return audio((event, payload) => {
        if (!isDesktopSpeechAudioEvent(event)) throw new TypeError('Invalid speech event');
        if (event.kind === 'chunk') {
          if (
            !(payload instanceof Uint8Array) ||
            !(payload.buffer instanceof ArrayBuffer) ||
            payload.byteLength !== event.byteLength ||
            payload.byteLength > DESKTOP_SPEECH_IPC_MAX_CHUNK_BYTES
          )
            throw new TypeError('Invalid speech PCM');
          listener(event, Uint8Array.from(payload));
        } else {
          if (payload !== undefined) throw new TypeError('Unexpected speech PCM');
          listener(event);
        }
      });
    },
  });
}
