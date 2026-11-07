import type { PermissionDeclaration, TaskContext } from '@pet/contracts';
import { KernelFault, type PermissionLease, type TaskOptions } from '@pet/host-kernel';
import type { CompanionPluginHost } from './plugin-host.js';

/** Run host-owned ports under the current source generation without serializing private values. */
export async function withSourceAuthority<T>(
  host: Pick<CompanionPluginHost, 'runFor' | 'permissions'>,
  sourcePluginId: string,
  permissions: readonly PermissionDeclaration[],
  operation: (signal: AbortSignal, context: TaskContext) => Promise<T>,
  options: TaskOptions = {},
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
  const handle = host.runFor(
    sourcePluginId,
    async (context) => {
      const leases: PermissionLease[] = [];
      try {
        for (const permission of permissions) {
          const result = await host.permissions.authorize(
            context.owner,
            context.taskId,
            permission,
            context.signal,
          );
          if (!result.ok) throw new KernelFault(result.error.code);
          leases.push(result.value);
        }
        const signal = AbortSignal.any([context.signal, ...leases.map((lease) => lease.signal)]);
        signal.throwIfAborted();
        if (!leases.every((lease) => lease.isValid())) throw new KernelFault('permission-denied');
        const value = await operation(signal, context);
        if (!leases.every((lease) => lease.isValid())) throw new KernelFault('permission-denied');
        outcome = { ok: true, value };
      } catch (error) {
        outcome = { ok: false, error };
      } finally {
        for (const lease of leases) {
          try {
            lease.close();
          } catch (error) {
            if (outcome?.ok !== false) outcome = { ok: false, error };
          }
        }
      }
      // TaskSupervisor owns cancellation/drain; model values and native errors stay outside JSON results.
      return null;
    },
    options,
  );
  const logical = await handle.result;
  await handle.settled;
  if (outcome?.ok === false) throw outcome.error;
  if (!logical.ok) throw new KernelFault(logical.error.code);
  if (!outcome) throw new KernelFault('unavailable');
  return outcome.value;
}
