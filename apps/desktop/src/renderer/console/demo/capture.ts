import type { CaptureErrorReason } from '@pet/contracts';

/**
 * 麦克风采集的唯一入口是 demo/microphone.ts 里的 createMicrophoneCapture
 * （16kHz 单声道 Float32，与 M1 和 sherpa 通道一致；AudioWorklet，禁止 ScriptProcessor）。
 * 这里只声明控制台依赖的形状：采集侧掌握设备与顺序，控制台掌握序号与上行。
 */
export interface DemoCaptureEvents {
  /** 设备起来并把采样率定下来；控制台拿它去 captureReady。 */
  ready(sampleRate: number): Promise<void>;
  /** 一段 Float32 PCM；await 返回表示这一段已经交给宿主。 */
  push(samples: Float32Array): Promise<void>;
  /** 所有 push 之后仅一次：控制台在这一步提交 finishRecording。 */
  ended(): Promise<void>;
  /** 采集失败：只带固定原因，不带原始异常文本。 */
  failed(reason: CaptureErrorReason): void;
  /**
   * 可选中止信号：授权对话框卡住时控制台也能取消这一次。
   * 它只关本地设备，不代替 ended/failed 作结论。
   */
  readonly signal?: AbortSignal;
  /** 可选电平，界面用它画一根不说话的指示条。 */
  level?(rms: number): void;
}

export interface DemoCaptureHandle {
  /** 请求结束：停设备并触发 ended()。它本身不提交识别。 */
  stop(): Promise<void>;
  /** 只关本地设备，不提交结束：取消这一次用它。 */
  dispose(): void;
}

export { createMicrophoneCapture as microphoneCapture } from './microphone.js';
