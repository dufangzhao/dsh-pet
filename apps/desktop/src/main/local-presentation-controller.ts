import {
  APPLICATION_PLUGIN_IDS,
  DESKTOP_PRESENTATION_KEYS,
  makeError,
  type DesktopPresentationPreferences,
  type DesktopPresentationSnapshot,
  type Result,
  type JsonObject,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { exactKeys, record } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
const identity = { pluginId: APPLICATION_PLUGIN_IDS.profile, instanceId: 'default' };
const failure = <T>(code: Parameters<typeof makeError>[0]): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
export class LocalPresentationController {
  constructor(
    private readonly host: DesktopHost,
    private readonly desktop: () => { available: boolean; shown: boolean },
    private readonly changed: () => void,
    private readonly apply: (preferences: DesktopPresentationPreferences) => void,
  ) {}
  async snapshot(): Promise<DesktopPresentationSnapshot> {
    const entry = this.host.manager.get(identity);
    if (!entry || !this.host.manager.isActive(entry.owner))
      return {
        version: 1,
        revision: 0,
        preferences: null,
        desktop: this.desktop(),
        error: makeError('not-ready', false),
      };
    const current = await this.host.configs.get(identity);
    if (!current.ok)
      return {
        version: 1,
        revision: 0,
        preferences: null,
        desktop: this.desktop(),
        error: current.error,
      };
    const preferences = Object.fromEntries(
      DESKTOP_PRESENTATION_KEYS.map((key) => [key, current.value.data[key]]),
    ) as unknown as DesktopPresentationPreferences;
    return {
      version: 1,
      revision: current.value.revision,
      preferences,
      desktop: this.desktop(),
      error: null,
    };
  }
  async refresh(): Promise<void> {
    const state = await this.snapshot();
    if (state.preferences) this.apply(state.preferences);
    this.changed();
  }
  async save(
    expectedRevision: number,
    patch: JsonObject,
  ): Promise<Result<DesktopPresentationSnapshot>> {
    if (
      !Object.keys(patch).length ||
      Object.keys(patch).some(
        (key) => !(DESKTOP_PRESENTATION_KEYS as readonly string[]).includes(key),
      )
    )
      return failure('permission-denied');
    const entry = this.host.manager.get(identity);
    if (!entry || !this.host.manager.isActive(entry.owner)) return failure('not-ready');
    const current = await this.host.configs.get(identity);
    if (!current.ok) return current;
    const saved = await this.host.configs.save(
      identity,
      { ...current.value.data, ...patch },
      expectedRevision,
    );
    if (!saved.ok) return saved;
    await this.refresh();
    return { ok: true, value: await this.snapshot() };
  }
}
export async function handleDesktopPresentationRequest(
  source: PetRequestSource,
  action: 'snapshot' | 'save',
  args: readonly unknown[],
  controller: LocalPresentationController,
): Promise<Result<DesktopPresentationSnapshot>> {
  if (!isTrustedPetSource(source)) return failure('permission-denied');
  if (action === 'snapshot')
    return args.length
      ? failure('invalid-input')
      : { ok: true, value: await controller.snapshot() };
  if (args.length !== 1) return failure('invalid-input');
  const checked = jsonPreflight(args[0]);
  const body = checked.ok ? record(checked.value) : null;
  const patch = body ? record(body['patch'] ?? null) : null;
  if (
    !body ||
    !patch ||
    !exactKeys(body, ['expectedRevision', 'patch']) ||
    typeof body['expectedRevision'] !== 'number' ||
    !Number.isSafeInteger(body['expectedRevision']) ||
    body['expectedRevision'] < 0
  )
    return failure('invalid-input');
  return controller.save(body['expectedRevision'], patch);
}
