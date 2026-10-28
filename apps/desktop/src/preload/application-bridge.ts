import {
  APPLICATION_IPC as IPC,
  makeError,
  type ApplicationBridge,
  type ApplicationSnapshot,
  type ApplicationHistoryPage,
  type JsonValue,
  type Result,
} from '@pet/contracts';
export function createApplicationBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: (listener: () => void) => () => void,
): ApplicationBridge {
  const fixed =
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
    getSnapshot: fixed<ApplicationSnapshot>(IPC.snapshot, 0),
    getHistory: fixed<ApplicationHistoryPage>(IPC.history, 1),
    onChanged(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected callback');
      return subscribe(args[0] as () => void);
    },
    saveProfile: fixed<ApplicationSnapshot>(IPC.profile, 1),
    interact: fixed<null>(IPC.interaction, 1),
    answer: fixed<ApplicationSnapshot>(IPC.answer, 1),
    startGuide: fixed<ApplicationSnapshot>(IPC.guide, 0),
    runPageAction: fixed<JsonValue>(IPC.pageAction, 1),
  });
}
