/**
 * 中性浏览器采集：只认票据里的格式与上限，不认任何服务身份。
 *
 * 三条硬约束，全部由**一次真正的 cleanup**兑现，而不是靠多处 `void release()` 和注释：
 *
 * 1. **同步返回控制对象**。调用方拿到 handle 时设备可能还在请求中，arming 阶段因此
 *    仍可取消（C9）。
 * 2. **`released` 只在这件事真的做完后成立**：设备停掉、音频图拆掉、`context.close()`
 *    实际结算、所有在途 push 的 ack 回来。设备还在请求时取消，`released` 保持 pending，
 *    直到那个晚到的 stream 被停掉。
 * 3. **cleanup 只有一份**。重复调用拿到同一个 promise，不会出现「第一次还在等 close，
 *    第二次因为 context 已经是 null 就提前宣布干净」。
 *
 * 顺序是契约的一部分：设备起来 → 实际采样率与票据一致 → await ready → 才把
 * source 接到 worklet 出帧。结束（手动 finish 与录满 maxSamples 同一条路）先停
 * tracks，再向音频线程要回不足一帧的尾巴，等尾巴与之前每一帧的真实 ack，才拆端口
 * 与上下文。
 *
 * 这个模块不 import 任何宿主/服务类型：票据是窄的，事件是调用方给的。
 */
import {
  END_MARKER,
  FINISH_COMMAND,
  FORMAT_MARKER,
  VOICE_PROCESSOR_NAME,
} from './worklet-protocol.js';
import type {
  AudioCaptureEvents,
  AudioCaptureOperation,
  AudioCaptureOptions,
  AudioCaptureSummary,
  AudioCaptureTicket,
} from '@pet/contracts';
import type { CaptureErrorReason } from '@pet/contracts';

/** 还没拿到 ack 的帧数上限。上行慢到这个程度只能停下报错：继续攒帧是吃内存。 */
const MAX_PENDING_FRAMES = 8;

/** 把 getUserMedia 的失败翻译成固定的原因，不泄漏原始异常。 */
function reasonOf(error: unknown): CaptureErrorReason {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'denied';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'missing';
    // 设备被占用与读取失败都归到 failed：契约里的固定原因只有这四个。
    if (error.name === 'NotReadableError' || error.name === 'AbortError') return 'failed';
  }
  return 'failed';
}

/** 这一次没有可提交的结果：调用方据此不要启动 ASR。 */
export class CaptureAbortedError extends Error {
  constructor(reason: 'cancelled' | 'failed' | 'not-ready') {
    super(`capture ${reason}`);
    this.name = 'CaptureAbortedError';
  }
}

export function startCapture(
  ticket: AudioCaptureTicket,
  events: AudioCaptureEvents,
  options: AudioCaptureOptions,
): AudioCaptureOperation {
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;

  let closing = false; // finish/cancel 已经请求过
  let givenUp = false; // 取消过：这一次没有可提交的结果
  let failed = false; // 已经报过 failed
  let ready = false; // 调用方已经接受 ready，此后才有帧上行
  let samples = 0; // 已经交给调用方的采样点数
  let frames = 0; // 已经交出去的帧数
  let pendingAcks = 0; // 还没拿到 ack 的帧数
  let acked: Promise<void> = Promise.resolve(); // 所有 push 的串行链

  /** 唯一的一份清理；重复调用返回同一个 promise。 */
  let cleanupPromise: Promise<void> | null = null;
  /**
   * setup 的结算信号。
   *
   * 设备还在请求时取消，此时既没有 stream 也没有 context —— 但那不代表已经干净：
   * 晚到的授权仍然会把设备打开。所以 cleanup 必须等 setup 收完手再判定。
   */
  let markSetupSettled: () => void = () => {};
  const setupSettled = new Promise<void>((resolve) => {
    markSetupSettled = resolve;
  });
  /** 结束序列只走一次；失败时整体 reject，绝不返回部分 counts。 */
  let finishPromise: Promise<AudioCaptureSummary> | null = null;

  let resolveReleased: () => void = () => {};
  let rejectReleased: (error: unknown) => void = () => {};
  const released = new Promise<void>((resolve, reject) => {
    resolveReleased = resolve;
    rejectReleased = reject;
  });
  // 没人等 released 时，reject 不能变成未处理的拒绝。
  released.catch(() => {});

  // 拆端口时也要置这个标记：结束序列不能等一条不会再来的消息。
  let markStreamEnded: () => void = () => {};
  const streamed = new Promise<void>((resolve) => {
    markStreamEnded = resolve;
  });

  const signal = events.signal;
  /**
   * 具名监听器：abort 与 removeEventListener 必须引用同一个函数，
   * 否则监听永远摘不掉，晚到的 abort 还会再跑一次 dispose。
   */
  const onAbort = (): void => {
    dispose();
  };

  /** 停设备：麦克风占用与录音指示在这一步就该放开。 */
  function stopTracks(): void {
    if (stream !== null) {
      const stopping = stream;
      stream = null;
      for (const track of stopping.getTracks()) track.stop();
    }
  }

  /**
   * 拆音频图并等它真正结算。
   *
   * `context.close()` 是异步的：不 await 就等于「设备关了」但音频图还没放开。
   * close 抛错时只有 state 确实是 closed 才算已结算，否则把失败原样抛出去——
   * 不把未确认当成功。
   */
  async function releaseGraph(): Promise<void> {
    if (node !== null) {
      const closingNode = node;
      node = null;
      closingNode.port.onmessage = null;
      closingNode.port.close();
      closingNode.disconnect();
    }
    if (source !== null) {
      const closingSource = source;
      source = null;
      closingSource.disconnect();
    }
    if (context !== null) {
      const closingContext = context;
      context = null;
      try {
        await closingContext.close();
      } catch (error) {
        // 只有浏览器确实把它关掉了，才算结算完成；否则如实保留失败。
        if (closingContext.state !== 'closed') throw error;
      }
    }
    markStreamEnded();
  }

  /**
   * 唯一的一次清理。
   *
   * 顺序：先停设备（不再有新帧）→ 关端口让音频线程停手 → 等在途 push 的 ack →
   * 拆图并等 close 结算 → 摘 abort 监听。任何一步抛错都让 released reject，
   * 而不是假装干净。
   */
  function cleanup(): Promise<void> {
    if (cleanupPromise !== null) return cleanupPromise;
    cleanupPromise = (async () => {
      closing = true;
      // 先等 setup 走到它自己的结论：设备请求可能还在路上。
      await setupSettled;
      stopTracks();
      if (node !== null) node.port.onmessage = null;
      // 在途的 push 必须等完：否则调用方会以为最后几帧已经交出去了。
      await acked;
      await releaseGraph();
      signal?.removeEventListener('abort', onAbort);
    })();
    cleanupPromise.then(resolveReleased, rejectReleased);
    return cleanupPromise;
  }

  /** 每个 await 之后收一次手：调用方已经取消就不再请求下一步。 */
  function abandoned(): boolean {
    if (!closing) return false;
    void cleanup();
    return true;
  }

  /** 唯一的失败出口：先记下失败，再由 cleanup 兑现资源释放。 */
  function report(reason: CaptureErrorReason): void {
    if (failed) return;
    failed = true;
    closing = true;
    void cleanup();
    events.failed(reason);
  }

  /**
   * 结束序列：停设备 → 向音频线程要尾巴 → 等尾巴与之前每一帧的真实 ack → 才拆图。
   * 尾巴一到就排在 acked 链的末尾，所以结束一定在所有数据之后。
   *
   * 失败或取消时 **reject**：调用方绝不能拿部分 counts 去启动 ASR。
   */
  function finish(): Promise<AudioCaptureSummary> {
    if (finishPromise !== null) return finishPromise;
    finishPromise = (async () => {
      if (givenUp) {
        void cleanup();
        throw new CaptureAbortedError('cancelled');
      }
      if (failed) {
        void cleanup();
        throw new CaptureAbortedError('failed');
      }
      if (!ready) {
        // 还没开始采就要求结束：先让它停手，但**不要**在这里 await cleanup——
        // cleanup 要等 setup 结算，而 setup 可能正卡在设备授权上，等它就是等自己。
        dispose();
        throw new CaptureAbortedError('not-ready');
      }
      stopTracks();
      closing = true;
      node?.port.postMessage(FINISH_COMMAND);
      await streamed;
      await acked;
      const summary = { frames, samples };
      await cleanup();
      if (givenUp) throw new CaptureAbortedError('cancelled');
      if (failed) throw new CaptureAbortedError('failed');
      return summary;
    })();
    return finishPromise;
  }

  /** 一帧的上行：顺序由 acked 链保证，pendingAcks 是这一帧的排队许可。 */
  function send(frame: Float32Array): void {
    // 取消之后排队中的帧不再上行：它们属于一次已经放弃的采集。
    if (givenUp || failed) return;
    if (pendingAcks >= MAX_PENDING_FRAMES) {
      report('failed'); // 溢出：停下报错，不丢帧装成功
      return;
    }
    pendingAcks += 1;
    acked = acked.then(async () => {
      // 排到这一帧时如果已经取消，就不再交给调用方。
      if (failed || givenUp) {
        pendingAcks -= 1;
        return;
      }
      try {
        await events.push(frame);
        frames += 1;
      } catch {
        report('failed'); // reject 就是调用方拒收：关硬件并报失败
      }
      pendingAcks -= 1;
    });
  }

  /** 电平：一帧的 RMS，界面用它画一根不说话的指示条。 */
  function reportLevel(frame: Float32Array): void {
    if (events.level === undefined) return;
    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    events.level(Math.sqrt(sum / frame.length));
  }

  /** 音频线程的三个出口：结束标记、格式标记，否则必须是 Float32 帧，越过授权长度不入流。 */
  function onData(event: MessageEvent<unknown>): void {
    const data = event.data;
    if (data === END_MARKER) {
      markStreamEnded();
      return;
    }
    if (givenUp || failed) return;
    if (data === FORMAT_MARKER) {
      report('format'); // 采样点不是数：关硬件报格式失败，坏数据不入流
      return;
    }
    if (!(data instanceof Float32Array)) return;
    const room = ticket.maxSamples - samples;
    if (room <= 0) return;
    const frame = data.length > room ? data.slice(0, room) : data;
    samples += frame.length;
    reportLevel(frame);
    send(frame);
    if (samples >= ticket.maxSamples) {
      // 录满与点「结束」同义；通知调用方，让它按票据里的模式决定发送还是预览。
      events.limitReached();
      void finish().catch(() => {});
    }
  }

  /** 只关本地资源：不要尾巴、不上行、不重试。released 会等真实结算。 */
  function dispose(): void {
    if (givenUp) return;
    closing = true;
    givenUp = true;
    void cleanup();
  }

  /**
   * setup：设备 → 采样率校验 → worklet → ready → 接图。
   *
   * 任何一步之后被取消都立刻走 cleanup；晚到的 stream 在 abandoned 分支里被
   * stopTracks 停掉，因此 released 不会在设备仍活着时提前成立。
   */
  async function setup(): Promise<void> {
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      report('missing'); // 连采集 API 都没有：照实说缺少设备能力
      return;
    }
    try {
      const granted = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          ...(ticket.microphoneId ? { deviceId: { exact: ticket.microphoneId } } : {}),
        },
      });
      stream = granted;
      // 授权还挂着就放弃了：晚到的 stream 立刻停，设备不会漏在外面。
      if (abandoned()) return;
      context = new AudioContext({ sampleRate: ticket.sampleRate });
      if (context.sampleRate !== ticket.sampleRate) {
        report('format'); // 起不了目标采样率就报错，不猜实际速率、不自己重采样
        return;
      }
      if (context.state !== 'running') await context.resume();
      if (abandoned()) return;
      await context.audioWorklet.addModule(options.workletUrl);
      if (abandoned()) return;
      node = new AudioWorkletNode(context, VOICE_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { chunkSamples: ticket.chunkSamples },
      });
      source = context.createMediaStreamSource(stream);
      node.port.onmessage = onData;
      await events.ready(context.sampleRate); // 调用方点头之前一帧都不上行
      if (abandoned()) return;
      ready = true;
      source.connect(node);
      node.connect(context.destination); // 输出保持静音，只为让处理线程被拉起来
    } catch (error) {
      report(reasonOf(error));
    } finally {
      markSetupSettled();
    }
  }

  // 已经取消：连设备都不请求，直接算已释放（没有资源要等）。
  if (signal !== undefined && signal.aborted) {
    closing = true;
    givenUp = true;
    markSetupSettled();
    resolveReleased();
    return {
      finish: async () => {
        throw new CaptureAbortedError('cancelled');
      },
      cancel: async () => {},
      released,
    };
  }

  signal?.addEventListener('abort', onAbort, { once: true });
  void setup();

  return {
    finish,
    cancel: async () => {
      dispose();
      // 等真实结算；cleanup 失败时把失败传出去，不假装干净。
      await released;
    },
    released,
  };
}
