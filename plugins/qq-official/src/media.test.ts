import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { KernelFault } from '@pet/host-kernel';
import { makeError } from '@pet/contracts';
import type { QQMediaRead, QQMediaSource } from '@pet/companion-runtime';
import { readOfficialAttachment, uploadOfficialMedia } from './media.js';
import type { OfficialMediaIo } from './media-types.js';
import { OFFICIAL_PREFIX_HASH_BYTES, type OfficialMediaHashes } from './media-wire.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function fixture(size: number): Buffer {
  const data = Buffer.alloc(size, 0x61);
  for (let at = 0; at + 4 <= size; at += 65536) data.writeUInt32LE(at / 65536, at);
  return data;
}
class Source implements QQMediaSource {
  readonly name = 'synthetic.bin';
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly ranges: [number, number][] = [];
  closes = 0;
  closeGate: Promise<void> = Promise.resolve();
  readonly closing = deferred();
  mutateAfterHash = false;
  constructor(readonly bytes: Buffer) {
    this.sizeBytes = bytes.length;
    this.sha256 = sha(bytes);
  }
  async open(offset: number, length: number, signal: AbortSignal): Promise<QQMediaRead> {
    signal.throwIfAborted();
    this.ranges.push([offset, length]);
    const turn = this.ranges.length;
    let stopped = false;
    let cancelled = false;
    const data = this.mutateAfterHash && turn > 1 ? Buffer.from(this.bytes) : this.bytes;
    if (this.mutateAfterHash && turn > 1 && data.length) data[0] = (data[0] ?? 0) ^ 1;
    const body = (async function* (): AsyncGenerator<Uint8Array> {
      for (let at = offset; at < offset + length; at += 65537) {
        signal.throwIfAborted();
        if (stopped) return;
        yield data.subarray(at, Math.min(at + 65537, offset + length));
      }
    })();
    return {
      body,
      settled: this.closeGate,
      cancel: () => {
        if (!cancelled) {
          cancelled = true;
          stopped = true;
          this.closes++;
          this.closing.resolve();
        }
      },
    };
  }
}
function nativeIo(source: Source): {
  io: OfficialMediaIo;
  calls: string[];
  hashes: OfficialMediaHashes[];
  uploads: Map<number, { md5: string; bytes: number }>;
  cloudHash: () => string;
} {
  const calls: string[] = [];
  const hashes: OfficialMediaHashes[] = [];
  const uploads = new Map<number, { md5: string; bytes: number }>();
  const cloud = createHash('sha256');
  const block = 5 * 1024 * 1024;
  const io: OfficialMediaIo = {
    async inline(metadata, body) {
      calls.push('inline');
      assert.equal(metadata.srv_send_msg, false);
      const hash = createHash('sha256');
      let count = 0;
      for await (const bytes of body) {
        count += bytes.length;
        hash.update(bytes);
      }
      assert.equal(count, source.sizeBytes);
      assert.equal(hash.digest('hex'), source.sha256);
      return {
        ok: true,
        value: {
          status: 200,
          body: '{"file_uuid":"native-file","file_info":"private-native-info","ttl":300}',
        },
      };
    },
    async prepare(metadata, values) {
      calls.push('prepare');
      hashes.push(values);
      assert.equal(metadata.sizeBytes, source.sizeBytes);
      return {
        ok: true,
        value: {
          kind: 'prepared',
          plan: {
            upload_id: 'actual-upload-id',
            block_size: block,
            parts: Array.from({ length: Math.ceil(source.sizeBytes / block) }, (_, index) => ({
              index,
              offset: index * block,
              byteLength: Math.min(block, source.sizeBytes - index * block),
            })),
          },
        },
      };
    },
    async putPart(input, body) {
      calls.push(`part:${input.part_index}`);
      assert.equal(input.upload_id, 'actual-upload-id');
      assert.equal('url' in input, false);
      const md5 = createHash('md5');
      let count = 0;
      for await (const bytes of body) {
        count += bytes.length;
        md5.update(bytes);
        cloud.update(bytes);
      }
      assert.equal(count, input.byteLength);
      uploads.set(input.part_index, { md5: md5.digest('hex'), bytes: count });
      return { ok: true, value: { status: 204, body: '' } };
    },
    async finishPart(input) {
      calls.push(`finish:${input.part_index}`);
      assert.equal(input.md5, uploads.get(input.part_index)?.md5);
      assert.equal(input.block_size, String(uploads.get(input.part_index)?.bytes));
      return { ok: true, value: { status: 200, body: '{}' } };
    },
    async commit(input) {
      calls.push('commit');
      assert.equal(input.upload_id, 'actual-upload-id');
      assert.equal(input.srv_send_msg, false);
      return {
        ok: true,
        value: {
          status: 200,
          body: '{"file_uuid":"actual-committed-file","file_info":"private-committed-info","ttl":300}',
        },
      };
    },
    async readAttachment(_input, signal, check) {
      await check();
      const read = await source.open(0, source.sizeBytes, signal);
      return {
        ...read,
        body: (async function* (): AsyncGenerator<Uint8Array> {
          for await (const bytes of read.body) {
            await check();
            signal.throwIfAborted();
            yield bytes;
          }
          await check();
        })(),
      };
    },
  };
  return { io, calls, hashes, uploads, cloudHash: () => cloud.digest('hex') };
}
const signal = (): AbortSignal => new AbortController().signal;

test('official inline private/group image voice and file routes carry identical bytes with explicit no-send', async () => {
  for (const scene of ['c2c', 'group'] as const)
    for (const fileType of [1, 3, 4] as const) {
      const source = new Source(fixture(113));
      const native = nativeIo(source);
      const result = await uploadOfficialMedia(
        native.io,
        { scene, targetId: 'native-target', fileType, source },
        'connection-a',
        signal(),
      );
      assert.ok(result.ok);
      assert.equal(result.value.receipt.kind, 'media-upload-accepted');
      assert.equal(result.value.confirmedBytes, 113);
      assert.deepEqual(native.calls, ['inline']);
      assert.deepEqual(source.ranges, [
        [0, 113],
        [0, 113],
      ]);
      assert.equal(source.closes, 2);
    }
});

test(
  'official full 32MiB upload verifies whole and prefix hashes, exact offsets, one PUT/finish per part and one commit',
  { timeout: 10000 },
  async () => {
    const source = new Source(fixture(32 * 1024 * 1024));
    const native = nativeIo(source);
    const result = await uploadOfficialMedia(
      native.io,
      { scene: 'group', targetId: 'group', fileType: 4, source },
      'connection-a',
      signal(),
    );
    assert.ok(result.ok);
    assert.equal(result.value.receipt.kind, 'media-upload-accepted');
    assert.equal(result.value.completedParts, 7);
    assert.equal(result.value.confirmedBytes, source.sizeBytes);
    assert.equal(native.cloudHash(), source.sha256);
    assert.deepEqual(native.calls, [
      'prepare',
      ...Array.from({ length: 7 }, (_, i) => [`part:${i}`, `finish:${i}`]).flat(),
      'commit',
    ]);
    assert.deepEqual(native.hashes[0], {
      md5: createHash('md5').update(source.bytes).digest('hex'),
      sha1: createHash('sha1').update(source.bytes).digest('hex'),
      sha256: source.sha256,
      md5_10m: createHash('md5')
        .update(source.bytes.subarray(0, OFFICIAL_PREFIX_HASH_BYTES))
        .digest('hex'),
    });
    assert.deepEqual(
      source.ranges.slice(1),
      Array.from({ length: 7 }, (_, i) => [
        i * 5 * 1024 * 1024,
        Math.min(5 * 1024 * 1024, source.sizeBytes - i * 5 * 1024 * 1024),
      ]),
    );
    assert.equal(source.closes, 8);
  },
);

test('official changed material between hash and PUT never reaches commit or fabricates file_info', async () => {
  const source = new Source(fixture(6 * 1024 * 1024));
  source.mutateAfterHash = true;
  const native = nativeIo(source);
  const result = await uploadOfficialMedia(
    native.io,
    { scene: 'c2c', targetId: 'u', fileType: 4, source },
    'a',
    signal(),
  );
  assert.ok(result.ok);
  assert.equal(result.value.receipt.kind, 'unknown');
  assert.equal(result.value.completedParts, 2);
  assert.equal(native.calls.includes('commit'), false);
  assert.equal(JSON.stringify(result).includes('private-committed-info'), false);
});

test('official driver seam rejects private URL-bearing plans and an unexpected finish receipt', async () => {
  const source = new Source(fixture(6 * 1024 * 1024));
  const native = nativeIo(source);
  const original = native.io.prepare;
  native.io.prepare = async (...args) => {
    const reply = await original(...args);
    if (!reply.ok || reply.value.kind !== 'prepared') return reply;
    return {
      ok: true,
      value: {
        kind: 'prepared',
        plan: {
          ...reply.value.plan,
          parts: reply.value.plan.parts.map((part) => ({
            ...part,
            presigned_url: 'https://private.invalid/?secret=hidden',
          })),
        },
      },
    };
  };
  const unsafe = await uploadOfficialMedia(
    native.io,
    { scene: 'group', targetId: 'g', fileType: 4, source },
    'a',
    signal(),
  );
  assert.ok(unsafe.ok);
  assert.equal(unsafe.value.receipt.kind, 'unknown');
  assert.deepEqual(native.calls, ['prepare']);
  assert.equal(JSON.stringify(unsafe).includes('hidden'), false);
  native.io.prepare = original;
  native.io.finishPart = async () => ({
    ok: true,
    value: {
      status: 200,
      body: '{"file_uuid":"wrong-stage","file_info":"must-not-promote","ttl":300}',
    },
  });
  const finish = await uploadOfficialMedia(
    native.io,
    { scene: 'group', targetId: 'g', fileType: 4, source },
    'a',
    signal(),
  );
  assert.ok(finish.ok);
  assert.equal(finish.value.receipt.kind, 'unknown');
  assert.equal(native.calls.includes('commit'), false);
});

test('official predispatch refusal is definite, begun IO failure is unknown, and neither retries', async () => {
  const source = new Source(fixture(19));
  const native = nativeIo(source);
  let calls = 0;
  native.io.inline = async () => {
    calls++;
    return { ok: false, error: makeError('permission-denied', false), dispatched: false };
  };
  const denied = await uploadOfficialMedia(
    native.io,
    { scene: 'c2c', targetId: 'u', fileType: 4, source },
    'a',
    signal(),
  );
  assert.equal(denied.ok, false);
  assert.equal(calls, 1);
  native.io.inline = async () => {
    calls++;
    return { ok: false, error: makeError('network', false), dispatched: true };
  };
  const unknown = await uploadOfficialMedia(
    native.io,
    { scene: 'c2c', targetId: 'u', fileType: 4, source },
    'a',
    signal(),
  );
  assert.ok(unknown.ok);
  assert.equal(unknown.value.receipt.kind, 'unknown');
  assert.equal(calls, 2);
});

test('official bytes not consumed cannot become an accepted inline receipt', async () => {
  const source = new Source(fixture(19));
  const native = nativeIo(source);
  native.io.inline = async () => ({
    ok: true,
    value: { status: 200, body: '{"file_uuid":"unproved","file_info":"unproved","ttl":300}' },
  });
  const result = await uploadOfficialMedia(
    native.io,
    { scene: 'c2c', targetId: 'u', fileType: 4, source },
    'a',
    signal(),
  );
  assert.ok(result.ok);
  assert.equal(result.value.receipt.kind, 'unknown');
  assert.equal(result.value.confirmedBytes, 0);
});

test(
  'official cancellation joins actual source settlement before returning and starts no upload',
  { timeout: 3000 },
  async (t) => {
    const source = new Source(fixture(19));
    const physical = deferred();
    source.closeGate = physical.promise;
    const native = nativeIo(source);
    const abort = new AbortController();
    t.after(() => physical.resolve());
    let ended = false;
    const work = uploadOfficialMedia(
      native.io,
      { scene: 'c2c', targetId: 'u', fileType: 4, source },
      'a',
      abort.signal,
    ).then((result) => {
      ended = true;
      return result;
    });
    await source.closing.promise;
    abort.abort();
    await Promise.resolve();
    assert.equal(ended, false);
    assert.deepEqual(native.calls, []);
    physical.resolve();
    const result = await work;
    assert.equal(result.ok, false);
    assert.deepEqual(native.calls, []);
  },
);

test('official attachment read preserves offsets/hash and rechecks a changed participant grant between chunks', async () => {
  const source = new Source(fixture(200000));
  const native = nativeIo(source);
  const offsets: number[] = [];
  const written = createHash('sha256');
  let checks = 0;
  const input = {
    scene: 'group' as const,
    targetId: 'group',
    url: 'https://multimedia.nt.qq.com.cn/download?fixture',
    name: 'attachment.bin',
    maximumBytes: 200000,
    expectedSizeBytes: 200000,
    expectedSha256: source.sha256,
  };
  const result = await readOfficialAttachment(
    native.io,
    input,
    async (chunk, offset) => {
      offsets.push(offset);
      written.update(chunk);
    },
    'a',
    signal(),
    async () => {
      checks++;
    },
  );
  assert.ok(result.ok);
  assert.equal(result.value.sha256, source.sha256);
  assert.equal(written.digest('hex'), source.sha256);
  assert.deepEqual(offsets, [0, 65537, 131074, 196611]);
  assert.ok(checks >= 6);
  let allowed = true;
  let delivered = 0;
  const denied = await readOfficialAttachment(
    native.io,
    input,
    async () => {
      delivered++;
      allowed = false;
    },
    'a',
    signal(),
    async () => {
      if (!allowed) throw new KernelFault('permission-denied');
    },
  );
  assert.equal(denied.ok, false);
  assert.equal(delivered, 1);
  if (!denied.ok) assert.equal(denied.error.code, 'permission-denied');
});
