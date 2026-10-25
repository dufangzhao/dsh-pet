import { randomUUID } from 'node:crypto';
import { createPluginHostServices } from '@pet/plugin-sdk/host';
import type { PluginHostServices, PluginTask, PluginConfigSnapshot } from '@pet/plugin-sdk';
import { makeError, type JsonValue, type OwnerRef, type Result } from '@pet/contracts';
import type { ControlEndpoint } from '../ipc/control-endpoint.js';
import type { TaskMediaPeer } from '../tasks/media-peer.js';
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
    mediaStats: () => ({ ...streams.snapshot(), port: portStats?.() ?? null }),
    create: (owner: OwnerRef, lifetime: AbortSignal): PluginHostServices =>
      createPluginHostServices(
        { owner, signal: lifetime },
        {
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
