import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { KernelFault } from '@pet/host-kernel';
import { makeError } from '@pet/contracts';
import type { QQIoOutcome, QQMediaRead, QQMediaSource } from '@pet/companion-runtime';
import { OneBotQqDriver } from './driver.js';
import type { OneBotActionFrame } from './wire.js';
import type { OneBotPeer } from './ports.js';
import { downloadSnowMedia, snowStagedSend, uploadSnowMedia } from './media.js';
import type { SnowMediaExchange, SnowMediaIo, SnowMediaLookup } from './media-types.js';
import {
  encodeSnowMediaRequest,
  parseSnowMediaEcho,
  SNOW_UPLOAD_CHUNK_BYTES,
  type SnowMediaRequest,
} from './media-wire.js';

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
function data(size: number): Buffer {
  const bytes = Buffer.alloc(size, 0x53);
  for (let at = 0; at + 4 <= size; at += 4096) bytes.writeUInt32LE(at, at);
  return bytes;
}
function echo(): () => string {
  let seq = 0;
  return () => `qq-media:00000000-0000-4000-8000-000000000001:${++seq}`;
}
class Source implements QQMediaSource {
  readonly name = 'synthetic.bin';
  readonly sizeBytes: number;
  readonly sha256: string;
  closes = 0;
  constructor(readonly bytes: Buffer) {
    this.sizeBytes = bytes.length;
    this.sha256 = sha(bytes);
  }
  async open(offset: number, length: number, signal: AbortSignal): Promise<QQMediaRead> {
    assert.equal(offset, 0);
    assert.equal(length, this.sizeBytes);
    let stopped = false;
    const bytes = this.bytes;
    let closed = false;
    return {
      body: (async function* (): AsyncGenerator<Uint8Array> {
        for (let at = 0; at < bytes.length; at += 17011) {
          signal.throwIfAborted();
          if (stopped) return;
          yield bytes.subarray(at, Math.min(at + 17011, bytes.length));
        }
      })(),
      settled: Promise.resolve(),
      cancel: () => {
        stopped = true;
        if (!closed) {
          closed = true;
          this.closes++;
        }
      },
    };
  }
}
class Queue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: ((value: IteratorResult<T>) => void)[] = [];
  private ended = false;
  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }
  end(): void {
    this.ended = true;
    for (const done of this.waiters.splice(0)) done({ done: true, value: undefined });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ done: false, value });
        if (this.ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: async () => {
        this.end();
        return { done: true, value: undefined };
      },
    };
  }
}
class Media implements SnowMediaIo {
  readonly calls: { action: string; echo: string; index: number | null; complete: boolean }[] = [];
  readonly echoes = new Set<string>();
  private nonce: string | null = null;
  private highWater = 0;
  readonly uploaded = new Map<
    string,
    { hash: ReturnType<typeof createHash>; chunks: number; bytes: number; finalHash: string | null }
  >();
  syncFailure: Error | null = null;
  sent: QQIoOutcome<null> = { ok: true, value: null };
  physical: Promise<void> = Promise.resolve();
  readonly closing = deferred();
  closes = 0;
  duplicateChunk = false;
  incorrectFinal = false;
  earlyEnd = false;
  unknownSize = false;
  readonly signals: AbortSignal[] = [];
  constructor(readonly download = data(190003)) {}
  openMedia(request: SnowMediaRequest, signal: AbortSignal): SnowMediaExchange {
    if (this.syncFailure) throw this.syncFailure;
    const parsed = parseSnowMediaEcho(request.echo);
    assert.ok(parsed);
    if ((this.nonce !== null && parsed.nonce !== this.nonce) || parsed.sequence <= this.highWater)
      throw new KernelFault('conflict');
    this.nonce = parsed.nonce;
    this.highWater = parsed.sequence;
    const encoded = encodeSnowMediaRequest(request);
    assert.ok(encoded.ok);
    const packet = JSON.parse(encoded.value) as {
      action: string;
      echo: string;
      params: {
        stream_id?: string;
        chunk_data?: string;
        chunk_index?: number;
        total_chunks?: number;
        file_size?: number;
        is_complete?: boolean;
        filename?: string;
        expected_sha256?: string;
        file?: string;
        file_id?: string;
      };
    };
    this.echoes.add(request.echo);
    this.signals.push(signal);
    this.calls.push({
      action: packet.action,
      echo: packet.echo,
      index: packet.params.chunk_index ?? null,
      complete: packet.params.is_complete === true,
    });
    const envelope = (body: unknown): string =>
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: request.echo,
        stream: 'stream-action',
        data: body,
      });
    let frames: AsyncIterable<string>;
    if (!this.sent.ok && !this.sent.dispatched)
      frames = (async function* (): AsyncGenerator<string> {})();
    else if (packet.action === 'upload_file_stream') {
      const id = packet.params.stream_id;
      assert.ok(id);
      let state = this.uploaded.get(id);
      if (!state) {
        state = { hash: createHash('sha256'), chunks: 0, bytes: 0, finalHash: null };
        this.uploaded.set(id, state);
      }
      if (packet.params.is_complete) {
        assert.equal(state.chunks, packet.params.total_chunks);
        assert.equal(state.bytes, packet.params.file_size);
        state.finalHash = state.hash.digest('hex');
        assert.equal(state.finalHash, packet.params.expected_sha256);
        const result = envelope({
          type: 'response',
          status: 'file_complete',
          stream_id: id,
          file_path: `/remote/stream/${id}/${packet.params.filename}`,
          file_name: packet.params.filename,
          file_size: state.bytes,
          sha256: this.incorrectFinal ? '0'.repeat(64) : state.finalHash,
          received_chunks: state.chunks,
          total_chunks: packet.params.total_chunks,
        });
        frames = (async function* (): AsyncGenerator<string> {
          yield result;
        })();
      } else {
        assert.equal(packet.params.chunk_index, state.chunks);
        assert.equal(typeof packet.params.chunk_data, 'string');
        const bytes = Buffer.from(packet.params.chunk_data ?? '', 'base64');
        state.hash.update(bytes);
        state.bytes += bytes.length;
        state.chunks++;
        const result = envelope({
          type: 'stream',
          status: 'chunk_received',
          stream_id: id,
          received_chunks: this.duplicateChunk ? state.chunks - 1 : state.chunks,
          total_chunks: packet.params.total_chunks,
        });
        frames = (async function* (): AsyncGenerator<string> {
          yield result;
        })();
      }
    } else {
      const bytes = this.download;
      const duplicate = this.duplicateChunk;
      const early = this.earlyEnd;
      const incorrect = this.incorrectFinal;
      const size = this.unknownSize ? 0 : bytes.length;
      frames = (async function* (): AsyncGenerator<string> {
        yield envelope({
          type: 'stream',
          data_type: 'file_info',
          file_name: 'download.bin',
          file_size: size,
          chunk_size: 16384,
        });
        let index = 0;
        for (let at = 0; at < bytes.length; at += 70001) {
          const chunk = bytes.subarray(at, Math.min(at + 70001, bytes.length));
          const base64 = chunk.toString('base64');
          const frame = envelope({
            type: 'stream',
            data_type: 'file_chunk',
            index,
            data: base64,
            size: chunk.length,
            base64_size: base64.length,
            progress: 0,
          });
          yield frame;
          if (duplicate) yield frame;
          index++;
        }
        if (!early)
          yield envelope({
            type: 'response',
            data_type: 'file_complete',
            file_name: 'download.bin',
            total_chunks: index,
            total_bytes: incorrect ? bytes.length + 1 : bytes.length,
          });
      })();
    }
    let closed = false;
    const physical = this.physical;
    return {
      sent: Promise.resolve(this.sent),
      frames: {
        async *[Symbol.asyncIterator]() {
          for await (const frame of frames) {
            if (closed) return;
            yield frame;
          }
        },
      },
      settled: physical,
      close: async () => {
        if (!closed) {
          closed = true;
          this.closes++;
          this.closing.resolve();
        }
        await physical;
      },
    };
  }
}
const signal = (): AbortSignal => new AbortController().signal;
const lookup: SnowMediaLookup = async () => ({
  ok: true,
  value: {
    kind: 'response',
    echo: 'lookup',
    status: 'ok',
    retcode: 0,
    data: { url: 'https://cdn.example.invalid/authorized-file' },
  },
});

test('SnowLuma private/group image voice and file stages reconstruct fragmented bytes and publish only explicitly', async () => {
  for (const scene of ['private', 'group'] as const)
    for (const kind of ['image', 'voice', 'file', 'text'] as const) {
      const source = new Source(data(100007));
      const native = new Media();
      const result = await uploadSnowMedia(
        native,
        { scene, targetId: '30001', kind, source },
        'connection-a',
        echo(),
        signal(),
      );
      assert.ok(result.ok && result.value.kind === 'complete');
      const staged = result.value.value;
      assert.equal(staged.sha256, source.sha256);
      assert.equal(staged.sizeBytes, source.sizeBytes);
      assert.equal(staged.connectionId, 'connection-a');
      assert.ok(staged.remotePath.startsWith('/remote/'));
      assert.equal(native.calls.length, Math.ceil(source.sizeBytes / SNOW_UPLOAD_CHUNK_BYTES) + 1);
      assert.ok(native.calls.every((call) => call.action === 'upload_file_stream'));
      assert.equal(native.echoes.size, native.calls.length);
      assert.equal([...native.uploaded.values()][0]?.finalHash, source.sha256);
      assert.equal(source.closes, 1);
      const publish = snowStagedSend(staged);
      assert.ok(publish.ok);
      assert.equal(
        publish.value.action,
        kind === 'file' || kind === 'text'
          ? scene === 'group'
            ? 'upload_group_file'
            : 'upload_private_file'
          : scene === 'group'
            ? 'send_group_msg'
            : 'send_private_msg',
      );
      if (kind === 'file' || kind === 'text')
        assert.equal(publish.value.params['upload_file'], true);
    }
});

test(
  'SnowLuma full 32MiB stream and an empty file finish only after exact chunk count and SHA256',
  { timeout: 10000 },
  async () => {
    for (const size of [32 * 1024 * 1024, 0]) {
      const source = new Source(data(size));
      const native = new Media();
      const result = await uploadSnowMedia(
        native,
        { scene: 'private', targetId: '30001', kind: 'file', source },
        'a',
        echo(),
        signal(),
      );
      assert.ok(result.ok && result.value.kind === 'complete');
      assert.equal(result.value.value.sizeBytes, size);
      assert.equal(result.value.value.sha256, source.sha256);
      assert.equal(native.calls.length, Math.max(1, Math.ceil(size / SNOW_UPLOAD_CHUNK_BYTES)) + 1);
      assert.equal(native.calls.filter((call) => call.complete).length, 1);
    }
  },
);

test('SnowLuma duplicate upload progress or wrong terminal hash never becomes a staged handle or a retry', async () => {
  for (const mode of ['duplicate', 'hash']) {
    const source = new Source(data(40001));
    const native = new Media();
    native.duplicateChunk = mode === 'duplicate';
    native.incorrectFinal = mode === 'hash';
    const result = await uploadSnowMedia(
      native,
      { scene: 'private', targetId: '30001', kind: 'file', source },
      'a',
      echo(),
      signal(),
    );
    assert.ok(result.ok);
    assert.equal(result.value.kind, 'unknown');
    assert.equal(native.calls.length, mode === 'duplicate' ? 1 : 3);
  }
});

test('SnowLuma known synchronous refusal is undispatched; unexpected registration failure remains unknown', async () => {
  const source = new Source(data(17));
  const native = new Media();
  native.syncFailure = new KernelFault('permission-denied');
  const denied = await uploadSnowMedia(
    native,
    { scene: 'private', targetId: '30001', kind: 'file', source },
    'a',
    echo(),
    signal(),
  );
  assert.equal(denied.ok, false);
  assert.equal(native.calls.length, 0);
  native.syncFailure = new Error('unknown native registration failure');
  const unknown = await uploadSnowMedia(
    native,
    { scene: 'private', targetId: '30001', kind: 'file', source },
    'a',
    echo(),
    signal(),
  );
  assert.ok(unknown.ok);
  assert.equal(unknown.value.kind, 'unknown');
  assert.equal(native.calls.length, 0);
});

test('SnowLuma actual sent outcome keeps auth refusal definite and post-dispatch cancellation unknown', async () => {
  for (const dispatched of [false, true]) {
    const native = new Media();
    native.sent = { ok: false, error: makeError('cancelled', false), dispatched };
    const result = await uploadSnowMedia(
      native,
      { scene: 'private', targetId: '30001', kind: 'file', source: new Source(data(17)) },
      'a',
      echo(),
      signal(),
    );
    if (!dispatched) assert.equal(result.ok, false);
    else {
      assert.ok(result.ok);
      assert.equal(result.value.kind, 'unknown');
    }
    assert.equal(native.calls.length, 1);
  }
});

test('SnowLuma download checks offsets/hash and ignores requested chunk size as a hard promise for URL streams', async () => {
  const native = new Media();
  native.unknownSize = true;
  const hash = createHash('sha256');
  const offsets: number[] = [];
  const result = await downloadSnowMedia(
    native,
    lookup,
    {
      source: {
        kind: 'file',
        scene: 'group',
        targetId: '30001',
        fileId: 'remote-file-id',
        fileHash: null,
        busid: 102,
      },
      expectedSizeBytes: native.download.length,
      expectedSha256: sha(native.download),
    },
    async (chunk, offset) => {
      offsets.push(offset);
      hash.update(chunk);
    },
    'a',
    echo(),
    signal(),
  );
  assert.ok(result.ok && result.value.kind === 'complete');
  assert.equal(result.value.value.sha256, hash.digest('hex'));
  assert.equal(result.value.value.sizeBytes, native.download.length);
  assert.equal('transferId' in result.value.value, false);
  assert.deepEqual(offsets, [0, 70001, 140002]);
  assert.equal(native.calls[0]?.action, 'download_file_stream');
});

test('SnowLuma download rejects duplicate indices, wrong terminal counts and early EOF without publishing a file', async () => {
  for (const mode of ['duplicate', 'count', 'eof']) {
    const native = new Media();
    native.duplicateChunk = mode === 'duplicate';
    native.incorrectFinal = mode === 'count';
    native.earlyEnd = mode === 'eof';
    let bytes = 0;
    const result = await downloadSnowMedia(
      native,
      lookup,
      {
        source: { kind: 'image', fileId: 'cached-image' },
        expectedSizeBytes: null,
        expectedSha256: null,
      },
      async (chunk) => {
        bytes += chunk.length;
      },
      'a',
      echo(),
      signal(),
    );
    assert.ok(result.ok);
    assert.equal(result.value.kind, 'unknown');
    assert.ok(bytes <= native.download.length);
    assert.equal(native.calls.length, 1);
  }
});

test(
  'SnowLuma cancellation stops further consumer bytes and joins actual transfer settlement',
  { timeout: 3000 },
  async (t) => {
    const native = new Media();
    const physical = deferred();
    native.physical = physical.promise;
    const abort = new AbortController();
    let writes = 0;
    let ended = false;
    t.after(() => physical.resolve());
    const work = downloadSnowMedia(
      native,
      lookup,
      {
        source: { kind: 'voice', fileId: 'cached-voice' },
        expectedSizeBytes: null,
        expectedSha256: null,
      },
      async () => {
        writes++;
        abort.abort();
      },
      'a',
      echo(),
      abort.signal,
    ).then((result) => {
      ended = true;
      return result;
    });
    await native.closing.promise;
    await Promise.resolve();
    assert.equal(ended, false);
    assert.equal(writes, 1);
    physical.resolve();
    const result = await work;
    assert.ok(result.ok);
    assert.equal(result.value.kind, 'unknown');
    assert.equal(writes, 1);
  },
);

test(
  'OneBot driver close fences an in-flight media epoch and joins the native exchange without replay',
  { timeout: 3000 },
  async (t) => {
    const native = new Media();
    const physicalMedia = deferred();
    native.physical = physicalMedia.promise;
    const frames = new Queue<string>();
    const physicalPeer = deferred();
    const retired = new AbortController();
    const ready = deferred();
    const peer: OneBotPeer = {
      id: 'closing-media-peer',
      selfId: '10001',
      signal: retired.signal,
      frames,
      settled: physicalPeer.promise,
      openMedia: (request, live) => native.openMedia(request, live),
      send: async () => {
        throw new Error('no message publication during staging');
      },
      close: async () => {
        retired.abort();
        frames.end();
        physicalPeer.resolve();
      },
    };
    const driver = new OneBotQqDriver(
      '10001',
      { nextPeer: async () => peer, close: () => peer.close() },
      {
        onStatus: (state) => {
          if (state.phase === 'ready') ready.resolve();
        },
        onEvent: async () => {
          throw new Error('stream is not an event');
        },
      },
    );
    t.after(async () => {
      physicalMedia.resolve();
      await driver.close();
    });
    const root = driver.start(signal());
    await ready.promise;
    const source = new Source(data(40001));
    const input = { scene: 'private' as const, targetId: '30001', kind: 'file' as const, source };
    assert.equal((await driver.uploadMedia(input, signal(), 'wrong-peer')).ok, false);
    assert.equal(native.calls.length, 0);
    const upload = driver.uploadMedia(input, signal(), peer.id);
    await native.closing.promise;
    let closed = false;
    const closing = driver.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    assert.equal(native.signals[0]?.aborted, true);
    assert.equal(closed, false);
    assert.equal(source.closes, 0);
    physicalMedia.resolve();
    const result = await upload;
    assert.ok(result.ok);
    assert.equal(result.value.kind, 'unknown');
    assert.equal(native.calls.length, 1);
    assert.equal(source.closes, 1);
    await closing;
    await root;
  },
);

test(
  'OneBot driver media handles stay on their epoch and a staged file publishes by exactly one existing file action',
  { timeout: 3000 },
  async () => {
    const native = new Media();
    const frames = new Queue<string>();
    const physical = deferred();
    const retired = new AbortController();
    const ready = deferred();
    const published: OneBotActionFrame[] = [];
    const peer: OneBotPeer = {
      id: 'media-peer',
      selfId: '10001',
      signal: retired.signal,
      frames,
      settled: physical.promise,
      openMedia: (request, live) => native.openMedia(request, live),
      send: async (frame) => {
        published.push(frame);
        frames.push(
          JSON.stringify({
            status: 'ok',
            retcode: 0,
            echo: frame.echo,
            data: { file_id: 'native-published-file' },
          }),
        );
        return { ok: true, value: null };
      },
      close: async () => {
        retired.abort();
        frames.end();
        physical.resolve();
      },
    };
    const io = { nextPeer: async () => peer, close: () => peer.close() };
    const driver = new OneBotQqDriver('10001', io, {
      onStatus: (state) => {
        if (state.phase === 'ready') ready.resolve();
      },
      onEvent: async () => {
        throw new Error('media packets must not be admitted as messages');
      },
    });
    const root = driver.start(signal());
    await ready.promise;
    try {
      const result = await driver.uploadMedia(
        { scene: 'private', targetId: '30001', kind: 'file', source: new Source(data(40001)) },
        signal(),
        peer.id,
      );
      assert.ok(result.ok && result.value.kind === 'complete');
      assert.equal(published.length, 0);
      const staged = result.value.value;
      assert.equal(Object.isFrozen(staged), true);
      const send = await driver.sendStaged(staged, signal(), peer.id);
      assert.ok(send.ok);
      assert.equal(published.length, 1);
      assert.equal(published[0]?.action, 'upload_private_file');
      assert.equal(published[0]?.params['upload_file'], true);
      assert.equal((await driver.sendStaged({ ...staged }, signal(), peer.id)).ok, false);
      assert.equal((await driver.sendStaged(staged, signal(), 'replacement-peer')).ok, false);
      assert.equal(published.length, 1);
    } finally {
      await driver.close();
      await root;
    }
  },
);
