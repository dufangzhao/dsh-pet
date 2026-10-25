import { expect, it } from 'vitest';
import { PassThrough, Duplex } from 'node:stream';
import { FramedMediaPort } from './media-port.js';
it('handles the paired-stream asynchronous error emitted during destroy', async () => {
  const stream = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
    destroy(_error, callback) {
      queueMicrotask(() => callback(new Error('late native teardown')));
    },
  });
  const port = new FramedMediaPort(
    stream,
    () => ({ ok: true, value: null }),
    () => {},
  );
  port.close();
  await new Promise<void>((resolve) => stream.once('close', () => resolve()));
  expect(port.snapshot().closed).toBe(true);
});
it('closes a paired media transport and confirms its close event', async () => {
  const incoming = new PassThrough(),
    outgoing = new PassThrough();
  const stream = Duplex.from({ readable: incoming, writable: outgoing });
  const port = new FramedMediaPort(
    stream,
    () => ({ ok: true, value: null }),
    () => {},
  );
  port.close();
  await new Promise<void>((resolve) => stream.once('close', () => resolve()));
  expect(port.snapshot().closed).toBe(true);
});
