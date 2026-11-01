import {
  PRESENTATION_IPC,
  isPetPresentationTheme,
  makeError,
  type PetPresentationBridge,
  type PetPresentationSnapshot,
  type Result,
} from '@pet/contracts';
type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export function createPresentationBridge(
  invoke: Invoke,
  subscribe: (listener: () => void) => () => void,
): PetPresentationBridge {
  const fail = (): Result<PetPresentationSnapshot> => ({
    ok: false,
    error: makeError('invalid-input', false),
  });
  const call = async (
    channel: string,
    ...args: unknown[]
  ): Promise<Result<PetPresentationSnapshot>> => {
    try {
      return (await invoke(channel, ...args)) as Result<PetPresentationSnapshot>;
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  };
  return Object.freeze({
    version: 1 as const,
    getSnapshot(...args: unknown[]) {
      return args.length ? Promise.resolve(fail()) : call(PRESENTATION_IPC.snapshot);
    },
    publishTheme(...args: unknown[]) {
      return args.length === 1 && isPetPresentationTheme(args[0])
        ? call(PRESENTATION_IPC.publish, args[0])
        : Promise.resolve(fail());
    },
    onChanged(listener: () => void) {
      if (typeof listener !== 'function') throw new TypeError('Expected presentation listener');
      return subscribe(listener);
    },
  });
}
