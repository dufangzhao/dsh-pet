import {
  makeError,
  type ConsolePluginChange,
  type ConsoleSnapshot,
  type KernelError,
  type Result,
} from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { ownerFrom, record, exactKeys } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';
const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
export class ConsolePluginRequests {
  readonly #pending = new Set<string>();
  constructor(
    private readonly host: Pick<DesktopHost, 'manager' | 'configs'>,
    private readonly snapshot: () => ConsoleSnapshot,
  ) {}
  async handle(
    source: PetRequestSource,
    args: readonly unknown[],
  ): Promise<Result<ConsolePluginChange>> {
    if (!isTrustedPetSource(source)) return fail('permission-denied');
    if (args.length !== 1) return fail('invalid-input');
    try {
      const safe = jsonPreflight(args[0]);
      const request = safe.ok ? record(safe.value) : null;
      if (!request || !exactKeys(request, ['owner', 'action'])) return fail('invalid-input');
      const owner = ownerFrom(request['owner']),
        action = request['action'];
      if (!owner || !['enable', 'disable', 'uninstall'].includes(action as string))
        return fail('invalid-input');
      const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId };
      const current = this.host.manager.get(identity);
      const reply = (operationError: KernelError | null): Result<ConsolePluginChange> => ({
        ok: true,
        value: { snapshot: this.snapshot(), operationError },
      });
      if (!current || current.owner.generation !== owner.generation)
        return reply(makeError('stale-owner', false));
      if (action !== 'enable' && current.protected)
        return reply(makeError('permission-denied', false));
      const key = JSON.stringify([owner.pluginId, owner.instanceId]);
      if (this.#pending.has(key)) return reply(makeError('rate-limited', false));
      this.#pending.add(key);
      try {
        let outcome: Result<unknown>;
        if (action === 'enable') {
          const lifetime = this.host.manager.ownerSignal(owner);
          const config = await this.host.configs.get(identity);
          if (!lifetime || lifetime.aborted) return reply(makeError('stale-owner', false));
          outcome = config.ok
            ? await this.host.manager.enable(identity, config.value.data)
            : config;
        } else if (action === 'disable') outcome = await this.host.manager.disable(identity);
        else outcome = await this.host.manager.uninstall(identity);
        let error = outcome.ok ? null : outcome.error;
        const after = this.host.manager.get(identity);
        if (
          outcome.ok &&
          action !== 'uninstall' &&
          after?.state !== (action === 'enable' ? 'active' : 'disabled')
        )
          error = after?.reason ?? makeError('not-ready', false);
        return reply(error);
      } catch {
        return reply(makeError('unavailable', false));
      } finally {
        this.#pending.delete(key);
      }
    } catch {
      return fail('unavailable');
    }
  }
}
