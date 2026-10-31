import {
  MODEL_CONNECTION_IPC as IPC,
  makeError,
  type ModelConnectionBridge,
  type ModelSignInStatus,
  type ModelConnectionSnapshot,
  type ModelConnectionOutcome,
  type ModelCatalogResult,
  type ModelDraftTestOutcome,
  type Result,
} from '@pet/contracts';
export function createModelConnectionBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): ModelConnectionBridge {
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
    getSnapshot: fixed<ModelConnectionSnapshot>(IPC.snapshot, 0),
    startSignIn: fixed<ModelSignInStatus>(IPC.signIn, 0),
    getSignInState: fixed<ModelSignInStatus>(IPC.signInState, 0),
    cancelSignIn: fixed<ModelSignInStatus>(IPC.signInCancel, 0),
    setPaused: fixed<ModelConnectionSnapshot>(IPC.run, 1),
    saveAndStart: fixed<ModelConnectionOutcome>(IPC.save, 1),
    testConnection: fixed<ModelConnectionOutcome>(IPC.test, 0),
    getModels: fixed<ModelCatalogResult>(IPC.models, 1),
    testSelected: fixed<ModelDraftTestOutcome>(IPC.testSelected, 1),
    openServicePage: fixed<null>(IPC.open, 1),
  });
}
