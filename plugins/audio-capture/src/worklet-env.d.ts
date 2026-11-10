/**
 * 采集 worklet 用到的环境声明（全局脚本：不导入也不导出任何东西）。
 *
 * TypeScript 的 DOM lib 里没有 AudioWorkletProcessor 与 registerProcessor，
 * 它们只存在于音频线程的作用域，这里只声明 capture-worklet.ts 用到的两个名字。
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processorConstructor: { new (): AudioWorkletProcessor },
): void;
