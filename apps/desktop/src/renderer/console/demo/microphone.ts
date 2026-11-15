/**
 * 旧 Demo 采集入口：把中性采集适配成控制台原有的 DemoCaptureEvents/Handle。
 *
 * 设备、顺序、尾巴冲刷、逐帧确认、失败出口与真实释放都在
 * `@pet/audio-capture/browser` 里，这里只做形状转换：旧票据没有编码/声道字段，
 * 这一层补成真实值；旧接口没有「录满」回调，录满按旧语义等同于点结束。
 */
import { CaptureAbortedError, startCapture } from '@pet/audio-capture/browser';
import workletUrl from '@pet/audio-capture/capture-worklet?worker&url';

import type { DemoCaptureTicket } from '@pet/contracts';

import type { DemoCaptureEvents, DemoCaptureHandle } from './capture.js';

export async function createMicrophoneCapture(
  ticket: DemoCaptureTicket,
  events: DemoCaptureEvents,
): Promise<DemoCaptureHandle> {
  let reported = false; // events.failed 已经报过，不再报第二次
  let stopping: Promise<void> | null = null;

  const operation = startCapture(
    {
      encoding: 'f32le',
      sampleRate: ticket.sampleRate,
      channels: 1,
      chunkSamples: ticket.chunkSamples,
      maxSamples: ticket.maxSamples,
      ...(ticket.microphoneId === undefined ? {} : { microphoneId: ticket.microphoneId }),
    },
    {
      ready: (sampleRate) => events.ready(sampleRate),
      push: (samples) => events.push(samples),
      failed: (reason) => {
        reported = true;
        events.failed(reason);
      },
      limitReached: () => {
        // 录满与点「结束」同义；调用方自己的 ended() 抛错归它，不在这里再报一次。
        void stop().catch(() => {});
      },
      ...(events.level === undefined ? {} : { level: (rms: number) => events.level?.(rms) }),
      ...(events.signal === undefined ? {} : { signal: events.signal }),
    },
    { workletUrl },
  );

  /** 停设备并等这一次真正收尾（尾巴、逐帧确认、上下文关闭），然后只发一次 ended()。 */
  async function finish(): Promise<void> {
    const concluded = await operation.finish().then(
      () => true,
      (error: unknown) => {
        // 取消、未就绪或已经失败过：这一次没有第二个结论可给。
        if (error instanceof CaptureAbortedError) return false;
        // 释放没确认：如实报失败（已经报过的不重复），不吞成成功。
        if (!reported) {
          reported = true;
          events.failed('failed');
        }
        return false;
      },
    );
    await operation.released.catch(() => {}); // stop 必须等设备真的放开才返回
    if (concluded) await events.ended();
  }

  function stop(): Promise<void> {
    stopping ??= finish();
    return stopping;
  }

  return {
    stop,
    // 只关本地资源：不要尾巴、不 ended、不重试。旧接口没有失败通道，释放结果不再回传。
    dispose: () => void operation.cancel().catch(() => {}),
  };
}
