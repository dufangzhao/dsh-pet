/**
 * 采样器：把中性的 `startCapture` 适配成组件认得的窄形状。
 *
 * 设备、顺序、尾巴冲刷、逐帧确认与释放全在 `@pet/audio-capture/browser` 里，
 * 这里只做形状转换——不复制采集逻辑，也不碰任何服务身份。
 */
import { startCapture } from '@pet/audio-capture/browser';

import type { VoiceSampler } from './voice-input.js';

export function createVoiceSampler(): VoiceSampler {
  return {
    unavailableReason: () => {
      if (globalThis.isSecureContext === false)
        return '浏览器录音需要 HTTPS 或本机回环地址（localhost/127.0.0.1）。';
      if (
        typeof navigator === 'undefined' ||
        typeof navigator.mediaDevices?.getUserMedia !== 'function' ||
        typeof AudioContext === 'undefined' ||
        typeof AudioWorkletNode === 'undefined'
      )
        return '当前浏览器不支持所需的麦克风采样接口。';
      return null;
    },
    start: (input) =>
      startCapture(
        input.ticket,
        {
          ready: (sampleRate) => input.onReady(sampleRate),
          push: (samples) => input.onPush(samples),
          failed: (reason) => input.onFailed(reason),
          limitReached: () => input.onLimitReached(),
          ...(input.onLevel === undefined ? {} : { level: (rms: number) => input.onLevel?.(rms) }),
        },
        { workletUrl: input.workletUrl },
      ),
  };
}
