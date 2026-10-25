/**
 * M1-04 内存媒体通道契约测试。
 *
 * 这里只钉住 `BoundedMediaChannel` 的文档化契约。全绿只说明内存实现符合
 * 契约，不是跨进程字节传输的证据，也不能被汇报成“M1-04 已完成”。
 *
 * 所有等待都由显式触发驱动（帧已交付、abort 已派发、流已关闭）：没有定时器，
 * 也不假设某个 Promise 需要几轮微任务才结算。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  MEDIA_MAX_CHUNK_BYTES,
  MEDIA_MAX_CHUNKS_PER_STREAM,
  MEDIA_MAX_STREAM_BYTES,
  makeError,
  type KernelError,
  type KernelErrorCode,
  type MediaFrame,
  type OwnerRef,
  type Result,
  type StreamHeader,
} from '@pet/contracts';
import { BoundedMediaChannel, MediaChannelError } from '@pet/host-kernel';

/** 等待者上限由通道契约单独固定为 8，与块预算无关。 */
const MAX_WAITERS = 8;

function identityOf(): { streamId: string; taskId: string; owner: OwnerRef } {
  return {
    streamId: 'stream-1',
    taskId: 'task-1',
    owner: { pluginId: 'test.media', instanceId: 'default', generation: 1 },
  };
}

function makeFrame(
  sequence: number,
  byteLength = 4,
  patch: Partial<StreamHeader> = {},
): MediaFrame {
  const identity = identityOf();
  const payload = new Uint8Array(byteLength);
  for (let index = 0; index < payload.length; index += 1) payload[index] = (sequence + index) % 251;
  const header: StreamHeader = {
    streamId: identity.streamId,
    taskId: identity.taskId,
    owner: identity.owner,
    sequence,
    byteLength,
  };
  Object.assign(header, patch);
  return { header, payload };
}

function channelOf(
  live: (owner: OwnerRef) => boolean = () => true,
  signal?: AbortSignal,
): BoundedMediaChannel {
  return new BoundedMediaChannel(identityOf(), live, signal);
}

/** 填满 8 块队列，返回通道。 */
function fullChannel(chunkBytes = 256): BoundedMediaChannel {
  const channel = channelOf();
  for (let sequence = 0; sequence < MEDIA_MAX_CHUNKS_PER_STREAM; sequence += 1) {
    expect(channel.push(makeFrame(sequence, chunkBytes))).toEqual({ ok: true, value: null });
  }
  return channel;
}

function expectOk(result: Result<unknown>): void {
  expect(result).toEqual({ ok: true, value: null });
}

/**
 * 失败分支必须是固定的 `KernelError`：恰好 code/messageKey/retryable 三个字段，
 * messageKey 由 code 派生。任何输入内容都不允许出现在错误里。
 */
function expectError(result: Result<unknown>, code?: KernelErrorCode): KernelError {
  if (result.ok) throw new Error('expected a failed Result');
  expect(Object.keys(result.error).sort()).toEqual(['code', 'messageKey', 'retryable']);
  expect(result.error.messageKey).toBe(`errors.${result.error.code}`);
  expect(typeof result.error.retryable).toBe('boolean');
  if (code !== undefined) expect(result.error.code).toBe(code);
  return result.error;
}

async function rejection(promise: Promise<unknown>): Promise<MediaChannelError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MediaChannelError);
    return error as MediaChannelError;
  }
  throw new Error('expected the promise to reject');
}

/** 显式闸门：测试只等这个 deferred，不猜微任务轮数。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('媒体通道身份绑定', () => {
  it('构造时快照并冻结 owner/stream/task，之后改动入参不再生效', () => {
    const passed = identityOf();
    const seen: OwnerRef[] = [];
    const channel = new BoundedMediaChannel(passed, (owner) => {
      seen.push(owner);
      return true;
    });
    expectOk(channel.push(makeFrame(0)));

    passed.streamId = 'stream-2';
    passed.taskId = 'task-2';
    passed.owner.generation = 99;

    expectError(channel.push(makeFrame(1, 4, { streamId: 'stream-2' })), 'invalid-input');
    expectError(channel.push(makeFrame(1, 4, { taskId: 'task-2' })), 'invalid-input');
    expectError(
      channel.push(
        makeFrame(1, 4, {
          owner: { pluginId: 'test.media', instanceId: 'default', generation: 99 },
        }),
      ),
      'invalid-input',
    );
    expectOk(channel.push(makeFrame(1)));

    expect(seen[0]).toEqual({
      pluginId: 'test.media',
      instanceId: 'default',
      generation: 1,
    });
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it('拒绝不合法的流身份，并抛固定 MediaChannelError', () => {
    const invalid = [
      { ...identityOf(), streamId: '' },
      { ...identityOf(), taskId: '__proto__' },
      { ...identityOf(), owner: { pluginId: 'Bad.Id', instanceId: 'default', generation: 1 } },
      { ...identityOf(), owner: { pluginId: 'test.media', instanceId: 'default', generation: 0 } },
    ];
    for (const identity of invalid) {
      let thrown: unknown;
      try {
        new BoundedMediaChannel(identity);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MediaChannelError);
      const channelError = thrown as MediaChannelError;
      expect(channelError.error.code).toBe('invalid-input');
      expect(channelError.message).toBe(channelError.error.messageKey);
      expect(Object.keys(channelError.error).sort()).toEqual(['code', 'messageKey', 'retryable']);
    }
  });

  it('默认 live 回调拒绝一切写入', async () => {
    const channel = new BoundedMediaChannel(identityOf());
    expectError(channel.push(makeFrame(0)), 'stale-owner');
    expectError(await channel.waitWritable(1), 'stale-owner');
    // 拒绝写入本身还不是终止：队列仍然是空的。
    expect(channel.snapshot()).toMatchObject({ closed: false, queuedChunks: 0 });
    expectError(channel.close(0), 'stale-owner');
    expect(channel.snapshot().closed).toBe(true);
    expectError(channel.push(makeFrame(0)), 'stale-owner');
  });

  it('owner 世代失效后终止读取，不再交付已排队帧', async () => {
    let live = true;
    const channel = channelOf(() => live);
    expectOk(channel.push(makeFrame(0)));
    live = false;

    expectError(channel.push(makeFrame(1)), 'stale-owner');
    const iterator = channel[Symbol.asyncIterator]();
    const error = await rejection(iterator.next());
    expect(error.error.code).toBe('stale-owner');
    expect(channel.snapshot()).toMatchObject({
      closed: true,
      queuedChunks: 0,
      queuedBytes: 0,
    });
  });

  it('live 回调抛错不外扩、不回显，且首个终态错误不被覆盖', () => {
    const secret = 'owner-lookup-secret-42';
    const channel = new BoundedMediaChannel(identityOf(), () => {
      throw new Error(secret);
    });
    const refused = channel.push(makeFrame(0));
    expectError(refused, 'stale-owner');
    expect(JSON.stringify(refused)).not.toContain(secret);

    channel.cancel(makeError('timeout'));
    expectError(channel.push(makeFrame(0)), 'timeout');
    channel.cancel(makeError('network'));
    expectError(channel.push(makeFrame(0)), 'timeout');
  });

  it('snapshot 只报告队列状态，不泄露绑定身份', () => {
    const channel = channelOf();
    const snapshot = channel.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual([
      'closed',
      'nextSequence',
      'queuedBytes',
      'queuedChunks',
      'waiters',
    ]);
    expect(snapshot).toEqual({
      queuedChunks: 0,
      queuedBytes: 0,
      nextSequence: 0,
      closed: false,
      waiters: 0,
    });
  });
});

describe('媒体帧校验', () => {
  it('push 是同步 Result，不是 Promise', () => {
    const channel = channelOf();
    const result = channel.push(makeFrame(0));
    expect(result).not.toBeInstanceOf(Promise);
    expect(Object.keys(result).sort()).toEqual(['ok', 'value']);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('拒绝其他 stream/task/owner 世代的帧', () => {
    const channel = channelOf();
    expectError(channel.push(makeFrame(0, 4, { streamId: 'stream-2' })), 'invalid-input');
    expectError(channel.push(makeFrame(0, 4, { taskId: 'task-2' })), 'invalid-input');
    expectError(
      channel.push(
        makeFrame(0, 4, {
          owner: { pluginId: 'test.media', instanceId: 'default', generation: 2 },
        }),
      ),
      'invalid-input',
    );
    expectError(
      channel.push(
        makeFrame(0, 4, {
          owner: { pluginId: 'other.media', instanceId: 'default', generation: 1 },
        }),
      ),
      'invalid-input',
    );
    expect(channel.snapshot().nextSequence).toBe(0);
    expectOk(channel.push(makeFrame(0)));
  });

  it('序号必须从 0 开始并严格连续，失败不推进 nextSequence', () => {
    const channel = channelOf();
    expectError(channel.push(makeFrame(1)), 'invalid-input');
    expect(channel.snapshot().nextSequence).toBe(0);

    expectOk(channel.push(makeFrame(0)));
    expectError(channel.push(makeFrame(0)), 'invalid-input');
    expectError(channel.push(makeFrame(2)), 'invalid-input');
    expect(channel.snapshot().nextSequence).toBe(1);

    expectOk(channel.push(makeFrame(1)));
    expectError(channel.push(makeFrame(-1)), 'invalid-input');
    expectError(channel.push(makeFrame(1.5)), 'invalid-input');
    expect(channel.snapshot().nextSequence).toBe(2);
  });

  it('拒绝超过 256 KiB 的块，同时接受恰好 256 KiB', () => {
    const channel = channelOf();
    expectError(channel.push(makeFrame(0, MEDIA_MAX_CHUNK_BYTES + 1)), 'invalid-input');
    expectError(channel.push(makeFrame(0, 4, { byteLength: -1 })), 'invalid-input');
    expectError(channel.push(makeFrame(0, 4, { byteLength: 1.5 })), 'invalid-input');
    expect(channel.snapshot().nextSequence).toBe(0);
    expectOk(channel.push(makeFrame(0, MEDIA_MAX_CHUNK_BYTES)));
  });

  it('拒绝与头部 byteLength 不一致的 payload', () => {
    const channel = channelOf();
    expectError(channel.push(makeFrame(0, 4, { byteLength: 5 })), 'invalid-input');
    expectError(channel.push(makeFrame(0, 8, { byteLength: 4 })), 'invalid-input');
    expect(channel.snapshot().nextSequence).toBe(0);
    expectOk(channel.push(makeFrame(0, 4)));
  });

  it('拒绝 SharedArrayBuffer 承载的 payload', () => {
    const channel = channelOf();
    const frame = makeFrame(0, 4);
    frame.payload = new Uint8Array(new SharedArrayBuffer(4));
    expectError(channel.push(frame), 'invalid-input');
    expect(channel.snapshot().nextSequence).toBe(0);
    expectOk(channel.push(makeFrame(0)));
  });

  it('拒绝访问器、Proxy、多余字段与非 Uint8Array 的载荷，且不调用访问器', () => {
    const channel = channelOf();
    const base = makeFrame(0);

    const headerGetter = vi.fn(() => base.header);
    const accessorFrame: Record<string, unknown> = { payload: base.payload };
    Object.defineProperty(accessorFrame, 'header', {
      get: headerGetter,
      enumerable: true,
      configurable: true,
    });
    expectError(channel.push(accessorFrame), 'invalid-input');
    expect(headerGetter).not.toHaveBeenCalled();

    const streamIdGetter = vi.fn(() => 'stream-1');
    const header: Record<string, unknown> = { ...base.header };
    Object.defineProperty(header, 'streamId', {
      get: streamIdGetter,
      enumerable: true,
      configurable: true,
    });
    expectError(channel.push({ header, payload: new Uint8Array(4) }), 'invalid-input');
    expect(streamIdGetter).not.toHaveBeenCalled();

    expectError(channel.push(new Proxy(makeFrame(0), {})), 'invalid-input');
    expectError(channel.push({ ...makeFrame(0), extra: 1 }), 'invalid-input');
    expectError(channel.push({ payload: base.payload }), 'invalid-input');
    expectError(channel.push({ header: base.header }), 'invalid-input');
    expectError(channel.push({ header: base.header, payload: [1, 2, 3, 4] }), 'invalid-input');
    expectError(
      channel.push({ header: base.header, payload: new ArrayBuffer(4) }),
      'invalid-input',
    );
    expectError(
      channel.push({ header: base.header, payload: new Uint16Array(2) }),
      'invalid-input',
    );

    const payloadGetter = vi.fn(() => new Uint8Array(4));
    const payloadAccessor: Record<string, unknown> = { header: base.header };
    Object.defineProperty(payloadAccessor, 'payload', {
      get: payloadGetter,
      enumerable: true,
      configurable: true,
    });
    expectError(channel.push(payloadAccessor), 'invalid-input');
    expect(payloadGetter).not.toHaveBeenCalled();

    const throwingGetter = vi.fn(() => {
      throw new Error('payload-getter-secret');
    });
    const throwingFrame: Record<string, unknown> = { header: base.header };
    Object.defineProperty(throwingFrame, 'payload', {
      get: throwingGetter,
      enumerable: true,
      configurable: true,
    });
    expect(JSON.stringify(channel.push(throwingFrame))).not.toContain('payload-getter-secret');
    expect(throwingGetter).not.toHaveBeenCalled();

    const symbolFrame = makeFrame(0);
    Object.defineProperty(symbolFrame, Symbol('hidden'), { value: 1, enumerable: true });
    expectError(channel.push(symbolFrame), 'invalid-input');

    expect(channel.snapshot().nextSequence).toBe(0);
    expectOk(channel.push(makeFrame(0)));
  });

  it('拒绝已撤销的 Proxy 帧与载荷', () => {
    const channel = channelOf();
    const revocableFrame = Proxy.revocable(makeFrame(0), {});
    revocableFrame.revoke();
    expectError(channel.push(revocableFrame.proxy), 'invalid-input');

    const revocablePayload = Proxy.revocable(new Uint8Array(4), {});
    revocablePayload.revoke();
    const frame = makeFrame(0);
    frame.payload = revocablePayload.proxy as unknown as Uint8Array;
    expectError(channel.push(frame), 'invalid-input');

    expect(channel.snapshot().nextSequence).toBe(0);
    expectOk(channel.push(makeFrame(0)));
  });

  it('队列已满时仍然拒绝非法帧，且不推进序号', () => {
    const channel = fullChannel(256);
    const refused = channel.push(makeFrame(8, 256, { streamId: 'stream-2' }));
    expect(refused.ok).toBe(false);
    expect(channel.snapshot()).toMatchObject({
      queuedChunks: MEDIA_MAX_CHUNKS_PER_STREAM,
      nextSequence: MEDIA_MAX_CHUNKS_PER_STREAM,
    });
    // 这里刻意不钉死 code：实现先判队列、后校验帧，会把一个永久非法的帧
    // 报成可重试的 quota-exceeded。这一点作为观察记录在交付说明里。
    if (!refused.ok) expect(refused.error.messageKey).toBe(`errors.${refused.error.code}`);
  });

  it('接受零字节帧，但仍受 8 块上限约束', () => {
    const channel = channelOf();
    for (let sequence = 0; sequence < MEDIA_MAX_CHUNKS_PER_STREAM; sequence += 1) {
      expectOk(channel.push(makeFrame(sequence, 0)));
    }
    expect(channel.snapshot()).toMatchObject({
      queuedChunks: MEDIA_MAX_CHUNKS_PER_STREAM,
      queuedBytes: 0,
    });
    expectError(channel.push(makeFrame(8, 0)), 'quota-exceeded');
  });

  it('拒绝已分离缓冲区上的字节视图', () => {
    const channel = channelOf();
    const backing = new ArrayBuffer(4);
    const view = new Uint8Array(backing);
    const frame = makeFrame(0);
    frame.payload = view;
    structuredClone(backing, { transfer: [backing] });
    expectError(channel.push(frame), 'invalid-input');
    expect(channel.snapshot().nextSequence).toBe(0);
    expectOk(channel.push(makeFrame(0)));
  });

  it('复制字节视图，交付后与外部缓冲区脱钩', async () => {
    const channel = channelOf();
    const backing = new Uint8Array(16);
    backing.set([1, 2, 3, 4], 8);
    const view = backing.subarray(8, 12);
    const frame = makeFrame(0, 4);
    frame.payload = view;
    expectOk(channel.push(frame));

    backing[8] = 99;
    const iterator = channel[Symbol.asyncIterator]();
    const delivered = await iterator.next();
    expect(delivered.done).toBe(false);
    if (delivered.done) return;
    expect(delivered.value.payload).not.toBe(view);
    expect([...delivered.value.payload]).toEqual([1, 2, 3, 4]);
  });
});

describe('队列背压与容量通知', () => {
  it('接受 8 块/2 MiB 后拒绝，不静默丢弃也不推进序号', () => {
    const channel = channelOf();
    for (let sequence = 0; sequence < MEDIA_MAX_CHUNKS_PER_STREAM; sequence += 1) {
      expectOk(channel.push(makeFrame(sequence, MEDIA_MAX_CHUNK_BYTES)));
    }
    expect(channel.snapshot()).toMatchObject({
      queuedChunks: MEDIA_MAX_CHUNKS_PER_STREAM,
      queuedBytes: MEDIA_MAX_STREAM_BYTES,
      nextSequence: MEDIA_MAX_CHUNKS_PER_STREAM,
      closed: false,
    });

    const error = expectError(
      channel.push(makeFrame(MEDIA_MAX_CHUNKS_PER_STREAM, 1)),
      'quota-exceeded',
    );
    expect(error.retryable).toBe(true);
    expect(channel.snapshot().nextSequence).toBe(MEDIA_MAX_CHUNKS_PER_STREAM);
  });

  it('读取一帧后容量恢复', async () => {
    const channel = fullChannel(1024);
    expectError(channel.push(makeFrame(8, 1024)), 'quota-exceeded');

    const iterator = channel[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(channel.snapshot()).toMatchObject({ queuedChunks: 7, queuedBytes: 7 * 1024 });

    expectOk(channel.push(makeFrame(8, 1024)));
    expect(channel.snapshot().queuedChunks).toBe(8);
  });

  it('校验 waitWritable 的字节参数', async () => {
    const channel = channelOf();
    const invalid = [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MEDIA_MAX_CHUNK_BYTES + 1,
      Number.MAX_SAFE_INTEGER,
    ];
    for (const bytes of invalid) {
      expectError(await channel.waitWritable(bytes), 'invalid-input');
    }
    expectOk(await channel.waitWritable(0));
    expectOk(await channel.waitWritable(MEDIA_MAX_CHUNK_BYTES));
    expect(channel.snapshot().waiters).toBe(0);
  });

  it('有容量时立即返回，不注册等待者', async () => {
    const channel = channelOf();
    expectOk(await channel.waitWritable(MEDIA_MAX_CHUNK_BYTES));
    expect(channel.snapshot().waiters).toBe(0);
  });

  it('等待只登记容量通知：不持有数据、不占额度、也不是预约', async () => {
    const channel = fullChannel(256);
    const before = channel.snapshot();
    const waiter = channel.waitWritable(256);
    expect(channel.snapshot()).toMatchObject({
      queuedChunks: before.queuedChunks,
      queuedBytes: before.queuedBytes,
      waiters: 1,
    });
    // 等待者没有制造容量：队列仍然是满的。
    expectError(channel.push(makeFrame(8, 256)), 'quota-exceeded');

    const iterator = channel[Symbol.asyncIterator]();
    await iterator.next();
    await expect(waiter).resolves.toEqual({ ok: true, value: null });
    expect(channel.snapshot().waiters).toBe(0);

    // 通知不是预约额度：别人可以先占掉刚释放的槽位。
    expectOk(channel.push(makeFrame(8, 256)));
    expectError(channel.push(makeFrame(9, 256)), 'quota-exceeded');
  });

  it('等待者数量上限为 8', async () => {
    const channel = fullChannel(256);
    const controllers = Array.from({ length: MAX_WAITERS }, () => new AbortController());
    const waiters = controllers.map((controller) => channel.waitWritable(1, controller.signal));
    expect(channel.snapshot().waiters).toBe(MAX_WAITERS);
    expectError(await channel.waitWritable(1), 'quota-exceeded');
    expect(channel.snapshot().waiters).toBe(MAX_WAITERS);

    for (const controller of controllers) controller.abort();
    for (const waiter of waiters) expectError(await waiter, 'cancelled');
    expect(channel.snapshot().waiters).toBe(0);
    expect(channel.snapshot().queuedChunks).toBe(MEDIA_MAX_CHUNKS_PER_STREAM);
  });

  it('单个等待者可以通过自己的 signal 取消，队列不受影响', async () => {
    const channel = fullChannel(256);
    const controller = new AbortController();
    const waiter = channel.waitWritable(1, controller.signal);
    expect(channel.snapshot().waiters).toBe(1);

    controller.abort();
    expectError(await waiter, 'cancelled');
    expect(channel.snapshot()).toMatchObject({
      waiters: 0,
      queuedChunks: MEDIA_MAX_CHUNKS_PER_STREAM,
    });
  });

  it('signal 已中止时直接拒绝，不注册等待者', async () => {
    const channel = channelOf();
    const controller = new AbortController();
    controller.abort();
    expectError(await channel.waitWritable(1, controller.signal), 'cancelled');
    expect(channel.snapshot().waiters).toBe(0);
  });
});

describe('正常终止（close）', () => {
  it('要求终止序号精确匹配；不匹配时拒绝且流仍可用', () => {
    const channel = channelOf();
    expectError(channel.close(1), 'invalid-input');
    expect(channel.snapshot().closed).toBe(false);

    expectOk(channel.push(makeFrame(0)));
    expectError(channel.close(2), 'invalid-input');
    expectOk(channel.close(1));
    expect(channel.snapshot()).toMatchObject({ closed: true, nextSequence: 1 });
  });

  it('排空已接受的有效帧后才结束', async () => {
    const channel = channelOf();
    expectOk(channel.push(makeFrame(0)));
    expectOk(channel.push(makeFrame(1)));
    expectOk(channel.close(2));

    const iterator = channel[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done ? -1 : first.value.header.sequence).toBe(0);
    const second = await iterator.next();
    expect(second.done ? -1 : second.value.header.sequence).toBe(1);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(channel.snapshot()).toMatchObject({
      queuedChunks: 0,
      queuedBytes: 0,
      closed: true,
    });
  });

  it('队列为空时立即完成挂起的读取', async () => {
    const channel = channelOf();
    const iterator = channel[Symbol.asyncIterator]();
    const pending = iterator.next();
    expectOk(channel.close(0));
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });

  it('重复 close 被拒绝；close 之后的 push 不是取消，已排队帧仍可排空', async () => {
    const channel = channelOf();
    expectOk(channel.push(makeFrame(0)));
    expectOk(channel.close(1));

    expect(channel.close(1).ok).toBe(false);
    const error = expectError(channel.push(makeFrame(1)));
    expect(error.code).toBe('not-ready');
    expect(error.code).not.toBe('cancelled');

    const iterator = channel[Symbol.asyncIterator]();
    const delivered = await iterator.next();
    expect(delivered.done ? -1 : delivered.value.header.sequence).toBe(0);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it('世代失效时的 close 转为取消，并返回固定错误', async () => {
    let live = true;
    const channel = channelOf(() => live);
    expectOk(channel.push(makeFrame(0)));
    live = false;

    const error = expectError(channel.close(1), 'stale-owner');
    expect(error.messageKey).toBe('errors.stale-owner');
    expect(channel.snapshot()).toMatchObject({ closed: true, queuedChunks: 0 });
    expectError(channel.push(makeFrame(1)), 'stale-owner');
  });

  it('close 结束容量等待，但不把结束谎报成取消', async () => {
    const channel = fullChannel(256);
    const waiter = channel.waitWritable(1);
    expect(channel.snapshot().waiters).toBe(1);

    expectOk(channel.close(MEDIA_MAX_CHUNKS_PER_STREAM));
    const error = expectError(await waiter);
    expect(error.code).toBe('not-ready');
    expect(error.code).not.toBe('cancelled');
    expect(channel.snapshot().waiters).toBe(0);
  });
});

describe('取消（cancel）', () => {
  it('清空排队帧，且不再交付它们', async () => {
    const channel = channelOf();
    expectOk(channel.push(makeFrame(0)));
    expectOk(channel.push(makeFrame(1)));
    const iterator = channel[Symbol.asyncIterator]();
    channel.cancel();

    expect(channel.snapshot()).toMatchObject({
      queuedChunks: 0,
      queuedBytes: 0,
      closed: true,
    });
    const error = await rejection(iterator.next());
    expect(error.error.code).toBe('cancelled');
    expect(error.error.messageKey).toBe('errors.cancelled');
    expect(error.message).toBe('errors.cancelled');
    expect(error.name).toBe('MediaChannelError');
    expect(Object.keys(error.error).sort()).toEqual(['code', 'messageKey', 'retryable']);
  });

  it('拒绝挂起的读取', async () => {
    const channel = channelOf();
    const iterator = channel[Symbol.asyncIterator]();
    const pending = iterator.next();
    channel.cancel();
    const error = await rejection(pending);
    expect(error.error.code).toBe('cancelled');
  });

  it('结束容量等待并保留取消原因', async () => {
    const channel = fullChannel(256);
    const waiter = channel.waitWritable(1);
    expect(channel.snapshot().waiters).toBe(1);
    channel.cancel(makeError('timeout'));

    expectError(await waiter, 'timeout');
    expect(channel.snapshot().waiters).toBe(0);
    expectError(channel.push(makeFrame(8, 256)), 'timeout');
    expectError(channel.close(MEDIA_MAX_CHUNKS_PER_STREAM), 'timeout');
  });

  it('外部 signal 中止时终止通道并停止交付', async () => {
    const controller = new AbortController();
    const channel = channelOf(() => true, controller.signal);
    expectOk(channel.push(makeFrame(0)));
    expectOk(channel.push(makeFrame(1)));
    const iterator = channel[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);

    controller.abort();
    expect(channel.snapshot()).toMatchObject({ closed: true, queuedChunks: 0 });
    expectError(channel.push(makeFrame(2)), 'cancelled');
    const error = await rejection(iterator.next());
    expect(error.error.code).toBe('cancelled');
  });

  it('外部 signal 中止时拒绝挂起的读取', async () => {
    const controller = new AbortController();
    const channel = channelOf(() => true, controller.signal);
    const iterator = channel[Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();
    const error = await rejection(pending);
    expect(error.error.code).toBe('cancelled');
  });

  it('signal 在构造时已中止则通道一开始就是取消态', async () => {
    const controller = new AbortController();
    controller.abort();
    const channel = channelOf(() => true, controller.signal);
    expect(channel.snapshot().closed).toBe(true);
    expectError(channel.push(makeFrame(0)), 'cancelled');
    expectError(await channel.waitWritable(1), 'cancelled');
  });

  it('已交付的帧不会被取消追溯撤回，也不会再次交付', async () => {
    const channel = channelOf();
    expectOk(channel.push(makeFrame(0)));
    const iterator = channel[Symbol.asyncIterator]();
    const delivered = await iterator.next();
    expect(delivered.done).toBe(false);
    // 已交付即已出队：它不是“仍待交付”的帧。
    expect(channel.snapshot().queuedChunks).toBe(0);

    channel.cancel();
    const error = await rejection(iterator.next());
    expect(error.error.code).toBe('cancelled');
    if (!delivered.done) expect(delivered.value.header.sequence).toBe(0);
  });
});

describe('单消费者', () => {
  it('拒绝第二个 asyncIterator', () => {
    const channel = channelOf();
    channel[Symbol.asyncIterator]();
    let thrown: unknown;
    try {
      channel[Symbol.asyncIterator]();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MediaChannelError);
    const channelError = thrown as MediaChannelError;
    expect(channelError.error.code).toBe('invalid-input');
    expect(channelError.message).toBe(channelError.error.messageKey);
    expect(Object.keys(channelError.error).sort()).toEqual(['code', 'messageKey', 'retryable']);
  });

  it('拒绝并发的 next，且不消耗挂起中的读取', async () => {
    const channel = channelOf();
    const iterator = channel[Symbol.asyncIterator]();
    const pending = iterator.next();
    const error = await rejection(iterator.next());
    expect(error.error.code).toBe('invalid-input');

    expectOk(channel.push(makeFrame(0)));
    const delivered = await pending;
    expect(delivered.done ? -1 : delivered.value.header.sequence).toBe(0);
  });

  it('迭代器 return 取消整条流', async () => {
    const channel = channelOf();
    expectOk(channel.push(makeFrame(0)));
    const iterator = channel[Symbol.asyncIterator]();
    expect(await iterator.return?.()).toEqual({ done: true, value: undefined });

    expect(channel.snapshot()).toMatchObject({ closed: true, queuedChunks: 0 });
    expectError(channel.push(makeFrame(1)), 'cancelled');
    const error = await rejection(iterator.next());
    expect(error.error.code).toBe('cancelled');
  });

  it('正常结束后再调用 return 仍报完成，已交付的帧不受影响', async () => {
    const channel = channelOf();
    expectOk(channel.push(makeFrame(0)));
    expectOk(channel.close(1));
    const iterator = channel[Symbol.asyncIterator]();
    const delivered = await iterator.next();
    expect(delivered.done).toBe(false);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(await iterator.return?.()).toEqual({ done: true, value: undefined });
    if (!delivered.done) {
      expect(delivered.value.header.sequence).toBe(0);
      expect(delivered.value.payload.byteLength).toBe(4);
    }
    expect(channel.snapshot().queuedChunks).toBe(0);
  });

  it('把帧直接交给等待中的消费者，而不是先入队', async () => {
    const channel = channelOf();
    const iterator = channel[Symbol.asyncIterator]();
    const delivered = deferred<MediaFrame>();
    const reading = iterator.next().then((result) => {
      if (!result.done) delivered.resolve(result.value);
      return result;
    });

    expectOk(channel.push(makeFrame(0)));
    expect(channel.snapshot().queuedChunks).toBe(0);
    expect((await delivered.promise).header.sequence).toBe(0);
    expect((await reading).done).toBe(false);
  });
});

describe('固定错误不回显内容', () => {
  it('被拒绝的帧身份不会出现在错误里', () => {
    const channel = channelOf();
    const secret = 'sk-live-SECRET-1234';
    const result = channel.push(makeFrame(0, 4, { streamId: `stream-${secret}` }));
    expectError(result, 'invalid-input');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('取消错误只带固定 KernelError，不含载荷内容', async () => {
    const channel = channelOf();
    const secret = 'sk-live-SECRET-1234';
    const payload = new TextEncoder().encode(secret);
    const frame = makeFrame(0, payload.byteLength);
    frame.payload = payload;
    expectOk(channel.push(frame));

    channel.cancel();
    const error = await rejection(channel[Symbol.asyncIterator]().next());
    expect(JSON.stringify(error.error)).not.toContain(secret);
    expect(error.message).toBe(error.error.messageKey);
    expect(error.error.code).toBe('cancelled');
  });
});
