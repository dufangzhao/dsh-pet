import {
  makeError,
  type JsonValue,
  type MediaFrame,
  type OwnerRef,
  type Result,
} from '@pet/contracts';
import type { RpcContext } from '../ipc/control-endpoint.js';
import type { ConfigService } from '../config/service.js';
import type { TaskSupervisor, TaskHandle } from '../tasks/task-supervisor.js';
import { capabilityPermissionAuthorizer } from '../permissions/adapters.js';
import type { PermissionService } from '../permissions/kernel.js';
import type { PluginManager } from './plugin-manager.js';
import { jsonPreflight } from '@pet/contracts/validation';
import {
  type CredentialBroker,
  CredentialError,
  type CredentialClient,
} from '../credentials/credential-broker.js';
import { KnownSecretBoundary } from '../credentials/secret-boundary.js';
import { exactKeys, record } from './worker-protocol.js';
import type {
  MediaReadEndpoint,
  MediaWriteEndpoint,
  TaskMediaReference,
} from '../tasks/media-peer.js';
export interface RuntimeHostPort {
  signalFor(owner: OwnerRef, taskId: string): AbortSignal | null;
  allowJson?(value: JsonValue): boolean;
  allowFrame?(frame: MediaFrame): boolean;
  forget?(streamId: string): void;
  useCredential?(
    owner: OwnerRef,
    taskId: string,
    keyId: string,
    signal: AbortSignal,
    operation: (secret: string, signal: AbortSignal) => Promise<Result<null>>,
  ): Promise<Result<null>>;
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
  changed?: () => void;
  manager: PluginManager;
  tasks: TaskSupervisor;
  configs: ConfigService;
  permissions: PermissionService;
  credentials?: CredentialBroker;
  input?: RuntimeHostPort['input'];
  output?: RuntimeHostPort['output'];
  capabilityTask?: (
    parentTaskId: string,
    child: TaskHandle,
    capability: string,
    method: string,
  ) => void;
}
/** Main-process adapter only: never passed to plugin code. */
export function createRuntimeHostPort(options: HostServicesOptions): RuntimeHostPort {
  const boundary = new KnownSecretBoundary(options.credentials?.redactor);
  const clients = new Map<string, { owner: OwnerRef; client: CredentialClient }>();
  return Object.freeze({
    allowJson: (value: JsonValue) => boundary.allowJson(value),
    allowFrame: (frame: MediaFrame) => boundary.allowFrame(frame),
    forget: (streamId: string) => boundary.forget(streamId),
    ...(options.credentials
      ? {
          useCredential: async (
            owner: OwnerRef,
            taskId: string,
            keyId: string,
            signal: AbortSignal,
            operation: (secret: string, signal: AbortSignal) => Promise<Result<null>>,
          ): Promise<Result<null>> => {
            try {
              const taskSignal = options.tasks.taskSignal(taskId, owner),
                snapshot = options.manager.get(owner);
              if (
                !taskSignal ||
                !snapshot ||
                snapshot.owner.generation !== owner.generation ||
                !options.manager.isLive(owner)
              )
                return { ok: false, error: makeError('permission-denied', false) };
              const id = JSON.stringify([owner.pluginId, owner.instanceId]);
              let issued = clients.get(id);
              if (!issued || issued.owner.generation !== owner.generation) {
                const keys =
                  snapshot.manifest.permissions?.flatMap((permission) =>
                    permission.kind === 'credentials' ? permission.keys : [],
                  ) ?? [];
                issued = {
                  owner: { ...owner },
                  client: options.credentials!.issueClient(owner, [...new Set(keys)]),
                };
                clients.set(id, issued);
              }
              return await issued.client.withSecret(
                keyId,
                { taskId, signal: AbortSignal.any([taskSignal, signal]) },
                operation,
              );
            } catch (error) {
              return {
                ok: false,
                error: makeError(
                  error instanceof CredentialError ? error.code : 'unavailable',
                  false,
                ),
              };
            }
          },
        }
      : {}),
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
        if (action === 'config.save') {
          const body = record(payload);
          const taskSignal = context.taskId
            ? options.tasks.taskSignal(context.taskId, owner)
            : null;
          if (
            !body ||
            !taskSignal ||
            !context.taskId ||
            !exactKeys(body, ['data', 'expectedRevision']) ||
            !record(body['data']!) ||
            !Number.isSafeInteger(body['expectedRevision']) ||
            (body['expectedRevision'] as number) < 0
          )
            return { ok: false, error: makeError('permission-denied', false) };
          const permitted = await options.permissions.run(
            owner,
            context.taskId,
            { kind: 'files', scope: 'plugin-data', access: 'read-write' },
            (signal) =>
              options.configs.save(
                { pluginId: owner.pluginId, instanceId: owner.instanceId },
                body['data'],
                body['expectedRevision'] as number,
                signal,
              ),
            AbortSignal.any([taskSignal, context.signal]),
          );
          if (permitted.ok && permitted.value.ok) options.changed?.();
          return (permitted.ok ? permitted.value : permitted) as Result<JsonValue>;
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
          capabilityPermissionAuthorizer(options.permissions, options.manager),
          {
            signal: AbortSignal.any([parent, context.signal]),
            timeoutMs: Math.min(context.budgetMs, 30000),
          },
        );
        if (!task.ok) return task;
        try {
          options.capabilityTask?.(context.taskId, task.value, body['capability'], body['method']);
        } catch {
          task.value.cancel();
          return { ok: false, error: makeError('internal', false) };
        }
        return await task.value.result;
      } catch {
        return { ok: false, error: makeError('internal', false) };
      }
    },
    ...(options.input ? { input: options.input } : {}),
    ...(options.output ? { output: options.output } : {}),
  });
}
