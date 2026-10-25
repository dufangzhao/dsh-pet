import { Duplex, PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { FramedMediaPort } from './media-port.js';
const frame = {
  header: {
    streamId: 's',
    taskId: 't',
    owner: { pluginId: 'test.port', instanceId: 'default', generation: 1 },
    sequence: 0,
    byteLength: 1,
  },
  payload: new Uint8Array([1]),
};
it('handles a write error without leaving an unhandled stream error', async () => {
  const stream = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback(new Error('private-stream-detail'));
    },
  });
  const closed = new Promise<void>((resolve) => stream.once('close', resolve));
  const errors: string[] = [];
  const port = new FramedMediaPort(
    stream,
    () => ({ ok: true, value: null }),
    (error) => errors.push(error.code),
  );
  expect(await port.write(frame)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  await closed;
  expect(errors).toEqual(['unavailable']);
  expect(port.snapshot()).toMatchObject({ closed: true, writing: false, bufferedBytes: 0 });
});
it('drops partial parser buffers on port closure', async () => {
  const stream = new PassThrough();
  const closed = new Promise<void>((resolve) => stream.once('close', resolve));
  const port = new FramedMediaPort(
    stream,
    () => ({ ok: true, value: null }),
    () => {},
  );
  stream.write(Buffer.from([0, 0, 0]));
  expect(port.snapshot().bufferedBytes).toBe(3);
  port.close();
  await closed;
  expect(port.snapshot().bufferedBytes).toBe(0);
});
