import {
  CONSOLE_IPC,
  isSettingsOpenRequest,
  makeError,
  type Result,
  type SettingsLauncher,
  type SettingsOpenRequest,
} from '@pet/contracts';

export function createSettingsLauncher(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribeNavigate: (listener: (request: unknown) => void) => () => void,
): SettingsLauncher {
  return Object.freeze({
    async open(...args: unknown[]): Promise<Result<null>> {
      if (args.length !== 0 && (args.length !== 1 || !isSettingsOpenRequest(args[0])))
        return { ok: false, error: makeError('invalid-input', false) };
      try {
        return (await invoke(CONSOLE_IPC.open, ...args)) as Result<null>;
      } catch {
        return { ok: false, error: makeError('unavailable', false) };
      }
    },
    onNavigate(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected settings navigation callback');
      const listener = args[0] as (request: SettingsOpenRequest) => void;
      return subscribeNavigate((request) => {
        if (isSettingsOpenRequest(request)) listener({ view: request.view });
      });
    },
  });
}
