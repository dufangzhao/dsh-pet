import {
  isSettingsOpenRequest,
  makeError,
  type Result,
  type SettingsOpenRequest,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';

export async function handleSettingsOpenRequest(
  source: PetRequestSource,
  args: readonly unknown[],
  open: () => void | Promise<void>,
  navigate: (request: SettingsOpenRequest) => void | Promise<void>,
): Promise<Result<null>> {
  if (!isTrustedPetSource(source))
    return { ok: false, error: makeError('permission-denied', false) };
  let request: SettingsOpenRequest | undefined;
  if (args.length !== 0) {
    const checked = args.length === 1 ? jsonPreflight(args[0]) : null;
    if (!checked?.ok || !isSettingsOpenRequest(checked.value))
      return { ok: false, error: makeError('invalid-input', false) };
    request = checked.value;
  }
  try {
    await open();
    if (request) await navigate(request);
    return { ok: true, value: null };
  } catch {
    return { ok: false, error: makeError('unavailable', false) };
  }
}
