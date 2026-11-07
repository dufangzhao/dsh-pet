import path from 'node:path';
import { makeError } from '@pet/contracts';
import { definePlugin } from '@pet/plugin-sdk';
import { parseConfig } from './boundary.js';
import { DockerExecutor } from './executor.js';
import type { CloudReconcileRequest } from './types.js';

export { DockerExecutor, type DockerExecutorOptions } from './executor.js';
export { parseConfig, parseRequest } from './boundary.js';
export type {
  CloudExecConfig,
  CloudExecutionArtifact,
  CloudExecutionRequest,
  CloudExecutionResult,
  CloudReconcileRequest,
  CloudReconcileResult,
} from './types.js';

export default definePlugin({
  activate(ctx) {
    const config = parseConfig(ctx.config);
    const executor =
      config.ok && ctx.dataDirectory
        ? new DockerExecutor({
            config: config.value,
            workspaceRoot: path.join(ctx.dataDirectory, config.value.workspaceDirectory),
            owner: ctx.owner,
            signal: ctx.signal,
          })
        : null;
    if (executor) ctx.effect(() => () => executor.close());
    ctx.provide('docker', {
      reconcile: async (task, input) => {
        if (!executor) return { ok: false, error: { ...makeError('unavailable') } };
        if (task.signal.aborted) return { ok: false, error: { ...makeError('cancelled') } };
        const result = await executor.reconcile(input as CloudReconcileRequest);
        if (!result.ok) return { ok: false, error: { ...result.error } };
        return {
          ok: true,
          value: {
            ...result.value,
            receipts: result.value.receipts.map(({ executionId, result }) => ({
              executionId,
              result: { ...result, error: result.error ? { ...result.error } : null },
            })),
          },
        };
      },
      execute: async (task, input) => {
        if (!executor) return { ok: false, error: { ...makeError('unavailable') } };
        const result = await executor.execute(task, input);
        if (!result.ok) return { ok: false, error: { ...result.error } };
        return {
          ok: true,
          value: {
            ...result.value,
            error: result.value.error ? { ...result.value.error } : null,
          },
        };
      },
    });
  },
});
