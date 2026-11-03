import {
  PRESENTATION_IPC,
  isPetAppearanceChange,
  isPetAppearanceCompletion,
  isPetAppearanceRequest,
  isPetPresentationTheme,
  makeError,
  type PetAppearanceRequest,
  type PetPresentationBridge,
  type PetPresentationSnapshot,
  type Result,
} from '@pet/contracts';
type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export function createPresentationBridge(
  invoke: Invoke,
  subscribe: (listener: () => void) => () => void,
  subscribeAppearanceRequested: (listener: (request: unknown) => void) => () => void,
): PetPresentationBridge {
  const fail = (): Result<never> => ({ ok: false, error: makeError('invalid-input', false) });
  const call = async <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => {
    try {
      return (await invoke(channel, ...args)) as Result<T>;
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  };
  return Object.freeze({
    version: 1 as const,
    getSnapshot(...args: unknown[]) {
      return args.length
        ? Promise.resolve(fail())
        : call<PetPresentationSnapshot>(PRESENTATION_IPC.snapshot);
    },
    publishTheme(...args: unknown[]) {
      return args.length === 1 && isPetPresentationTheme(args[0])
        ? call<PetPresentationSnapshot>(PRESENTATION_IPC.publish, args[0])
        : Promise.resolve(fail());
    },
    setAppearance(...args: unknown[]) {
      return args.length === 1 && isPetAppearanceChange(args[0])
        ? call<PetPresentationSnapshot>(PRESENTATION_IPC.setAppearance, args[0])
        : Promise.resolve(fail());
    },
    completeAppearance(...args: unknown[]) {
      return args.length === 1 && isPetAppearanceCompletion(args[0])
        ? call<null>(PRESENTATION_IPC.completeAppearance, args[0])
        : Promise.resolve(fail());
    },
    onAppearanceRequested(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected appearance callback');
      const listener = args[0] as (request: PetAppearanceRequest) => void;
      return subscribeAppearanceRequested((request) => {
        if (isPetAppearanceRequest(request))
          listener({ id: request.id, appearance: request.appearance });
      });
    },
    onChanged(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected presentation listener');
      return subscribe(args[0] as () => void);
    },
  });
}
