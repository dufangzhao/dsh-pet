import {
  makeError,
  type ConsoleBridge,
  type ConsoleSnapshot,
  type HostStatus,
  type Result,
  type SettingsLauncher,
} from '@pet/contracts';
function parameterless<T>(invoke: () => Promise<Result<T>>) {
  return async (...args: unknown[]): Promise<Result<T>> => {
    if (args.length) return { ok: false, error: makeError('invalid-input', false) };
    try {
      return await invoke();
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  };
}
function unary<A, T>(invoke: (input: A) => Promise<Result<T>>) {
  return async (...args: unknown[]): Promise<Result<T>> => {
    if (args.length !== 1) return { ok: false, error: makeError('invalid-input', false) };
    try {
      return await invoke(args[0] as A);
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  };
}
export function createConsoleBridge(
  read: () => Promise<Result<ConsoleSnapshot>>,
  stop: () => Promise<Result<HostStatus>>,
  config: Pick<ConsoleBridge, 'inspectConfig' | 'saveConfig'>,
): ConsoleBridge {
  return Object.freeze({
    version: 1 as const,
    getSnapshot: parameterless(read),
    stopAll: parameterless(stop),
    inspectConfig: unary(config.inspectConfig),
    saveConfig: unary(config.saveConfig),
  });
}
export function createSettingsLauncher(open: () => Promise<Result<null>>): SettingsLauncher {
  return Object.freeze({ open: parameterless(open) });
}
