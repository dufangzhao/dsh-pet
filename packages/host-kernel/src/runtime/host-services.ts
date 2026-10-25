import { makeError, type JsonValue, type OwnerRef, type Result } from '@pet/contracts';
import type { RpcContext } from '../ipc/control-endpoint.js';
import type { ConfigService } from '../config/service.js';
import type { TaskSupervisor } from '../tasks/task-supervisor.js';
import { capabilityPermissionAuthorizer } from '../permissions/adapters.js';
import type { PermissionService } from '../permissions/kernel.js';
import type { PluginManager } from './plugin-manager.js';
import { jsonPreflight } from '@pet/contracts/validation';
import { exactKeys, record } from './worker-protocol.js';
import type {
  MediaReadEndpoint,
  MediaWriteEndpoint,
  TaskMediaReference,
} from '../tasks/media-peer.js';
export interface RuntimeHostPort {
  signalFor(owner: OwnerRef, taskId: string): AbortSignal | null;
  request(
    owner: OwnerRef,
    action: string,
    payload: JsonValue,
    context: RpcContext,
  ): Promise<Result<JsonValue>>;
  input?(reference: TaskMediaReference, writer: MediaWriteEndpoint): void;
  output?(reference: TaskMediaReference, reader: MediaReadEndpoint): void;
}
export interface HostServicesOptions {
  manager: PluginManager;
  tasks: TaskSupervisor;
  configs: ConfigService;
  permissions: PermissionService;
  input?: RuntimeHostPort['input'];
  output?: RuntimeHostPort['output'];
}
/** Main-process adapter only: never passed to plugin code. */
export function createRuntimeHostPort(options: HostServicesOptions): RuntimeHostPort {
  return Object.freeze({
    signalFor: (owner: OwnerRef, taskId: string) => options.tasks.taskSignal(taskId, owner),
    request: async (
      owner: OwnerRef,
      action: string,
      payload: JsonValue,
      context: RpcContext,
    ): Promise<Result<JsonValue>> => {
      try {
        if (!options.manager.isLive(owner))
          return { ok: false, error: makeError('stale-owner', false) };
        if (action === 'config.get') {
          if (payload !== null) return { ok: false, error: makeError('invalid-input', false) };
          const result = await options.configs.issueClient(owner).get();
          return result as Result<JsonValue>;
        }
        if (action !== 'capability.invoke' || !context.taskId)
          return { ok: false, error: makeError('invalid-input', false) };
        const parent = options.tasks.taskSignal(context.taskId, owner),
          body = record(payload);
        if (
          !parent ||
          !body ||
          !exactKeys(body, ['capability', 'method', 'input']) ||
          typeof body['capability'] !== 'string' ||
          typeof body['method'] !== 'string'
        )
          return { ok: false, error: makeError('permission-denied', false) };
        const input = jsonPreflight(body['input']);
        if (!input.ok) return { ok: false, error: makeError('invalid-input', false) };
        const task = options.tasks.invokeCapability(
          options.manager,
          owner,
          body['capability'],
          body['method'],
          input.value,
          capabilityPermissionAuthorizer(options.permissions),
          {
            signal: AbortSignal.any([parent, context.signal]),
            timeoutMs: Math.min(context.budgetMs, 30000),
          },
        );
        return task.ok ? await task.value.result : task;
      } catch {
        return { ok: false, error: makeError('internal', false) };
      }
    },
    ...(options.input ? { input: options.input } : {}),
    ...(options.output ? { output: options.output } : {}),
  });
}
