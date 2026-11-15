/**
 * 采集 worklet 的音频线程作用域声明（全局脚本：不导入也不导出任何东西）。
 *
 * TypeScript 的 DOM lib 里没有 AudioWorkletProcessor 与 registerProcessor，它们只存在于
 * 那个线程。桌面这一侧转发的是共用的 `@pet/audio-capture/capture-worklet`，而本包的
 * tsconfig 不含那个目录，所以这份声明补上那份实现编译时用到的两个名字。
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processorConstructor: { new (): AudioWorkletProcessor },
): void;
