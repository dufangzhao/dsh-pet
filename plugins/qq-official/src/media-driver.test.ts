import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { KernelFault } from '@pet/host-kernel';
import type { QQMediaSource } from '@pet/companion-runtime';
import { OfficialQqDriver } from './driver.js';
import type { OfficialGateway, OfficialIo } from './ports.js';
import { unusedOfficialMedia } from './media-test-helpers.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class Frames implements AsyncIterable<string> {
  private values: string[] = [];
  private waiting: ((value: IteratorResult<string>) => void) | null = null;
  private ended = false;
  push(value: unknown): void {
    const text = JSON.stringify(value);
    const read = this.waiting;
    this.waiting = null;
    if (read) read({ done: false, value: text });
    else this.values.push(text);
  }
  end(): void {
    this.ended = true;
    this.waiting?.({ done: true, value: undefined });
    this.waiting = null;
  }
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ done: false, value });
        if (this.ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((done) => {
          this.waiting = done;
        });
      },
      return: async () => {
        this.end();
        return { done: true, value: undefined };
      },
    };
  }
}
async function running(): Promise<{
  driver: OfficialQqDriver;
  io: OfficialIo;
  root: Promise<void>;
}> {
  const frames = new Frames();
  const lifetime = new AbortController();
  const physical = deferred();
  const identified = deferred();
  const ready = deferred();
  const gateway: OfficialGateway = {
    id: 'media-epoch',
    signal: lifetime.signal,
    frames,
    settled: physical.promise,
    identify: async () => {
      identified.resolve();
    },
    resume: async () => {},
    heartbeat: async () => {},
    close: async () => {
      lifetime.abort();
      frames.end();
      physical.resolve();
    },
  };
  const io: OfficialIo = {
    media: unusedOfficialMedia(),
    openGateway: async () => gateway,
    send: async () => {
      throw new Error('unexpected message');
    },
    upload: async () => {
      throw new Error('unexpected control upload');
    },
    close: () => gateway.close(),
  };
  const driver = new OfficialQqDriver(io, {
    onStatus: (status) => {
      if (status.phase === 'ready') ready.resolve();
    },
    onEvent: async () => {},
  });
  const root = driver.start(new AbortController().signal);
  frames.push({ op: 10, d: { heartbeat_interval: 60000 } });
  await identified.promise;
  frames.push({ op: 0, t: 'READY', s: 1, d: { session_id: 'session', user: { id: 'bot' } } });
  await ready.promise;
  return { driver, io, root };
}

test(
  'official media captures epoch before source IO and driver close joins the owned reader',
  { timeout: 3000 },
  async (t) => {
    const f = await running();
    const physical = deferred();
    const closing = deferred();
    const bytes = Buffer.from('owned fixture');
    let opened = 0;
    t.after(async () => {
      physical.resolve();
      await f.driver.close();
    });
    const source: QQMediaSource = {
      name: 'file.bin',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      open: async () => {
        opened++;
        return {
          body: (async function* (): AsyncGenerator<Uint8Array> {
            yield bytes;
          })(),
          settled: physical.promise,
          cancel: () => closing.resolve(),
        };
      },
    };
    const input = { scene: 'c2c' as const, targetId: 'u', fileType: 4 as const, source };
    assert.equal(
      (await f.driver.uploadMedia(input, new AbortController().signal, 'other-epoch')).ok,
      false,
    );
    assert.equal(opened, 0);
    const upload = f.driver.uploadMedia(input, new AbortController().signal, 'media-epoch');
    await closing.promise;
    let retired = false;
    const close = f.driver.close().then(() => {
      retired = true;
    });
    await Promise.resolve();
    assert.equal(retired, false);
    physical.resolve();
    const result = await upload;
    assert.equal(result.ok, false);
    await close;
    await f.root;
    assert.equal(opened, 1);
  },
);

test(
  'an accepted upload with failed material cleanup does not retire the gateway or unrelated control sends',
  { timeout: 3000 },
  async (t) => {
    const f = await running();
    const closing = deferred();
    let rejectPhysical: (error: unknown) => void = () => {};
    const physical = new Promise<void>((_resolve, reject) => {
      rejectPhysical = reject;
    });
    const bytes = Buffer.from('complete upload');
    let reads = 0;
    const source: QQMediaSource = {
      name: 'file.bin',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      open: async () => {
        const faulty = ++reads === 2;
        return {
          body: (async function* (): AsyncGenerator<Uint8Array> {
            yield bytes;
          })(),
          settled: faulty ? physical : Promise.resolve(),
          cancel: () => {
            if (faulty) closing.resolve();
          },
        };
      },
    };
    f.io.media.inline = async (_input, body) => {
      for await (const chunk of body) assert.ok(chunk.length);
      return {
        ok: true,
        value: {
          status: 200,
          body: '{"file_uuid":"accepted-file","file_info":"private-accepted","ttl":300}',
        },
      };
    };
    f.io.send = async () => ({
      ok: true,
      value: { status: 200, body: '{"id":"other-operation"}' },
    });
    t.after(async () => {
      await f.driver.close().catch(() => {});
      await f.root.catch(() => {});
    });
    const upload = f.driver.uploadMedia(
      { scene: 'c2c', targetId: 'u', fileType: 4, source },
      new AbortController().signal,
      'media-epoch',
    );
    await closing.promise;
    rejectPhysical(new Error('one material resource failed to join'));
    const result = await upload;
    assert.ok(result.ok);
    assert.equal(result.value.receipt.kind, 'media-upload-accepted');
    assert.equal(result.value.cleanup, 'failed');
    assert.equal(f.driver.status.phase, 'ready');
    const other = await f.driver.send(
      'c2c',
      'u',
      { msg_type: 0, content: 'separate intent', msg_seq: 1, msg_id: 'original-message' },
      new AbortController().signal,
      'media-epoch',
    );
    assert.ok(other.ok);
    assert.equal(other.value.receipt.kind, 'message-accepted');
    await assert.rejects(f.driver.close(), /errors.internal/u);
    await assert.rejects(f.root, /errors.internal/u);
    assert.equal(f.driver.status.phase, 'failed');
  },
);

test(
  'failed physical media joins retain both slots and make final source retirement fail without cleanup retries',
  { timeout: 3000 },
  async (t) => {
    const f = await running();
    const bytes = Buffer.from('failed resource stays counted');
    let opens = 0;
    let uploads = 0;
    t.after(async () => {
      await f.driver.close().catch(() => {});
      await f.root.catch(() => {});
    });
    f.io.media.inline = async (_input, body) => {
      uploads++;
      for await (const chunk of body) assert.ok(chunk.length);
      return {
        ok: true,
        value: { status: 200, body: '{"file_uuid":"accepted","file_info":"private","ttl":300}' },
      };
    };
    for (let slot = 0; slot < 2; slot++) {
      const closing = deferred();
      let rejectPhysical: (error: unknown) => void = () => {};
      const physical = new Promise<void>((_resolve, reject) => {
        rejectPhysical = reject;
      });
      let reads = 0;
      const source: QQMediaSource = {
        name: 'fixture.bin',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        open: async () => {
          opens++;
          const faulty = ++reads === 2;
          return {
            body: (async function* (): AsyncGenerator<Uint8Array> {
              yield bytes;
            })(),
            settled: faulty ? physical : Promise.resolve(),
            cancel: () => {
              if (faulty) closing.resolve();
            },
          };
        },
      };
      const upload = f.driver.uploadMedia(
        { scene: 'c2c', targetId: 'u', fileType: 4, source },
        new AbortController().signal,
        'media-epoch',
      );
      await closing.promise;
      rejectPhysical(new Error('physical resource did not join'));
      const result = await upload;
      assert.ok(result.ok);
      assert.equal(result.value.receipt.kind, 'media-upload-accepted');
      assert.equal(result.value.cleanup, 'failed');
    }
    assert.equal(opens, 4);
    assert.equal(uploads, 2);
    const forbidden: QQMediaSource = {
      name: 'must-not-open.bin',
      sizeBytes: 0,
      sha256: createHash('sha256').digest('hex'),
      open: async () => {
        opens++;
        throw new Error('failed slots must not be recycled');
      },
    };
    const overflow = await f.driver.uploadMedia(
      { scene: 'c2c', targetId: 'u', fileType: 4, source: forbidden },
      new AbortController().signal,
      'media-epoch',
    );
    assert.equal(overflow.ok, false);
    if (!overflow.ok) assert.equal(overflow.error.code, 'quota-exceeded');
    assert.equal(opens, 4);
    assert.equal(uploads, 2);
    await assert.rejects(f.driver.close(), /errors.internal/u);
    await assert.rejects(f.root, /errors.internal/u);
    assert.equal(f.driver.status.phase, 'failed');
    assert.equal(opens, 4);
    assert.equal(uploads, 2);
  },
);

test(
  'official attachment callback is a separate native argument and grant denial does not claim early cleanup',
  { timeout: 3000 },
  async (t) => {
    const f = await running();
    const physical = deferred();
    const closing = deferred();
    let allowed = true;
    let writes = 0;
    t.after(async () => {
      physical.resolve();
      await f.driver.close();
    });
    f.io.media.readAttachment = async (input, signal, check) => {
      assert.equal('check' in input, false);
      assert.equal(typeof check, 'function');
      await check();
      return {
        body: (async function* (): AsyncGenerator<Uint8Array> {
          for (let i = 0; i < 2; i++) {
            await check();
            signal.throwIfAborted();
            yield Buffer.from([i + 1]);
          }
          await check();
        })(),
        settled: physical.promise,
        cancel: () => closing.resolve(),
      };
    };
    let ended = false;
    const result = f.driver
      .downloadAttachment(
        {
          scene: 'group',
          targetId: 'g',
          url: 'https://multimedia.nt.qq.com.cn/download?fixture',
          name: 'data.bin',
          maximumBytes: 2,
          expectedSizeBytes: null,
          expectedSha256: null,
        },
        async () => {
          writes++;
          allowed = false;
        },
        new AbortController().signal,
        'media-epoch',
        async () => {
          if (!allowed) throw new KernelFault('permission-denied');
        },
      )
      .then((value) => {
        ended = true;
        return value;
      });
    await closing.promise;
    assert.equal(writes, 1);
    assert.equal(f.driver.status.phase, 'ready');
    assert.equal(ended, false);
    physical.resolve();
    const denied = await result;
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.error.code, 'permission-denied');
      assert.equal(denied.cleanup, 'settled');
    }
    allowed = true;
    const fresh = (): ReturnType<OfficialQqDriver['downloadAttachment']> =>
      f.driver.downloadAttachment(
        {
          scene: 'group',
          targetId: 'g',
          url: 'https://multimedia.nt.qq.com.cn/download?fixture',
          name: 'data.bin',
          maximumBytes: 2,
          expectedSizeBytes: 2,
          expectedSha256: null,
        },
        async () => {},
        new AbortController().signal,
        'media-epoch',
        async () => {
          if (!allowed) throw new KernelFault('permission-denied');
        },
      );
    const both = await Promise.all([fresh(), fresh()]);
    assert.ok(both.every((value) => value.ok));
    await f.driver.close();
    await f.root;
  },
);
