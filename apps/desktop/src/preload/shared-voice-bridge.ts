import { DESKTOP_VOICE_IPC, makeError, type DesktopVoiceBridge, type Result } from '@pet/contracts';
type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export function createDesktopVoiceBridge(
  invoke: Invoke,
  listen: (listener: () => void) => () => void,
): DesktopVoiceBridge {
  const methods = Object.fromEntries(
    Object.entries(DESKTOP_VOICE_IPC)
      .filter(([name]) => name !== 'changed')
      .map(([name, channel]) => [
        name,
        async (...args: unknown[]): Promise<Result<unknown>> => {
          const count = name === 'getState' ? 0 : name === 'pushAudio' ? 2 : 1;
          if (args.length !== count) return { ok: false, error: makeError('invalid-input', false) };
          try {
            return (await invoke(channel, ...args)) as Result<unknown>;
          } catch {
            return { ok: false, error: makeError('unavailable', false) };
          }
        },
      ]),
  );
  return Object.freeze({
    ...methods,
    version: 1,
    onChanged(listener: () => void) {
      if (typeof listener !== 'function') throw new TypeError('Expected callback');
      return listen(listener);
    },
  }) as unknown as DesktopVoiceBridge;
}
