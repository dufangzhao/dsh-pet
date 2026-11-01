import {
  DEMO_IPC,
  makeError,
  type DemoBridge,
  type DemoSnapshot,
  type DemoCaptureTicket,
  type DemoRecordingReceipt,
  type Result,
} from '@pet/contracts';
export function createDemoBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  listen: (listener: () => void) => () => void,
  listenRecording?: (listener: (request: DemoRecordingReceipt) => void) => () => void,
): DemoBridge {
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
    version: 1,
    getSnapshot: call<DemoSnapshot>(DEMO_IPC.snapshot, 0),
    beginRecording: call<DemoCaptureTicket>(DEMO_IPC.record, 0),
    requestRecording: call<DemoRecordingReceipt>(DEMO_IPC.requestRecording, 1),
    onRecordingRequested(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected recording callback');
      if (!listenRecording) throw new TypeError('Recording requests unavailable');
      return listenRecording((request) => {
        if (
          request &&
          typeof request.id === 'string' &&
          ['toggle', 'finish', 'cancel'].includes(request.action)
        )
          (args[0] as (request: DemoRecordingReceipt) => void)({
            id: request.id,
            action: request.action,
          });
      });
    },
    captureReady: call<null>(DEMO_IPC.ready, 1),
    pushAudio: call<null>(DEMO_IPC.pcm, 2),
    finishRecording: call<null>(DEMO_IPC.finish, 1),
    reportCaptureError: call<null>(DEMO_IPC.captureError, 1),
    cancel: call<DemoSnapshot>(DEMO_IPC.cancel, 0),
    sendText: call<null>(DEMO_IPC.send, 1),
    clearHistory: call<DemoSnapshot>(DEMO_IPC.clear, 0),
    saveProviderKey: call<DemoSnapshot>(DEMO_IPC.key, 1),
    removeProviderKey: call<DemoSnapshot>(DEMO_IPC.removeKey, 0),
    onChanged(...args: unknown[]) {
      if (args.length !== 1 || typeof args[0] !== 'function')
        throw new TypeError('Expected demo callback');
      return listen(args[0] as () => void);
    },
  });
}
