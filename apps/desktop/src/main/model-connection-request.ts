import { makeError, type Result } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { exactKeys, record, KernelFault, CredentialError } from '@pet/host-kernel';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
import type { ModelConnectionController } from './model-connection-controller.js';
export async function handleModelConnectionRequest(
  source: PetRequestSource,
  action: string,
  args: readonly unknown[],
  controller: ModelConnectionController,
): Promise<Result<unknown>> {
  const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
    ok: false,
    error: makeError(code, false),
  });
  if (!isTrustedPetSource(source)) return fail('permission-denied');
  try {
    if (['signIn', 'signInState', 'signInCancel'].includes(action)) {
      if (args.length) return fail('invalid-input');
      return action === 'signIn'
        ? await controller.startSignIn()
        : action === 'signInState'
          ? await controller.getSignInState()
          : await controller.cancelSignIn();
    }
    if (action === 'snapshot' || action === 'test') {
      if (args.length) return fail('invalid-input');
      return action === 'snapshot'
        ? { ok: true, value: await controller.snapshot() }
        : await controller.testConnection();
    }
    if (args.length !== 1) return fail('invalid-input');
    const safe = jsonPreflight(args[0]);
    const data = safe.ok ? record(safe.value) : null;
    if (!data) return fail('invalid-input');
    if (action === 'run')
      return exactKeys(data, ['paused']) && typeof data['paused'] === 'boolean'
        ? await controller.setPaused(data['paused'])
        : fail('invalid-input');
    const id = data['id'];
    if (typeof id !== 'string' || id.length > 128) return fail('invalid-input');
    if (action === 'open')
      return exactKeys(data, ['id']) ? await controller.openServicePage(id) : fail('invalid-input');
    const model = data['model'],
      revision = data['expectedRevision'],
      key = data['key'];
    if (
      action !== 'save' ||
      !exactKeys(data, [
        'id',
        'model',
        'expectedRevision',
        ...(Object.hasOwn(data, 'key') ? ['key'] : []),
      ]) ||
      typeof model !== 'string' ||
      model.length > 128 ||
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      (key !== undefined && (typeof key !== 'string' || key.length > 4096))
    )
      return fail('invalid-input');
    if (
      typeof key === 'string' &&
      [...key].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      return fail('invalid-input');
    return await controller.saveAndStart(id, model, revision, key);
  } catch (error) {
    return fail(
      error instanceof KernelFault
        ? error.error.code
        : error instanceof CredentialError
          ? error.code
          : 'unavailable',
    );
  }
}
