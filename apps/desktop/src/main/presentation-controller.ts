import {
  isPetPresentationTheme,
  makeError,
  type PetPresentationSnapshot,
  type PetPresentationTheme,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { isTrustedPetSource } from './ipc-request.js';
import type { DemoRequestSource } from './demo-request.js';
export class PresentationController {
  #theme: PetPresentationTheme | null = null;
  constructor(private readonly changed: () => void) {}
  snapshot(): PetPresentationSnapshot {
    return { version: 1, theme: this.#theme ? structuredClone(this.#theme) : null };
  }
  publish(theme: PetPresentationTheme): PetPresentationSnapshot {
    this.#theme = structuredClone(theme);
    this.changed();
    return this.snapshot();
  }
}
export function handlePresentationRequest(
  source: DemoRequestSource,
  action: 'snapshot' | 'publish',
  args: readonly unknown[],
  controller: PresentationController,
): Result<PetPresentationSnapshot> {
  if (!isTrustedPetSource(source) || (action === 'publish' && source.role !== 'console'))
    return { ok: false, error: makeError('permission-denied', false) };
  if (action === 'snapshot')
    return args.length === 0
      ? { ok: true, value: controller.snapshot() }
      : { ok: false, error: makeError('invalid-input', false) };
  const checked = args.length === 1 ? jsonPreflight(args[0]) : null;
  return checked?.ok && isPetPresentationTheme(checked.value)
    ? { ok: true, value: controller.publish(checked.value) }
    : { ok: false, error: makeError('invalid-input', false) };
}
