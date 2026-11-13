import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { KernelFault } from '@pet/host-kernel';
import type { QQMediaRead, QQMediaSource } from '@pet/companion-runtime';
import type { OfficialMediaIo } from './media-types.js';
import { unusedOfficialMedia } from './media-test-helpers.js';
import { uploadOfficialMedia } from './media.js';

function gate(): { promise: Promise<void>; resolve(): void; reject(reason: unknown): void } {
  let resolve = (): void => {};
  let reject = (_reason: unknown): void => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function source(
  bytes: Buffer,
  faultyRead: number,
  physical: Promise<void>,
  closing: () => void,
  logicalFailure = true,
): QQMediaSource {
  let reads = 0;
  return {
    name: 'cleanup-fixture.bin',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    async open(offset, length, signal): Promise<QQMediaRead> {
      const faulty = ++reads === faultyRead;
      let at = offset;
      let closed = false;
      const body: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              signal.throwIfAborted();
              if (closed || at === offset + length) return { done: true, value: undefined };
              const end = Math.min(at + 65536, offset + length);
              const part = bytes.subarray(at, end);
              at = end;
              return { done: false, value: part };
            },
            async return() {
              closed = true;
              if (faulty && logicalFailure) throw new KernelFault('permission-denied');
              return { done: true, value: undefined };
            },
          };
        },
      };
      return {
        body,
        settled: faulty ? physical : Promise.resolve(),
        cancel() {
          closed = true;
          if (faulty) closing();
        },
      };
    },
  };
}
const accepted = {
  status: 200,
  body: '{"file_uuid":"confirmed-native-file","file_info":"private-confirmed-info","ttl":300}',
};
const input = (body: QQMediaSource) => ({
  scene: 'c2c' as const,
  targetId: 'original-target',
  fileType: 4 as const,
  source: body,
});

test(
  'complete inline acceptance survives post-response revocation while actual reader join remains awaited',
  { timeout: 3000 },
  async (t) => {
    const physical = gate();
    const closing = gate();
    const abort = new AbortController();
    const bytes = Buffer.from('actual complete uploaded bytes');
    const body = source(bytes, 2, physical.promise, closing.resolve);
    t.after(() => physical.resolve());
    let calls = 0;
    const io = unusedOfficialMedia();
    io.inline = async (_metadata, stream) => {
      calls++;
      const hash = createHash('sha256');
      for await (const chunk of stream) hash.update(chunk);
      assert.equal(hash.digest('hex'), body.sha256);
      abort.abort(new KernelFault('permission-denied'));
      return { ok: true, value: accepted };
    };
    let ended = false;
    const operation = uploadOfficialMedia(io, input(body), 'original-epoch', abort.signal).then(
      (result) => {
        ended = true;
        return result;
      },
    );
    await closing.promise;
    assert.equal(ended, false);
    physical.resolve();
    const result = await operation;
    assert.ok(result.ok);
    assert.equal(result.value.receipt.kind, 'media-upload-accepted');
    if (result.value.receipt.kind === 'media-upload-accepted')
      assert.equal(result.value.receipt.file_uuid, 'confirmed-native-file');
    assert.equal(result.value.confirmedBytes, bytes.length);
    assert.equal(result.value.cleanup, 'settled');
    assert.equal(result.value.error?.code, 'permission-denied');
    assert.equal(calls, 1);
  },
);

test(
  'complete accepted receipt and bytes survive a real failed reader join without declaring cleanup settled',
  { timeout: 3000 },
  async () => {
    const physical = gate();
    const closing = gate();
    const bytes = Buffer.from('completed despite later close failure');
    const body = source(bytes, 2, physical.promise, closing.resolve, false);
    const io = unusedOfficialMedia();
    let calls = 0;
    io.inline = async (_metadata, stream) => {
      calls++;
      for await (const chunk of stream) assert.ok(chunk.length);
      return { ok: true, value: accepted };
    };
    let ended = false;
    const operation = uploadOfficialMedia(
      io,
      input(body),
      'original-epoch',
      new AbortController().signal,
    ).then((result) => {
      ended = true;
      return result;
    });
    await closing.promise;
    assert.equal(ended, false);
    physical.reject(new Error('native close could not be confirmed'));
    const result = await operation;
    assert.ok(result.ok);
    assert.equal(result.value.receipt.kind, 'media-upload-accepted');
    assert.equal(result.value.confirmedBytes, bytes.length);
    assert.equal(result.value.cleanup, 'failed');
    assert.equal(result.value.error?.code, 'internal');
    assert.equal(calls, 1);
  },
);

test(
  'a positively acknowledged PUT retains its byte fact but cleanup failure prevents every finish and later part',
  { timeout: 3000 },
  async () => {
    const bytes = Buffer.alloc(6 * 1024 * 1024, 17);
    const physical = gate();
    const closing = gate();
    const body = source(bytes, 2, physical.promise, closing.resolve, false);
    const calls: string[] = [];
    const io: OfficialMediaIo = unusedOfficialMedia();
    io.prepare = async () => {
      calls.push('prepare');
      return {
        ok: true,
        value: {
          kind: 'prepared',
          plan: {
            upload_id: 'real-prepare',
            block_size: 5 * 1024 * 1024,
            parts: [
              { index: 0, offset: 0, byteLength: 5 * 1024 * 1024 },
              { index: 1, offset: 5 * 1024 * 1024, byteLength: 1024 * 1024 },
            ],
          },
        },
      };
    };
    io.putPart = async (part, stream) => {
      calls.push(`put:${part.part_index}`);
      let count = 0;
      for await (const chunk of stream) count += chunk.length;
      assert.equal(count, part.byteLength);
      return { ok: true, value: { status: 204, body: '' } };
    };
    io.finishPart = async () => {
      calls.push('forbidden-finish');
      throw new Error();
    };
    io.commit = async () => {
      calls.push('forbidden-commit');
      throw new Error();
    };
    const operation = uploadOfficialMedia(
      io,
      input(body),
      'original-epoch',
      new AbortController().signal,
    );
    await closing.promise;
    physical.reject(new Error('physical part reader join failed'));
    const result = await operation;
    assert.ok(result.ok);
    assert.equal(result.value.receipt.kind, 'unknown');
    assert.equal(result.value.confirmedBytes, 5 * 1024 * 1024);
    assert.equal(result.value.completedParts, 0);
    assert.equal(result.value.cleanup, 'failed');
    assert.deepEqual(calls, ['prepare', 'put:0']);
  },
);

test('partial response and partial request body remain unknown after logical cleanup denial', async () => {
  for (const partial of ['response', 'request']) {
    const bytes = Buffer.alloc(100000, 29);
    const body = source(bytes, 2, Promise.resolve(), () => {});
    const io = unusedOfficialMedia();
    let calls = 0;
    io.inline = async (_metadata, stream) => {
      calls++;
      if (partial === 'response') {
        for await (const chunk of stream) assert.ok(chunk.length);
        return { ok: true, value: { status: 200, body: '{"file_uuid":"incomplete"' } };
      }
      await stream[Symbol.asyncIterator]().next();
      return { ok: true, value: accepted };
    };
    const result = await uploadOfficialMedia(
      io,
      input(body),
      'original-epoch',
      new AbortController().signal,
    );
    assert.ok(result.ok);
    assert.equal(result.value.receipt.kind, 'unknown');
    assert.equal(result.value.confirmedBytes, 0);
    assert.equal(result.value.cleanup, 'settled');
    assert.equal(result.value.error?.code, 'permission-denied');
    assert.equal(calls, 1);
  }
});

test(
  'preflight physical failure remains definitely undispatched and exposes failed cleanup',
  { timeout: 3000 },
  async () => {
    const physical = gate();
    const closing = gate();
    const body = source(Buffer.from('no upload yet'), 1, physical.promise, closing.resolve, false);
    const io = unusedOfficialMedia();
    const operation = uploadOfficialMedia(
      io,
      input(body),
      'original-epoch',
      new AbortController().signal,
    );
    await closing.promise;
    physical.reject(new Error('actual reader close failed'));
    const result = await operation;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.cleanup, 'failed');
      assert.equal(result.error.code, 'internal');
    }
  },
);
