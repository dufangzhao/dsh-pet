import { makeError, type Result } from '@pet/contracts';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
export async function handleConsoleRequest<T>(
  source: PetRequestSource,
  args: readonly unknown[],
  action: () => T | Promise<T>,
): Promise<Result<T>> {
  if (!isTrustedPetSource(source))
    return { ok: false, error: makeError('permission-denied', false) };
  if (args.length) return { ok: false, error: makeError('invalid-input', false) };
  try {
    return { ok: true, value: await action() };
  } catch {
    return { ok: false, error: makeError('unavailable', false) };
  }
}
