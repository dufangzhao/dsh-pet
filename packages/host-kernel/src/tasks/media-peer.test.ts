import { expect, it } from 'vitest';
import {
  makeError,
  type Result,
  type StreamCreditMessage,
  type StreamEndMessage,
} from '@pet/contracts';
import { TaskMediaPeer, type MediaControl } from './media-peer.js';
const owner = { pluginId: 'test.media-peer', instanceId: 'default', generation: 1 };
const ref = { streamId: 'stream', taskId: 'task', owner };
const unwrap = <T>(r: Result<T>) => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
function pair() {
  const scope = new AbortController();
  const envelope = (m: MediaControl) =>
    ({
      ...m,
      protocol: 1 as const,
      id: 'm-1',
      sessionId: 'peer',
      owner: { pluginId: 'core.runtime', instanceId: 'peer', generation: 1 },
    }) as StreamCreditMessage | StreamEndMessage;
  const signalFor = (who: typeof owner, task: string) =>
    who.generation === 1 && task === 'task' ? scope.signal : null;
  const a: TaskMediaPeer = new TaskMediaPeer({
    signalFor,
    write: async (frame) => b.receive(frame),
    control: (message) => b.control(envelope(message)),
  });
  const b: TaskMediaPeer = new TaskMediaPeer({
    signalFor,
    write: async (frame) => a.receive(frame),
    control: (message) => a.control(envelope(message)),
  });
  return { a, b, scope };
}
it('transfers owned bytes and drains a normal end', async () => {
  const { a, b, scope } = pair(),
    reader = unwrap(b.createReader(ref)),
    writer = unwrap(a.createWriter(ref));
  unwrap(b.grantInitial(ref));
  const bytes = new Uint8Array([1, 2]);
  unwrap(await writer.write(bytes));
  bytes.fill(9);
  const iterator = reader[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toEqual(new Uint8Array([1, 2]));
  unwrap(await writer.end());
  expect(await iterator.next()).toEqual({ done: true, value: undefined });
  scope.abort();
  expect(a.snapshot().streams).toBe(0);
  expect(b.snapshot().streams).toBe(0);
});
it('requires credit before writing and bounds eight in-flight frames', async () => {
  const { a, b } = pair(),
    reader = unwrap(b.createReader(ref)),
    writer = unwrap(a.createWriter(ref));
  unwrap(b.grantInitial(ref));
  for (let i = 0; i < 8; i++) unwrap(await writer.write(new Uint8Array([i])));
  let finished = false;
  const ninth = writer.write(new Uint8Array([8])).then((result) => {
    finished = true;
    return result;
  });
  expect(finished).toBe(false);
  const iterator = reader[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toEqual(new Uint8Array([0]));
  unwrap(await ninth);
  for (let i = 1; i < 9; i++) expect((await iterator.next()).value).toEqual(new Uint8Array([i]));
  unwrap(await writer.end());
  expect((await iterator.next()).done).toBe(true);
});
it('cancels pending reads and writes with task lifetime', async () => {
  const { a, b, scope } = pair(),
    reader = unwrap(b.createReader(ref)),
    writer = unwrap(a.createWriter(ref));
  const reading = reader[Symbol.asyncIterator]().next();
  const writing = writer.write(new Uint8Array([1]));
  scope.abort();
  await expect(reading).rejects.toMatchObject({ error: { code: 'cancelled' } });
  expect(await writing).toMatchObject({ ok: false });
  expect(a.snapshot().streams).toBe(0);
  expect(b.snapshot().streams).toBe(0);
});
it('refuses unknown or foreign-task control and late media frames', async () => {
  const { a, b } = pair();
  unwrap(b.createReader(ref));
  unwrap(a.createWriter(ref));
  expect(
    a.control({
      protocol: 1,
      id: 'm-1',
      sessionId: 'peer',
      owner,
      type: 'stream-credit',
      streamId: 'stream',
      taskId: 'other',
      credits: 1,
    }).ok,
  ).toBe(false);
  a.close();
  expect(
    b.receive({ header: { ...ref, sequence: 0, byteLength: 1 }, payload: new Uint8Array([1]) }).ok,
  ).toBe(true);
  b.close();
  expect(
    b.receive({ header: { ...ref, sequence: 1, byteLength: 1 }, payload: new Uint8Array([2]) }).ok,
  ).toBe(false);
});
it('refuses duplicate references and caps per-task endpoint count', () => {
  const { a } = pair();
  for (let i = 0; i < 4; i++) expect(a.createWriter({ ...ref, streamId: 's' + i }).ok).toBe(true);
  expect(a.createWriter({ ...ref, streamId: 's4' })).toMatchObject({
    ok: false,
    error: { code: 'quota-exceeded' },
  });
  expect(a.createWriter({ ...ref, streamId: 's0' })).toMatchObject({
    ok: false,
    error: { code: 'invalid-input' },
  });
  a.close(makeError('unavailable', false));
  expect(a.snapshot().streams).toBe(0);
});
