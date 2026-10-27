import { makeError, type ConfigInspection, type ConfigSave, type Result } from '@pet/contracts';
import { jsonPreflight } from '@pet/contracts/validation';
import { ownerFrom, exactKeys, record } from '@pet/host-kernel';
import type { DesktopHost } from './desktop-host.js';
import { isTrustedPetSource, type PetRequestSource } from './ipc-request.js';

const fail = (code: Parameters<typeof makeError>[0]): Result<never> => ({
  ok: false,
  error: makeError(code, false),
});
/** Result-returning settings actions bypass the parameterless snapshot wrapper. */
export async function handleConsoleConfigRequest(
  source: PetRequestSource,
  action: 'inspect' | 'save',
  args: readonly unknown[],
  host: Pick<DesktopHost, 'manager' | 'configs'>,
): Promise<Result<ConfigInspection | ConfigSave>> {
  if (!isTrustedPetSource(source)) return fail('permission-denied');
  if (args.length !== 1) return fail('invalid-input');
  try {
    const parsed = jsonPreflight(args[0]);
    if (!parsed.ok) return fail('invalid-input');
    const request = record(parsed.value);
    if (!request) return fail('invalid-input');
    if (
      action === 'save' &&
      (!exactKeys(request, ['owner', 'expectedRevision', 'data']) ||
        !Number.isSafeInteger(request['expectedRevision']) ||
        (request['expectedRevision'] as number) < 0)
    )
      return fail('invalid-input');
    const owner = ownerFrom(action === 'inspect' ? request : request['owner']);
    if (!owner) return fail('invalid-input');
    // Config storage has a stable two-field identity; lifecycle authority uses all three.
    const identity = { pluginId: owner.pluginId, instanceId: owner.instanceId };
    const plugin = host.manager.get(identity);
    if (!plugin || plugin.owner.generation !== owner.generation) return fail('stale-owner');
    if (plugin.state === 'rejected') return fail('not-ready');
    const ownerSignal = host.manager.ownerSignal(owner);
    if (!ownerSignal || ownerSignal.aborted) return fail('stale-owner');
    if (action === 'inspect') {
      const result = await host.configs.inspect(identity);
      return ownerSignal.aborted ? fail('stale-owner') : result;
    }
    const runtimeSignal = host.manager.signal(owner);
    const signal =
      runtimeSignal && !runtimeSignal.aborted
        ? AbortSignal.any([ownerSignal, runtimeSignal])
        : ownerSignal;
    return await host.configs.save(
      identity,
      request['data'],
      request['expectedRevision'] as number,
      signal,
    );
  } catch {
    return fail('unavailable');
  }
}
