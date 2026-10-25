import { randomUUID } from 'node:crypto';
import { createPluginHostServices } from '@pet/plugin-sdk/host';
import type { PluginHostServices, PluginTask, PluginConfigSnapshot } from '@pet/plugin-sdk';
import { makeError, type JsonValue, type OwnerRef, type Result } from '@pet/contracts';
import type { ControlEndpoint } from '../ipc/control-endpoint.js';
import type { TaskMediaPeer } from '../tasks/media-peer.js';
import type { SensitivePeer } from '../credentials/sensitive-peer.js';
import type { KnownSecretBoundary } from '../credentials/secret-boundary.js';
import type { WorkerServerServices } from './worker-server.js';
const fail = <T>(code: Parameters<typeof makeError>[0]): Result<T> => ({
  ok: false,
  error: makeError(code, false),
});
export function createWorkerServices(
  endpoint: () => ControlEndpoint,
  streams: TaskMediaPeer,
  signalFor: (owner: OwnerRef, taskId: string) => AbortSignal | null,
  portStats?: () => JsonValue,
  credential?: { peer: SensitivePeer; boundary: KnownSecretBoundary },
): WorkerServerServices {
  const request = async (
    owner: OwnerRef,
    action: string,
    payload: JsonValue,
    signal: AbortSignal,
    task?: PluginTask,
  ): Promise<Result<JsonValue>> => {
    const budget =
      task?.deadline === undefined ? 30000 : Math.floor(task.deadline - performance.now());
    if (budget < 1) return fail('timeout');
    return endpoint().request('host.api', { owner, action, payload } as unknown as JsonValue, {
      signal,
      budgetMs: Math.min(budget, 30000),
      ...(task ? { taskId: task.taskId } : {}),
    });
  };
  const scope = (owner: OwnerRef, task: PluginTask): AbortSignal | null => {
    const actual = signalFor(owner, task.taskId);
    return actual && !actual.aborted ? AbortSignal.any([actual, task.signal]) : null;
  };
  return {
    securityStats: () =>
      credential
        ? { ...credential.boundary.diagnostics(), sensitive: credential.peer.diagnostics() }
        : null,
    mediaStats: () => ({ ...streams.snapshot(), port: portStats?.() ?? null }),
    create: (owner: OwnerRef, lifetime: AbortSignal): PluginHostServices =>
      createPluginHostServices(
        { owner, signal: lifetime },
        {
          ...(credential
            ? {
                withSecret: async (
                  who: OwnerRef,
                  task: PluginTask,
                  keyId: string,
                  operation: (secret: string, signal: AbortSignal) => Promise<JsonValue>,
                ): Promise<Result<JsonValue>> => {
                  const actual = scope(who, task);
                  if (!actual) return fail('permission-denied');
                  const cancellation = new AbortController(),
                    signal = AbortSignal.any([actual, cancellation.signal]);
                  const reference = { owner: who, taskId: task.taskId, streamId: randomUUID() };
                  const accepted = credential.peer
                    .accept(reference, signal, operation)
                    .then((result) => {
                      if (!result.ok) cancellation.abort();
                      return result;
                    });
                  if (!credential.peer.registered(reference)) return accepted;
                  const budget =
                    task.deadline === undefined
                      ? 30000
                      : Math.floor(task.deadline - performance.now());
                  const requested = (
                    budget < 1
                      ? Promise.resolve(fail<JsonValue>('timeout'))
                      : endpoint().request(
                          'host.api',
                          {
                            owner: who,
                            action: 'credentials.use',
                            payload: { keyId, reference },
                          } as unknown as JsonValue,
                          { taskId: reference.streamId, signal, budgetMs: Math.min(budget, 30000) },
                        )
                  ).then((result) => {
                    if (!result.ok) {
                      credential.peer.discard(reference);
                      cancellation.abort();
                    }
                    return result;
                  });
                  const [host, local] = await Promise.all([requested, accepted]);
                  cancellation.abort();
                  if (!local.ok && !['cancelled', 'unavailable'].includes(local.error.code))
                    return local;
                  if (!host.ok) return host;
                  return local;
                },
              }
            : {}),
          getConfig: async (who) =>
            (await request(who, 'config.get', null, lifetime)) as Result<PluginConfigSnapshot>,
          invoke: async (who, task, capability, method, input) => {
            const signal = scope(who, task);
            if (!signal) return fail('permission-denied');
            return request(who, 'capability.invoke', { capability, method, input }, signal, task);
          },
          openInput: async (who, task) => {
            const signal = scope(who, task);
            if (!signal) return fail('permission-denied');
            const reference = { owner: who, taskId: task.taskId, streamId: randomUUID() },
              reader = streams.createReader(reference);
            if (!reader.ok) return reader;
            const opened = await request(
              who,
              'media.input',
              reference as unknown as JsonValue,
              signal,
              task,
            );
            if (!opened.ok) {
              reader.value.cancel();
              return opened;
            }
            const grant = streams.grantInitial(reference);
            if (!grant.ok) {
              reader.value.cancel();
              return grant;
            }
            return reader;
          },
          openOutput: async (who, task) => {
            const signal = scope(who, task);
            if (!signal) return fail('permission-denied');
            const reference = { owner: who, taskId: task.taskId, streamId: randomUUID() },
              writer = streams.createWriter(reference);
            if (!writer.ok) return writer;
            const opened = await request(
              who,
              'media.output',
              reference as unknown as JsonValue,
              signal,
              task,
            );
            if (!opened.ok) {
              writer.value.cancel();
              return opened;
            }
            return writer;
          },
        },
      ),
  };
}
