import {
  CONSOLE_IPC,
  makeError,
  type ConsoleBridge,
  type ConsoleSecuritySnapshot,
  type ConsoleSecurityChange,
  type ConsoleAuditPage,
  type Result,
} from '@pet/contracts';
export type SecurityBridge = Pick<
  ConsoleBridge,
  | 'getSecurity'
  | 'setTrust'
  | 'setPermissionPreset'
  | 'answerApproval'
  | 'getAudit'
  | 'onSecurityChanged'
  | 'restoreBuiltin'
>;
export function createSecurityBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  listen: (listener: () => void) => () => void,
): SecurityBridge {
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
    getSecurity: call<ConsoleSecuritySnapshot>(CONSOLE_IPC.security, 0),
    setTrust: call<ConsoleSecurityChange>(CONSOLE_IPC.trust, 1),
    setPermissionPreset: call<ConsoleSecurityChange>(CONSOLE_IPC.preset, 1),
    answerApproval: call<ConsoleSecurityChange>(CONSOLE_IPC.approval, 1),
    getAudit: call<ConsoleAuditPage>(CONSOLE_IPC.audit, 1),
    restoreBuiltin: call<ConsoleSecurityChange>(CONSOLE_IPC.restoreBuiltin, 1),
    onSecurityChanged(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected security callback');
      return listen(args[0] as () => void);
    },
  });
}
