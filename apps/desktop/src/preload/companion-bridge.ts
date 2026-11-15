import {
  DESKTOP_COMPANION_IPC,
  DESKTOP_LOCAL_HOST_IPC,
  DESKTOP_PRESENTATION_IPC,
  makeError,
  type DesktopCompanionBridge,
  type DesktopLocalHostBridge,
  type DesktopPresentationBridge,
  type DesktopPresentationSnapshot,
  type Result,
} from '@pet/contracts';
type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
function call<T>(invoke: Invoke, channel: string, count: number) {
  return async (...args: unknown[]): Promise<Result<T>> => {
    if (args.length !== count) return { ok: false, error: makeError('invalid-input', false) };
    try {
      return (await invoke(channel, ...args)) as Result<T>;
    } catch {
      return { ok: false, error: makeError('unavailable', false) };
    }
  };
}
function subscription(listen: (listener: () => void) => () => void) {
  return (listener: () => void): (() => void) => {
    if (typeof listener !== 'function') throw new TypeError('Expected callback');
    return listen(listener);
  };
}
export function createDesktopCompanionBridge(
  invoke: Invoke,
  listen: (listener: () => void) => () => void,
): DesktopCompanionBridge {
  const methods = Object.fromEntries(
    Object.entries(DESKTOP_COMPANION_IPC)
      .filter(([name]) => name !== 'changed')
      .map(([name, channel]) => [name, call(invoke, channel, name === 'getState' ? 0 : 1)]),
  );
  return Object.freeze({
    ...methods,
    version: 1,
    onChanged: subscription(listen),
  }) as unknown as DesktopCompanionBridge;
}
export function createDesktopLocalHostBridge(
  invoke: Invoke,
  listen: (listener: () => void) => () => void,
): DesktopLocalHostBridge {
  const methods = Object.fromEntries(
    Object.entries(DESKTOP_LOCAL_HOST_IPC)
      .filter(([name]) => name !== 'changed')
      .map(([name, channel]) => [
        name,
        call(invoke, channel, name === 'getState' || name === 'start' ? 0 : 1),
      ]),
  );
  return Object.freeze({
    ...methods,
    version: 1,
    onChanged: subscription(listen),
  }) as unknown as DesktopLocalHostBridge;
}
export function createDesktopPresentationBridge(
  invoke: Invoke,
  listen: (listener: () => void) => () => void,
): DesktopPresentationBridge {
  return Object.freeze({
    version: 1,
    getSnapshot: call<DesktopPresentationSnapshot>(invoke, DESKTOP_PRESENTATION_IPC.snapshot, 0),
    save: call<DesktopPresentationSnapshot>(invoke, DESKTOP_PRESENTATION_IPC.save, 1),
    onChanged: subscription(listen),
  });
}
