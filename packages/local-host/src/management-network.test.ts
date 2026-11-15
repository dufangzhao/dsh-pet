import { createConnection } from 'node:net';
import { once } from 'node:events';
import { createHmac, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { encodeMediaFrame } from '@pet/host-kernel';
import { LOCAL_HOST_PROTOCOL_VERSION } from '@pet/contracts';
import { startLocalManagement } from './management.js';

it('an authenticated control namespace still cannot submit an unregistered owner/task on the binary lane', async () => {
  const identity = {
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
      packageVersion: '0.1.0',
      hostId: randomUUID(),
      bootId: randomUUID(),
    },
    capability = 'a'.repeat(64);
  const server = await startLocalManagement({
    identity,
    capability,
    kernel: { status: async () => ({}), close: async () => {} },
    onStopped: () => {},
  });
  const socket = createConnection(server.endpoint);
  socket.on('error', () => {});
  let buffered = Buffer.alloc(0);
  const messages: unknown[] = [];
  let waiting: ((value: unknown) => void) | undefined;
  socket.on('data', (bytes) => {
    buffered = Buffer.concat([buffered, bytes]);
    while (buffered.length >= 4) {
      const size = buffered.readUInt32BE(0);
      if (buffered.length < 4 + size) return;
      const value: unknown = JSON.parse(buffered.subarray(4, 4 + size).toString());
      buffered = buffered.subarray(4 + size);
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve(value);
      } else messages.push(value);
    }
  });
  const take = () =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise<unknown>((resolve) => {
          waiting = resolve;
        });
  const send = (value: unknown) => {
    const body = Buffer.from(JSON.stringify(value)),
      frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32BE(body.length);
    body.copy(frame, 4);
    socket.write(frame);
  };
  try {
    const challenge = (await take()) as { nonce: string };
    const clientNonce = '1'.repeat(64);
    const proof = createHmac('sha256', capability)
      .update(
        JSON.stringify([
          'client',
          identity.protocolVersion,
          identity.packageVersion,
          identity.hostId,
          identity.bootId,
          challenge.nonce,
          clientNonce,
        ]),
      )
      .digest('hex');
    send({ type: 'authenticate', nonce: clientNonce, proof });
    expect(await take()).toMatchObject({ type: 'authenticated' });
    const payload = Buffer.from('synthetic-unregistered-key'),
      media = encodeMediaFrame({
        header: {
          streamId: randomUUID(),
          taskId: 'not-an-issued-task',
          owner: { pluginId: 'pet.local-qq-control', instanceId: 'default', generation: 1 },
          sequence: 0,
          byteLength: payload.length,
        },
        payload,
      });
    if (!media.ok) throw new Error('Invalid test frame');
    const frame = Buffer.alloc(4 + media.value.length);
    frame.writeUInt32BE(0x80000000 + media.value.length);
    frame.set(media.value, 4);
    const closed = once(socket, 'close');
    socket.write(frame);
    await closed;
  } finally {
    socket.destroy();
    await server.close();
  }
});
