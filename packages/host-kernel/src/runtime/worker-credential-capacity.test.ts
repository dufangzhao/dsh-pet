import { expect, it, vi } from 'vitest';
import { createWorkerServices } from './worker-services.js';
import { SensitivePeer } from '../credentials/sensitive-peer.js';
import { KnownSecretBoundary } from '../credentials/secret-boundary.js';
import { TaskMediaPeer } from '../tasks/media-peer.js';
import type { ControlEndpoint } from '../ipc/control-endpoint.js';
import { makeError } from '@pet/contracts';
it('does not request a host credential when no local receive slot was reserved', async () => {
  const owner = { pluginId: 'test.capacity', instanceId: 'default', generation: 1 },
    scope = new AbortController(),
    task = { taskId: 'task', signal: scope.signal };
  const peer = new SensitivePeer({ write: async () => ({ ok: true, value: null }) }),
    pending = [];
  for (let i = 0; i < 32; i++)
    pending.push(
      peer.accept({ owner, taskId: 'task', streamId: 'held-' + i }, scope.signal, async () => true),
    );
  const request = vi.fn(async () => ({ ok: false, error: makeError('not-ready') })),
    endpoint = { request } as unknown as ControlEndpoint;
  const streams = new TaskMediaPeer({
    signalFor: () => scope.signal,
    write: async () => ({ ok: true, value: null }),
    control: () => ({ ok: true, value: null }),
  });
  const services = createWorkerServices(
    () => endpoint,
    streams,
    () => scope.signal,
    undefined,
    { peer, boundary: new KnownSecretBoundary() },
  );
  const operation = vi.fn(async () => true);
  const result = await services
    .create(owner, scope.signal)
    .credentials!.withSecret(task, 'key', operation);
  expect(result).toMatchObject({ ok: false, error: { code: 'quota-exceeded' } });
  expect(request).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
  scope.abort();
  await Promise.all(pending);
  await peer.drain();
  peer.close();
  streams.close();
});
