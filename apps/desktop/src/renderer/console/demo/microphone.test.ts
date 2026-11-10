import type { DemoCaptureTicket } from '@pet/contracts';
import { afterEach, expect, test, vi } from 'vitest';

import type { DemoCaptureEvents } from './capture.js';
import { createMicrophoneCapture } from './microphone.js';

vi.mock('@pet/audio-capture/capture-worklet?worker&url', () => ({ default: '/worklet.js' }));

/**
 * 旧入口的真实回归：
 * 1. 授权还挂着就点「取消」时，getUserMedia 晚回来的 stream 必须立刻停，而且这一次
 *    既不 ended 也不 failed —— 控制台的 cancel() 已经给了宿主结论。
 * 2. stop() 必须等到设备真的放开才发 ended，且只发一次：中间只是「请求过结束」不算。
 */
const ticket: DemoCaptureTicket = {
  token: 'late-grant',
  sampleRate: 16000,
  maxSamples: 320000,
  chunkSamples: 1600,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 只给 getTracks：采集侧要的就这么多，多余的设备形状是猜测。 */
function fakeStream(stopped: string[]): MediaStream {
  const track = { kind: 'audio', stop: () => stopped.push('audio') } as unknown as MediaStreamTrack;
  return { getTracks: () => [track] } as unknown as MediaStream;
}

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface FakeNode {
  readonly port: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage: () => void;
    close: () => void;
  };
  connect(): void;
  disconnect(): void;
}

/** 受控音频图：close 由外部门控，才能观察 stop 是否真的等到释放。 */
function stubAudio(gate: Promise<void>, log: string[]) {
  let node: FakeNode | null = null;
  const connected = deferred();
  const closing = deferred();

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
      log.push('closing');
      closing.resolve();
      await gate;
      this.state = 'closed';
      log.push('closed');
    }
  }

  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', function (this: unknown) {
    node = {
      port: { onmessage: null, postMessage: () => {}, close: () => {} },
      connect: () => connected.resolve(),
      disconnect: () => {},
    };
    return node;
  } as unknown as typeof AudioWorkletNode);

  return {
    /** setup 把 source 接到 worklet：这一刻 ready 已经握手完成。 */
    connected: connected.promise,
    /** 结束序列真的走到 context.close()。 */
    closing: closing.promise,
    /** 模拟音频线程交出尾巴之后的结束标记。 */
    end: () => node?.port.onmessage?.({ data: 'end' } as MessageEvent<unknown>),
  };
}

test('取消后 getUserMedia 迟到 resolve：晚到的 stream 立刻停，不 ended 也不 failed', async () => {
  const controller = new AbortController();
  const stopped: string[] = [];
  let resolveGrant: (stream: MediaStream) => void = () => {};
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          resolveGrant = resolve;
        }),
    },
  });

  const ready = vi.fn(async (_sampleRate: number): Promise<void> => {});
  const push = vi.fn(async (_samples: Float32Array): Promise<void> => {});
  const ended = vi.fn(async (): Promise<void> => {});
  const failed = vi.fn();
  const events: DemoCaptureEvents = { ready, push, ended, failed, signal: controller.signal };

  const starting = createMicrophoneCapture(ticket, events);
  controller.abort(); // 授权对话框还挂着，界面先放弃了这一次
  resolveGrant(fakeStream(stopped));
  const handle = await starting;

  await handle.stop(); // 已经取消：stop 只等设备真的放开，不补一个 ended
  expect(stopped).toEqual(['audio']); // 晚到的 stream 立刻停
  expect(ready).not.toHaveBeenCalled(); // 不再请求设备之后的任何一步
  expect(ended).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();

  handle.dispose(); // 重复放弃同样安全
});

test('选定的真实麦克风 ID 进入唯一录音器的 exact 设备约束', async () => {
  const controller = new AbortController(),
    getUserMedia = vi.fn(async () => {
      throw new DOMException('Device unavailable', 'NotFoundError');
    });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  await createMicrophoneCapture(
    { ...ticket, microphoneId: 'physical-mic-2' },
    {
      signal: controller.signal,
      ready: async () => {},
      push: async () => {},
      ended: async () => {},
      failed: vi.fn(),
    },
  );
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: { channelCount: { ideal: 1 }, deviceId: { exact: 'physical-mic-2' } },
  });
});

test('signal 事先已取消：连设备都不请求，也不给出任何结论', async () => {
  const controller = new AbortController();
  controller.abort();
  const getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

  const ready = vi.fn(async (_sampleRate: number): Promise<void> => {});
  const push = vi.fn(async (_samples: Float32Array): Promise<void> => {});
  const ended = vi.fn(async (): Promise<void> => {});
  const failed = vi.fn();
  const events: DemoCaptureEvents = { ready, push, ended, failed, signal: controller.signal };

  const handle = await createMicrophoneCapture(ticket, events);

  expect(getUserMedia).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  expect(ended).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  handle.dispose();
});

test('取消后 stop 也等真实释放：授权还没回来就返回不算停', async () => {
  const controller = new AbortController();
  const stopped: string[] = [];
  let resolveGrant: (stream: MediaStream) => void = () => {};
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          resolveGrant = resolve;
        }),
    },
  });

  const ended = vi.fn(async (): Promise<void> => {});
  const handle = await createMicrophoneCapture(ticket, {
    signal: controller.signal,
    ready: async () => {},
    push: async () => {},
    ended,
    failed: vi.fn(),
  });
  controller.abort(); // 授权还挂着：这一次已经放弃

  let stopState: 'pending' | 'fulfilled' = 'pending';
  const stopping = handle.stop().then(() => {
    stopState = 'fulfilled';
  });
  for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stopState).toBe('pending'); // 设备还没回来：stop 不能提前返回

  resolveGrant(fakeStream(stopped));
  await stopping;

  expect(stopped).toEqual(['audio']); // 晚到的 stream 被停掉之后 stop 才成立
  expect(ended).not.toHaveBeenCalled();
});

test('stop 等到真实释放才 ended，且只发一次', async () => {
  const stopped: string[] = [];
  const log: string[] = [];
  const gate = deferred();
  const audio = stubAudio(gate.promise, log);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  const ended = vi.fn(async (): Promise<void> => {
    log.push('ended');
  });
  const handle = await createMicrophoneCapture(ticket, {
    ready: async () => {},
    push: async () => {},
    ended,
    failed: vi.fn(),
  });

  await audio.connected; // ready 已握手，音频图接上
  audio.end(); // 音频线程交出尾巴与结束标记

  let stopState: 'pending' | 'fulfilled' = 'pending';
  const stopping = handle.stop().then(() => {
    stopState = 'fulfilled';
  });
  await audio.closing; // 结束序列走到 context.close()，被门控住

  expect(stopState).toBe('pending'); // 还没放开：stop 不能提前返回
  expect(stopped).toEqual(['audio']); // 设备已经停了，音频图还没关
  expect(ended).not.toHaveBeenCalled(); // 释放未确认之前不发结论

  gate.resolve();
  await stopping;

  expect(log).toEqual(['closing', 'closed', 'ended']); // 先真的放开，再给结论
  expect(stopState).toBe('fulfilled');

  await handle.stop(); // 重复 stop 不再补一次 ended
  expect(ended).toHaveBeenCalledOnce();
});

test('释放没确认就不发 ended：stop 报失败，不吞成成功', async () => {
  const stopped: string[] = [];
  const log: string[] = [];
  const gate = deferred();
  const audio = stubAudio(gate.promise, log);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => fakeStream(stopped) },
  });

  const ended = vi.fn(async (): Promise<void> => {});
  const failed = vi.fn();
  const handle = await createMicrophoneCapture(ticket, {
    ready: async () => {},
    push: async () => {},
    ended,
    failed,
  });

  await audio.connected;
  audio.end();
  const stopping = handle.stop();
  await audio.closing;
  gate.reject(new Error('close failed')); // 浏览器没有真的把上下文关掉

  await stopping;
  expect(log).toEqual(['closing']); // 从未 close
  expect(ended).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith('failed');
});
