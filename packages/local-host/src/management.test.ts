import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { LOCAL_HOST_PROTOCOL_VERSION } from '@pet/contracts';
import { startLocalManagement, attachLocalManagement } from './management.js';
import { newManagementCapability, type LocalHostRendezvous } from './rendezvous.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(
  close = async (): Promise<void> => {},
  onStopped?: () => void | Promise<void>,
) {
  const identity = {
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    packageVersion: '0.1.0',
    hostId: randomUUID(),
    bootId: randomUUID(),
  };
  const capability = newManagementCapability();
  let stopped = false;
  const server = await startLocalManagement({
    identity,
    capability,
    kernel: { status: async () => ({ sources: 2 }), close },
    onStopped: async () => {
      stopped = true;
      await onStopped?.();
    },
  });
  cleanup.push(() => server.close());
  const record: LocalHostRendezvous = {
    ...identity,
    format: 1,
    endpoint: server.endpoint,
    managementCapability: capability,
  };
  return { record, stopped: () => stopped };
}
it('mutually proves the captured boot, detaches clients without stopping the daemon and never projects its cap', async () => {
  let closes = 0;
  const f = await fixture(async () => {
    closes++;
  });
  const first = await attachLocalManagement(f.record);
  const status = await first.status();
  expect(status).toMatchObject({
    ok: true,
    value: { identity: { bootId: f.record.bootId }, phase: 'running', kernel: { sources: 2 } },
  });
  expect(JSON.stringify(status)).not.toContain(f.record.managementCapability);
  await first.close();
  expect(closes).toBe(0);
  const next = await attachLocalManagement(f.record);
  cleanup.push(() => next.close());
  expect(await next.status()).toMatchObject({
    ok: true,
    value: { identity: { bootId: f.record.bootId } },
  });
});
it('rejects wrong management cap, stale boot and changed package before exposing native management', async () => {
  const f = await fixture();
  await expect(
    attachLocalManagement({ ...f.record, managementCapability: newManagementCapability() }),
  ).rejects.toMatchObject({ error: { code: 'unavailable' } });
  await expect(attachLocalManagement({ ...f.record, bootId: randomUUID() })).rejects.toMatchObject({
    error: { code: 'stale-owner' },
  });
  await expect(
    attachLocalManagement({ ...f.record, packageVersion: '9.0.0' }),
  ).rejects.toMatchObject({ error: { code: 'stale-owner' } });
});
it('stop joins actual kernel settlement while independent clients and absent Agent do not decide cleanup', async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(() => gate),
    client = await attachLocalManagement(f.record);
  cleanup.push(() => client.close());
  let done = false;
  const stopping = client.stop().then((value) => {
    done = true;
    return value;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(done).toBe(false);
  expect(f.stopped()).toBe(false);
  release();
  expect(await stopping).toMatchObject({ ok: true, value: { phase: 'stopped' } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.stopped()).toBe(true);
});
it('failed kernel disposal stays failed and cannot claim an exited host', async () => {
  const f = await fixture(async () => {
      throw new Error('controlled close failure');
    }),
    client = await attachLocalManagement(f.record);
  cleanup.push(() => client.close());
  expect(await client.stop()).toMatchObject({ ok: false });
  expect(await client.status()).toMatchObject({ ok: true, value: { phase: 'failed' } });
  expect(f.stopped()).toBe(false);
});
it('does not let a slow stop reply be discarded by the close it triggers', async () => {
  const identity = {
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    packageVersion: '0.1.0',
    hostId: randomUUID(),
    bootId: randomUUID(),
  };
  const capability = newManagementCapability();
  let stopped = false;
  const server: Awaited<ReturnType<typeof startLocalManagement>> = await startLocalManagement({
    identity,
    capability,
    kernel: { status: async () => ({ sources: 2 }), close: async () => {} },
    // Same shape as the daemon: onStopped closes the server that owns this peer.
    onStopped: async () => {
      stopped = true;
      await server.close();
    },
  });
  // onStopped already closed the server; the daemon memoizes that close.
  cleanup.push(() => server.close().catch(() => {}));
  const record: LocalHostRendezvous = {
    ...identity,
    format: 1,
    endpoint: server.endpoint,
    managementCapability: capability,
  };
  const client = await attachLocalManagement(record);
  cleanup.push(() => client.close());
  /*
   * The stop reply travels on the same socket that onStopped() then destroys. A
   * peer slow to read makes that write's callback late; the reply must still
   * reach it, or the caller reports `unavailable` for a cleanup that succeeded.
   */
  const write = net.Socket.prototype.write;
  net.Socket.prototype.write = function (this: net.Socket, chunk: never, ...rest: never[]) {
    const bytes: unknown = chunk;
    if (!Buffer.isBuffer(bytes) || !bytes.includes(Buffer.from('"phase":"stopped"')))
      return write.call(this, chunk, ...rest);
    setTimeout(() => write.call(this, chunk, ...rest), 25);
    return true;
  } as typeof net.Socket.prototype.write;
  try {
    expect(await client.stop()).toMatchObject({ ok: true, value: { phase: 'stopped' } });
  } finally {
    net.Socket.prototype.write = write;
  }
  expect(stopped).toBe(true);
});
