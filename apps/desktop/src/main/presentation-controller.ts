import { randomUUID } from 'node:crypto';
import {
  isPetAppearanceChange,
  isPetAppearanceCompletion,
  isPetPresentationTheme,
  makeError,
  type KernelErrorCode,
  type PetAppearanceChange,
  type PetAppearanceCompletion,
  type PetAppearanceRequest,
  type PetPresentationSnapshot,
  type PetPresentationTheme,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { isTrustedPetSource } from './ipc-request.js';
import type { DemoRequestSource } from './demo-request.js';

interface PendingAppearance {
  request: PetAppearanceRequest;
  published: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: Result<PetPresentationSnapshot>) => void;
}
function fail(code: KernelErrorCode): Result<never> {
  return { ok: false, error: makeError(code, false) };
}
export class PresentationController {
  #theme: PetPresentationTheme | null = null;
  #pending: PendingAppearance | null = null;
  constructor(
    private readonly changed: () => void,
    private readonly requestAppearance: (request: PetAppearanceRequest) => void,
  ) {}
  snapshot(): PetPresentationSnapshot {
    return { version: 1, theme: this.#theme ? structuredClone(this.#theme) : null };
  }
  publish(theme: PetPresentationTheme): PetPresentationSnapshot {
    this.#theme = structuredClone(theme);
    if (this.#pending)
      this.#pending.published = theme.appearance === this.#pending.request.appearance;
    this.changed();
    return this.snapshot();
  }
  setAppearance(change: PetAppearanceChange): Promise<Result<PetPresentationSnapshot>> {
    if (this.#pending) return Promise.resolve(fail('conflict'));
    const request = { id: randomUUID(), appearance: change.appearance };
    return new Promise((resolve) => {
      this.#pending = {
        request,
        published: false,
        resolve,
        timer: setTimeout(() => this.#finish(fail('timeout')), 5_000),
      };
      try {
        this.requestAppearance(request);
      } catch {
        this.#finish(fail('unavailable'));
      }
    });
  }
  completeAppearance(completion: PetAppearanceCompletion): Result<null> {
    const pending = this.#pending;
    if (!pending || completion.id !== pending.request.id) return fail('stale-owner');
    if (!completion.applied) {
      this.#finish(fail('unavailable'));
      return { ok: true, value: null };
    }
    // A positive receipt must follow a fresh publication from the saved theme owner.
    if (!pending.published || this.#theme?.appearance !== pending.request.appearance) {
      this.#finish(fail('conflict'));
      return fail('conflict');
    }
    this.#finish({ ok: true, value: this.snapshot() });
    return { ok: true, value: null };
  }
  ownerClosed(): void {
    this.#finish(fail('unavailable'));
  }
  #finish(result: Result<PetPresentationSnapshot>): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    clearTimeout(pending.timer);
    pending.resolve(result);
  }
}
export type PresentationAction = 'snapshot' | 'publish' | 'setAppearance' | 'completeAppearance';
export async function handlePresentationRequest(
  source: DemoRequestSource,
  action: PresentationAction,
  args: readonly unknown[],
  controller: PresentationController,
): Promise<Result<PetPresentationSnapshot | null>> {
  if (
    !isTrustedPetSource(source) ||
    ((action === 'publish' || action === 'completeAppearance') && source.role !== 'console')
  )
    return fail('permission-denied');
  if (action === 'snapshot')
    return args.length === 0 ? { ok: true, value: controller.snapshot() } : fail('invalid-input');
  const checked = args.length === 1 ? jsonPreflight(args[0]) : null;
  if (!checked?.ok) return fail('invalid-input');
  try {
    if (action === 'publish' && isPetPresentationTheme(checked.value))
      return { ok: true, value: controller.publish(checked.value) };
    if (action === 'setAppearance' && isPetAppearanceChange(checked.value))
      return await controller.setAppearance(checked.value);
    if (action === 'completeAppearance' && isPetAppearanceCompletion(checked.value))
      return controller.completeAppearance(checked.value);
    return fail('invalid-input');
  } catch {
    return fail('unavailable');
  }
}
