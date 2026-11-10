import type { AudioCaptureEvents, AudioCaptureTicket } from '@pet/contracts';
import { afterEach, expect, test, vi } from 'vitest';

import { startCapture } from './browser.js';

/**
 * C9 生命周期的行为回归。
 *
 * 每个用例都必须**证明**它声称的时序：不能靠「反正没调用」通过，也不能在
 * 需要观察 pending 的地方先 await 掉。所有设备/close/push 的结算时机都由
 * 这里的 deferred 门控，因为这些时机正是契约本身。
 */
const ticket: AudioCaptureTicket = {
  encoding: 'f32le',
  sampleRate: 16000,
  channels: 1,
  chunkSamples: 1600,
  maxSamples: 320000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 一个可以由测试决定何时结算的 promise。 */
function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 让出几个真实事件循环回合，让内部 await 链推进。 */
async function yieldTurns(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function fakeStream(stopped: string[]): MediaStream {
  const track = { kind: 'audio', stop: () => stopped.push('audio') } as unknown as MediaStreamTrack;
  return { getTracks: () => [track] } as unknown as MediaStream;
}

/** 受控音频图：close 由外部门控，能观察「是否真的等到结算」。 */
function stubAudio(options: { closeGate?: Promise<void>; closeFails?: boolean } = {}) {
  const closed: string[] = [];
  let node: FakeNode | null = null;

  class FakeContext {
    readonly sampleRate = 16000;
    state = 'running';
    readonly destination = {};
    readonly audioWorklet = { addModule: async (): Promise<void> => {} };
    async resume(): Promise<void> {}
    createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
      return { connect: () => {}, disconnect: () => {} };
    }
    async close(): Promise<void> {
      if (options.closeGate) await options.closeGate;
      if (options.closeFails) throw new Error('close failed');
      this.state = 'closed';
      closed.push('context');
    }
  }

  class FakeNode {
    readonly port = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      postMessage: () => {},
      close: () => {},
    };
    connect(): void {}
    disconnect(): void {}
    /** 测试从这里喂一帧，模拟音频线程上行。 */
    emit(frame: Float32Array): void {
      this.port.onmessage?.({ data: frame } as MessageEvent<unknown>);
    }
  }

  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', function (this: unknown) {
    node = new FakeNode();
    return node;
  } as unknown as typeof AudioWorkletNode);

  return {
    closed,
    /** 最近创建的 worklet 节点；setup 完成后才有。 */
    node: () => node,
  };
}

const noopEvents = (over: Partial<AudioCaptureEvents> = {}): AudioCaptureEvents => ({
  ready: async () => {},
  push: async () => {},
  failed: () => {},
  limitReached: () => {},
  ...over,
});

/** 挂一个「已 settle」观察器，返回查询函数；不改变 promise 本身。 */
function track<T>(promise: Promise<T>) {
  let state: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  void promise.then(
    () => {
      state = 'fulfilled';
    },
    () => {
      state = 'rejected';
    },
  );
  return () => state;
}

test('同步返回控制对象：不 await 也立刻可用', async () => {
  const grant = deferred<MediaStream>();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => grant.promise } });
  stubAudio();

  const operation = startCapture(ticket, noopEvents(), { workletUrl: 'w.js' });
  expect(typeof operation.finish).toBe('function');
  expect(typeof operation.cancel).toBe('function');
  expect(operation.released).toBeInstanceOf(Promise);

  // 收尾：拒绝掉这个 pending 的授权，避免用例之间泄漏。
  grant.reject(new DOMException('cancelled', 'AbortError'));
  await operation.cancel().catch(() => {});
  await operation.released.catch(() => {});
});

test('gUM pending 时 cancel：released 与 cancel 都 pending，晚到 stream 停掉后才 settle', async () => {
  const stopped: string[] = [];
  const grant = deferred<MediaStream>();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => grant.promise } });
  stubAudio();

  const ready = vi.fn(async (_rate: number): Promise<void> => {});
  const failed = vi.fn();
  const operation = startCapture(ticket, noopEvents({ ready, failed }), { workletUrl: 'w.js' });

  const releasedState = track(operation.released);
  // 关键：不 await，保存起来观察。
  const cancelling = operation.cancel();
  const cancelState = track(cancelling);

  await yieldTurns();
  // 设备还没回来：两个都必须仍然 pending。
  expect(releasedState()).toBe('pending');
  expect(cancelState()).toBe('pending');
  expect(stopped).toEqual([]);

  // 晚到的授权：stream 必须立刻停，然后两个 promise 才成立。
  grant.resolve(fakeStream(stopped));
  await cancelling;
  await operation.released;

  expect(releasedState()).toBe('fulfilled');
  expect(cancelState()).toBe('fulfilled');
  expect(stopped).toEqual(['audio']);
  expect(ready).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});

test('signal 已 abort：0 次 getUserMedia，released 立即成立，finish 拒绝', async () => {
  const getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  stubAudio();

  const controller = new AbortController();
  controller.abort();

  const operation = startCapture(ticket, noopEvents({ signal: controller.signal }), {
    workletUrl: 'w.js',
  });
  await operation.released;

  expect(getUserMedia).not.toHaveBeenCalled();
  await expect(operation.finish()).rejects.toThrow(/cancelled/);
});

test('deferred close：并行 cancel/abort/finish 共享一次 cleanup，close 只发生一次', async () => {
  const stopped: string[] = [];
  const gate = deferred();
  const audio = stubAudio({ closeGate: gate.promise });
  const controller = new AbortController();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  let signalReady: () => void = () => {};
  const readyReached = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const operation = startCapture(
    ticket,
    noopEvents({
      ready: async () => {
        signalReady();
      },
      signal: controller.signal,
    }),
    { workletUrl: 'w.js' },
  );

  await readyReached;
  await yieldTurns();

  const releasedState = track(operation.released);
  const first = operation.cancel();
  const second = operation.cancel();
  controller.abort();
  const finishing = operation.finish().catch(() => 'aborted');

  await yieldTurns();
  // close 被门控住：此刻绝不能说已经释放。
  expect(releasedState()).toBe('pending');
  expect(audio.closed).toEqual([]);

  gate.resolve();
  await Promise.all([first, second, finishing, operation.released]);

  // 只 close 一次，且确实 close 过。
  expect(audio.closed).toEqual(['context']);
  expect(stopped).toEqual(['audio']);
});

test('close 抛错且 state 未 closed：released 与 cancel 都 reject，不假成功', async () => {
  const stopped: string[] = [];
  const audio = stubAudio({ closeFails: true });
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  let signalReady: () => void = () => {};
  const readyReached = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const operation = startCapture(
    ticket,
    noopEvents({
      ready: async () => {
        signalReady();
      },
    }),
    { workletUrl: 'w.js' },
  );

  await readyReached;
  await yieldTurns();

  await expect(operation.cancel()).rejects.toThrow(/close failed/);
  await expect(operation.released).rejects.toThrow(/close failed/);
  expect(audio.closed).toEqual([]); // 从未真的关闭
});

test('in-flight push：cancel 后 released 仍 pending，ACK 放行后才 settle；排队帧不再上行', async () => {
  const stopped: string[] = [];
  const audio = stubAudio();
  const pushed: number[] = [];
  const ackGate = deferred();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  let signalReady: () => void = () => {};
  const readyReached = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const operation = startCapture(
    ticket,
    noopEvents({
      ready: async () => {
        signalReady();
      },
      push: async (frame: Float32Array) => {
        pushed.push(frame.length);
        // 第一帧卡在 ACK 上，后面的帧因此排在队列里。
        if (pushed.length === 1) await ackGate.promise;
      },
    }),
    { workletUrl: 'w.js' },
  );

  await readyReached;
  await yieldTurns();

  const node = audio.node();
  expect(node).not.toBeNull();
  // 真的喂帧：否则 push 从未发生，用例会假通过。
  node?.emit(new Float32Array(800));
  node?.emit(new Float32Array(800));
  await yieldTurns();

  // 第一帧已经进入 push 并卡住；第二帧排在 ack 链后面。
  expect(pushed).toEqual([800]);

  const releasedState = track(operation.released);
  const cancelling = operation.cancel();
  await yieldTurns();

  // 在途 ACK 未回来：不能宣布已释放。
  expect(releasedState()).toBe('pending');

  ackGate.resolve();
  await cancelling;
  await operation.released;

  // 取消之后排队的那一帧不再交给调用方。
  expect(pushed).toEqual([800]);
  expect(stopped).toEqual(['audio']);
});

test('取消之后到达的帧不再上行（入口守卫，取消时端口仍可投递）', async () => {
  const stopped: string[] = [];
  const audio = stubAudio();
  const pushed: number[] = [];
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  let signalReady: () => void = () => {};
  const readyReached = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const operation = startCapture(
    ticket,
    noopEvents({
      ready: async () => {
        signalReady();
      },
      push: async (frame: Float32Array) => {
        pushed.push(frame.length);
      },
    }),
    { workletUrl: 'w.js' },
  );

  await readyReached;
  await yieldTurns();
  const node = audio.node();
  // 抓住这一刻的 onmessage：cleanup 之后端口会被摘掉，所以要先留一份引用，
  // 才能在「已取消」的状态下真的把帧送进 send() 的入口。
  const deliver = node?.port.onmessage;
  expect(typeof deliver).toBe('function');

  await operation.cancel();
  // 取消之后音频线程仍可能交来一帧：必须挡住它。
  deliver?.({ data: new Float32Array(1600) } as MessageEvent<unknown>);
  await yieldTurns();

  expect(pushed).toEqual([]);
  // 同时不能因为「被拦住」就把这一帧记进 counts：它属于已放弃的采集。
  await expect(operation.finish()).rejects.toThrow(/cancelled/);
});

test('正常 finish：尾帧与 END 之后才返回完整 counts，合法 tail 不被 closing 丢掉', async () => {
  const stopped: string[] = [];
  const audio = stubAudio();
  const pushed: number[] = [];
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  let signalReady: () => void = () => {};
  const readyReached = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const operation = startCapture(
    ticket,
    noopEvents({
      ready: async () => {
        signalReady();
      },
      push: async (frame: Float32Array) => {
        pushed.push(frame.length);
      },
    }),
    { workletUrl: 'w.js' },
  );

  await readyReached;
  await yieldTurns();

  const node = audio.node();
  node?.emit(new Float32Array(1600));
  await yieldTurns();

  const finishing = operation.finish();
  // 尾帧必须发生在 finish 请求之后，才能覆盖真正的 worklet flush 时序。
  node?.emit(new Float32Array(400));
  await yieldTurns();
  const onMessage = node?.port.onmessage;
  onMessage?.({ data: 'end' } as MessageEvent<unknown>);

  const summary = await finishing;
  // 两帧都真的上行过：closing 没有把合法 tail 丢掉。
  expect(pushed).toEqual([1600, 400]);
  expect(summary.frames).toBe(2);
  expect(summary.samples).toBe(2000);
  expect(stopped).toEqual(['audio']);
  expect(audio.closed).toEqual(['context']);
});

test.each(['cancel', 'tail-failure'] as const)(
  'finish 等尾帧时 %s：不返回部分 counts',
  async (mode) => {
    const stopped: string[] = [];
    const audio = stubAudio();
    const pushed: number[] = [];
    const ready = deferred<void>();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => fakeStream(stopped) } });
    const operation = startCapture(
      ticket,
      noopEvents({
        ready: async () => {
          ready.resolve();
        },
        push: async (frame) => {
          if (frame.length === 400) throw new Error('tail rejected');
          pushed.push(frame.length);
        },
      }),
      { workletUrl: 'w.js' },
    );
    await ready.promise;
    await yieldTurns();
    const node = audio.node();
    node?.emit(new Float32Array(1600));
    await yieldTurns();
    const rejected = expect(operation.finish()).rejects.toThrow(
      mode === 'cancel' ? /cancelled/ : /failed/,
    );
    if (mode === 'cancel') await operation.cancel();
    node?.emit(new Float32Array(400));
    node?.port.onmessage?.({ data: 'end' } as MessageEvent<unknown>);
    await rejected;
    await operation.released;
    expect(pushed).toEqual([1600]);
    expect(stopped).toEqual(['audio']);
    expect(audio.closed).toEqual(['context']);
  },
);

test('finish 在未 ready 时 reject not-ready，不返回部分 counts', async () => {
  const stopped: string[] = [];
  const audio = stubAudio();
  const grant = deferred<MediaStream>();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => grant.promise } });

  const operation = startCapture(ticket, noopEvents(), { workletUrl: 'w.js' });
  await expect(operation.finish()).rejects.toThrow(/not-ready/);

  grant.resolve(fakeStream(stopped));
  await operation.released.catch(() => {});
  expect(stopped).toEqual(['audio']);
  expect(audio.closed).toEqual([]); // 从未建过音频图
});

test('finish 在已取消时 reject cancelled', async () => {
  const stopped: string[] = [];
  const audio = stubAudio();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  let signalReady: () => void = () => {};
  const readyReached = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const operation = startCapture(
    ticket,
    noopEvents({
      ready: async () => {
        signalReady();
      },
    }),
    { workletUrl: 'w.js' },
  );

  await readyReached;
  await yieldTurns();
  await operation.cancel();
  await expect(operation.finish()).rejects.toThrow(/cancelled/);
  expect(audio.closed).toEqual(['context']);
});

test('abort 监听器被摘掉：取消后再 abort 不会二次关设备', async () => {
  const stopped: string[] = [];
  stubAudio();
  const controller = new AbortController();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  const operation = startCapture(ticket, noopEvents({ signal: controller.signal }), {
    workletUrl: 'w.js',
  });
  await operation.cancel().catch(() => {});
  await operation.released.catch(() => {});

  const before = stopped.length;
  controller.abort();
  await yieldTurns();
  expect(stopped.length).toBe(before);
});
