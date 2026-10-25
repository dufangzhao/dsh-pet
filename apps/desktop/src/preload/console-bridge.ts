import {
  makeError,
  type ConsoleBridge,
  type ConsoleSnapshot,
  type Result,
  type SettingsLauncher,
} from '@pet/contracts';
export function createConsoleBridge(invoke: () => Promise<Result<ConsoleSnapshot>>): ConsoleBridge {
  return Object.freeze({
    version: 1 as const,
    getSnapshot: async (...args: unknown[]): Promise<Result<ConsoleSnapshot>> => {
      if (args.length) return { ok: false, error: makeError('invalid-input', false) };
      try {
        return await invoke();
      } catch {
        return { ok: false, error: makeError('unavailable', false) };
      }
    },
  });
}
export function createSettingsLauncher(invoke: () => Promise<Result<null>>): SettingsLauncher {
  return Object.freeze({
    open: async (...args: unknown[]): Promise<Result<null>> => {
      if (args.length) return { ok: false, error: makeError('invalid-input', false) };
      try {
        return await invoke();
      } catch {
        return { ok: false, error: makeError('unavailable', false) };
      }
    },
  });
}
