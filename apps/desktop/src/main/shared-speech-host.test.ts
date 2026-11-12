import { expect, it, vi } from 'vitest';
import { TaskSupervisor } from '@pet/host-kernel';
import { SPEECH_CONTROL_CAPABILITY } from '@pet/contracts';
import { SharedSpeechHost } from './shared-speech-host.js';
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const source = new AbortController(),
    abort = new AbortController(),
    completion = deferred();
  const owner = { pluginId: 'pet.speech-output', instanceId: 'default', generation: 1 };
  const tasks = new TaskSupervisor({
    isActive: () => !source.signal.aborted,
    isLive: () => true,
    signal: () => source.signal,
  });
  let epoch = 1;
  const permissionClosed = vi.fn();
  const kernel = {
    manager: {
      get: () => ({ owner }),
      isActive: () => !source.signal.aborted,
      signal: () => source.signal,
    },
    tasks,
    describeTrust: () => ({ trusted: true, digest: 'digest' }),
    verifyTrust: vi.fn(async () => true),
    permissionControl: { inspect: () => ({ epoch, blocked: false, preset: 'allow' as const }) },
    permissions: {
      authorize: vi.fn(async () => ({
        ok: true as const,
        value: {
          signal: source.signal,
          isValid: () => !source.signal.aborted,
          close: permissionClosed,
        },
      })),
    },
  };
  return {
    host: new SharedSpeechHost(kernel),
    kernel,
    source,
    abort,
    completion,
    permissionClosed,
    revoke: () => {
      epoch++;
    },
  };
}
it('owns real local task/media, bounds credits, and retains actual settlement after logical abort', async () => {
  const f = fixture();
  const lease = await f.host.acquire(f.abort.signal, f.completion.promise);
  expect(f.kernel.permissions.authorize).toHaveBeenCalledWith(
    lease.owner,
    lease.taskId,
    { kind: 'capability-use', capability: SPEECH_CONTROL_CAPABILITY },
    expect.any(AbortSignal),
  );
  expect(lease.reader.reference).toEqual({
    owner: lease.owner,
    taskId: lease.taskId,
    streamId: lease.streamId,
  });
  for (let i = 0; i < 8; i++)
    expect((await lease.writer.write(new Uint8Array([i, 0]))).ok).toBe(true);
  let written = false;
  const ninth = lease.writer.write(new Uint8Array([8, 0])).then((result) => {
    written = true;
    return result;
  });
  await Promise.resolve();
  expect(written).toBe(false);
  const reader = lease.reader[Symbol.asyncIterator]();
  expect((await reader.next()).value).toEqual(new Uint8Array([0, 0]));
  expect((await ninth).ok).toBe(true);
  let settled = false;
  void lease.settled.then(() => {
    settled = true;
  });
  f.abort.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(f.permissionClosed).not.toHaveBeenCalled();
  f.completion.resolve();
  await lease.settled;
  expect(f.permissionClosed).toHaveBeenCalledTimes(1);
  expect(await lease.isCurrent()).toBe(false);
});
it('rejects policy changes during asynchronous source trust without acquiring a task/permission', async () => {
  const f = fixture();
  const trust = deferred();
  f.kernel.verifyTrust.mockImplementation(async () => {
    await trust.promise;
    return true;
  });
  const acquiring = f.host.acquire(f.abort.signal, f.completion.promise);
  f.revoke();
  trust.resolve();
  await expect(acquiring).rejects.toMatchObject({ error: { code: 'permission-denied' } });
  expect(f.kernel.permissions.authorize).not.toHaveBeenCalled();
});
