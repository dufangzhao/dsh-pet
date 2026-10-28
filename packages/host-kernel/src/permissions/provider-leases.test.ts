import { expect, it, vi } from 'vitest';
import type { OwnerRef, PermissionDeclaration } from '@pet/contracts';
import type { PermissionService, PermissionLease } from './kernel.js';
import type { PluginManager } from '../runtime/plugin-manager.js';
import { capabilityPermissionAuthorizer } from './adapters.js';
const consumer: OwnerRef = { pluginId: 'test.voice', instanceId: 'default', generation: 1 },
  provider: OwnerRef = { pluginId: 'test.asr', instanceId: 'default', generation: 1 };
const request = {
  binding: { capability: 'speech.asr@1', consumer, provider, providerId: 'local' },
  method: 'prepare',
  taskId: 'task',
  signal: new AbortController().signal,
};
const policy = [
  { kind: 'files', scope: 'resources', access: 'read' },
  { kind: 'process', workers: ['recognizer'] },
];
function setup(denyProcess: boolean) {
  const issued: Array<{
    lease: PermissionLease;
    abort: AbortController;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  const authorize = vi.fn(
    async (_owner: OwnerRef, _task: string, permission: PermissionDeclaration) => {
      if (denyProcess && permission.kind === 'process')
        return { ok: false as const, error: { code: 'permission-denied' } };
      const abort = new AbortController(),
        close = vi.fn(() => abort.abort());
      const lease = { signal: abort.signal, isValid: () => !abort.signal.aborted, close };
      issued.push({ lease, abort, close });
      return { ok: true as const, value: lease };
    },
  );
  const service = { authorize } as unknown as PermissionService;
  const manager = {
    get: () => ({
      owner: provider,
      manifest: {
        provides: [{ id: 'local', features: { methodPermissions: { prepare: policy } } }],
      },
    }),
  } as unknown as Pick<PluginManager, 'get'>;
  return { issued, authorize, run: capabilityPermissionAuthorizer(service, manager) };
}
it('authorizes provider operations in the same participating task and rolls back partial grants', async () => {
  const f = setup(true);
  expect(await f.run(request)).toBeNull();
  expect(f.authorize.mock.calls.map((call) => call[0])).toEqual([consumer, provider, provider]);
  expect(f.authorize.mock.calls.every((call) => call[1] === 'task')).toBe(true);
  expect(f.issued).toHaveLength(2);
  for (const item of f.issued) expect(item.close).toHaveBeenCalledOnce();
});
it('joins all provider lease signals and closes each grant once', async () => {
  const f = setup(false),
    lease = await f.run(request);
  expect(lease?.isValid()).toBe(true);
  f.issued[1]!.abort.abort();
  expect(lease?.signal?.aborted).toBe(true);
  expect(lease?.isValid()).toBe(false);
  lease?.close();
  lease?.close();
  for (const item of f.issued) expect(item.close).toHaveBeenCalledOnce();
});
