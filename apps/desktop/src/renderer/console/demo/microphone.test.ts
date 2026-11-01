import type { DemoCaptureTicket } from '@pet/contracts';
import { afterEach, expect, test, vi } from 'vitest';

import type { DemoCaptureEvents } from './capture.js';
import { createMicrophoneCapture } from './microphone.js';

/**
 * 取消路径的真实回归：授权还挂着就点「取消」时，getUserMedia 晚回来的 stream 必须立刻停，
 * 而且这一次既不 ended 也不 failed —— 控制台的 cancel() 已经给了宿主结论。
 * 采集器不碰 AudioContext，所以这里只需要一枚假的 mediaDevices。
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

  expect(stopped).toEqual(['audio']); // 晚到的 stream 立刻停
  expect(ready).not.toHaveBeenCalled(); // 不再请求设备之后的任何一步
  expect(ended).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();

  await handle.stop(); // 已经取消：stop 也只是收手，不补一个 ended
  expect(ended).not.toHaveBeenCalled();
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
