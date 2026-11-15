/** Controlled model form; console-only. Import model.css explicitly. */
import { makeError } from '@pet/contracts';
import type { ModelTransport } from './client/model-form.js';
export { ModelDialog } from './client/model.js';
export type { ModelDialogProps } from './client/model.js';
export type { ModelTransport } from './client/model-form.js';

/** Native clients have no credential relay, even if a caller bypasses the hidden field. */
export function createReadOnlyModelTransport(
  actions: Pick<ModelTransport, 'saveModel' | 'testModel'>,
): ModelTransport {
  return {
    saveModel: (command) => actions.saveModel(command),
    testModel: (command) => actions.testModel(command),
    writeModelCredential: async () => ({ ok: false, error: makeError('permission-denied', false) }),
  };
}
