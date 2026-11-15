import { AsyncLocalStorage } from 'node:async_hooks';
import { LOCAL_HOST_AUTHORITY_CHECK_MAX_MS, type OwnerRef, type TaskContext } from '@pet/contracts';
import { KernelFault } from '@pet/host-kernel';
import type { CompanionPluginHost } from '@pet/companion-runtime/plugin-host';

type SourceHost = Pick<CompanionPluginHost, 'manager' | 'tasks'>;
interface OperationScope {
  readonly host: SourceHost;
  readonly task: TaskContext;
  readonly check: () => Promise<number>;
  active: boolean;
}
const current = new AsyncLocalStorage<OperationScope>();
const sameOwner = (left: OwnerRef, right: OwnerRef): boolean =>
  left.pluginId === right.pluginId &&
  left.instanceId === right.instanceId &&
  left.generation === right.generation;
function active(scope: OperationScope): boolean {
  return (
    scope.active &&
    !scope.task.signal.aborted &&
    scope.host.manager.isActive(scope.task.owner) &&
    scope.host.tasks.taskSignal(scope.task.taskId, scope.task.owner) === scope.task.signal
  );
}

/** Bind one host-private operation to its actual source task; no remote grant is serialized. */
export async function withQqOperationCheck<T>(
  host: SourceHost,
  task: TaskContext,
  check: () => Promise<number>,
  work: () => Promise<T>,
): Promise<T> {
  if (!task || typeof check !== 'function' || typeof work !== 'function')
    throw new KernelFault('invalid-input');
  const captured: TaskContext = Object.freeze({
    taskId: task.taskId,
    owner: Object.freeze({ ...task.owner }),
    signal: task.signal,
  });
  const scope: OperationScope = { host, task: captured, check, active: true };
  if (!active(scope)) throw new KernelFault('permission-denied');
  try {
    return await current.run(scope, work);
  } finally {
    scope.active = false;
  }
}

/** Fresh business authorization at the physical boundary; housekeeping does not call this. */
export async function checkQqOperation(
  host: SourceHost,
  owner: OwnerRef,
  required: boolean,
  signal: AbortSignal,
): Promise<number | null> {
  const scope = current.getStore();
  if (!scope) {
    if (required) throw new KernelFault('permission-denied');
    return null;
  }
  if (
    scope.host !== host ||
    !sameOwner(scope.task.owner, owner) ||
    signal.aborted ||
    !active(scope)
  )
    throw new KernelFault('permission-denied');
  const deadline = await scope.check();
  if (
    !Number.isFinite(deadline) ||
    deadline - performance.now() > LOCAL_HOST_AUTHORITY_CHECK_MAX_MS
  )
    throw new KernelFault('invalid-input');
  assertQqOperation(host, owner, required, signal, deadline);
  return deadline;
}

/** Must run synchronously after the last local await, immediately before a wire effect. */
export function assertQqOperation(
  host: SourceHost,
  owner: OwnerRef,
  required: boolean,
  signal: AbortSignal,
  deadline: number | null,
): void {
  const scope = current.getStore();
  if (!scope) {
    if (required || deadline !== null) throw new KernelFault('permission-denied');
    return;
  }
  if (
    scope.host !== host ||
    !sameOwner(scope.task.owner, owner) ||
    signal.aborted ||
    !active(scope)
  )
    throw new KernelFault('permission-denied');
  if (deadline === null || !Number.isFinite(deadline)) throw new KernelFault('invalid-input');
  if (performance.now() >= deadline) throw new KernelFault('timeout');
}
