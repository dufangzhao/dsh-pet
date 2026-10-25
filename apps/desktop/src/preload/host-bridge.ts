import { makeError, type HostStatus, type HostStatusBridge, type Result } from '@pet/contracts';
export function createHostStatusBridge(
  invoke: () => Promise<Result<HostStatus>>,
): HostStatusBridge {
  return Object.freeze({
    version: 1 as const,
    getStatus: async (...args: unknown[]): Promise<Result<HostStatus>> => {
      if (args.length) return { ok: false, error: makeError('invalid-input', false) };
      try {
        return await invoke();
      } catch {
        return { ok: false, error: makeError('unavailable', false) };
      }
    },
  });
}
