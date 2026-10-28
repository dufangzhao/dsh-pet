/**
 * 采集 worklet 用到的两份环境声明（这个文件是全局脚本：不导入也不导出任何东西）。
 *
 * 1. AudioWorklet 处理线程的作用域：TypeScript 的 DOM lib 里没有 AudioWorkletProcessor 与
 *    registerProcessor，它们只存在于那个线程，这里只声明 capture-worklet.ts 用到的两个名字。
 * 2. worklet 的脚本地址。Vite 只在 worker 编译模式下把这份 .ts 编成浏览器可执行的脚本，产出的
 *    URL 与主脚本同源同目录（应用 CSP 的 script-src 'self' 只认它）：纯 ?url 会把源文件原文
 *    内联成 data: URL，worklet 拿到的既不是 JS，也不是 'self'。
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processorConstructor: { new (): AudioWorkletProcessor },
): void;

declare module '*capture-worklet.ts?worker&url' {
  const workletUrl: string;
  export default workletUrl;
}
