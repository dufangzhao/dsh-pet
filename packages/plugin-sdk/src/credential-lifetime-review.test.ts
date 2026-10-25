import { expect, it, vi } from 'vitest';
import { makeError } from '@pet/contracts';
import type { JsonValue } from '@pet/contracts';
import type { PluginHostPort } from './index.js';
import { createPluginHostServices } from './host.js';
const owner = { pluginId: 'test.credential-lifetime', instanceId: 'default', generation: 1 },
  task = { taskId: 'task', signal: new AbortController().signal },
  fixture = 'PUBLIC_LIFETIME_FIXTURE';
function base(): PluginHostPort {
  return {
    getConfig: async () => ({ ok: false, error: makeError('not-ready') }),
    invoke: async () => ({ ok: true, value: null }),
    openInput: async () => ({ ok: false, error: makeError('not-ready') }),
    openOutput: async () => ({ ok: false, error: makeError('not-ready') }),
  };
}
it('does not execute a retained wrapper after a port has already refused the request', async () => {
  let retained!: (secret: string, signal: AbortSignal) => Promise<JsonValue>;
  const port = base();
  port.withSecret = async (_owner, _task, _key, operation) => {
    retained = operation;
    return { ok: false, error: makeError('permission-denied') };
  };
  const api = createPluginHostServices({ owner, signal: new AbortController().signal }, port),
    operation = vi.fn(async () => true);
  expect(await api.credentials!.withSecret(task, 'key', operation)).toMatchObject({
    ok: false,
    error: { code: 'permission-denied' },
  });
  await expect(retained(fixture, new AbortController().signal)).rejects.toBeDefined();
  expect(operation).not.toHaveBeenCalled();
});
it('does not publish a callback result after the port finished without awaiting it', async () => {
  let release!: () => void, callback!: Promise<JsonValue>;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    port = base();
  port.withSecret = async (_owner, _task, _key, operation) => {
    callback = operation(fixture, new AbortController().signal);
    return { ok: false, error: makeError('permission-denied') };
  };
  const api = createPluginHostServices({ owner, signal: new AbortController().signal }, port);
  expect(
    await api.credentials!.withSecret(task, 'key', async () => {
      await gate;
      return true;
    }),
  ).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
  release();
  await expect(callback).rejects.toBeDefined();
});
