import type { CaptureErrorReason, DemoCaptureTicket } from '@pet/contracts';

import workletUrl from './capture-worklet.ts?worker&url';
import type { DemoCaptureEvents, DemoCaptureHandle } from './capture.js';

/** capture-worklet.ts 里注册的处理线程名字。 */
const PROCESSOR_NAME = 'pet-pcm-frame';

/** 给音频线程的唯一命令：交出不足一帧的尾巴。 */
const FINISH_REQUEST = 'finish';

/** 音频线程交出尾巴之后紧跟的结束标记；收到它才知道数据到头。 */
const END_MARKER = 'end';

/** 音频线程发现非 finite 采样点时的格式标记：数据已损坏，不能夹成 ±1 或补 0。 */
const FORMAT_MARKER = 'format';

/**
 * 还没拿到宿主 ack 的帧数上限。上行慢到这个程度只能停下报错：继续攒帧是吃内存，
 * 丢掉这一帧更是假成功。
 */
const MAX_PENDING_FRAMES = 8;

/**
 * 麦克风采集：getUserMedia + 16kHz AudioContext + AudioWorklet，按票据的 chunkSamples
 * 出单声道 Float32 帧，逐帧交给控制台。
 *
 * 顺序是契约的一部分：设备起来 → 实际采样率与票据一致 → await ready → 才接上音频出帧。
 * 结束（手动 stop 与录满 maxSamples 同一条路）先停 tracks，再向音频线程要回不足一帧的尾巴，
 * 等尾巴与之前每一帧的真实 ack，才只发一次 ended，最后才拆端口与上下文。
 * 失败只回传固定的 CaptureErrorReason，设备与音频图的原始异常留在本地。
 */
export async function createMicrophoneCapture(
  ticket: DemoCaptureTicket,
  events: DemoCaptureEvents,
): Promise<DemoCaptureHandle> {
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;

  let closing = false; // stop()/dispose() 已经请求过
  let givenUp = false; // dispose 过：这一次没有结束可提交
  let failed = false; // 已经报过 failed
  let settled = false; // ended 或 failed 已交给控制台，此后不再有第二个回调
  let ready = false; // 宿主已经接受 captureReady，此后才有 ended 可提交
  let samples = 0; // 已经交给控制台的采样点数
  let pendingAcks = 0; // 还没拿到 ack 的帧数
  let acked: Promise<void> = Promise.resolve(); // 所有 push 的串行链
  let ending: Promise<void> | null = null; // 结束序列只走一次

  // 拆端口时也要置这个标记：结束序列不能等一条不会再来的消息。
  let markStreamEnded: () => void = () => {};
  const streamed = new Promise<void>((resolve) => {
    markStreamEnded = resolve;
  });

  const handle: DemoCaptureHandle = { stop, dispose };
  const signal = events.signal;

  // 取消和「放弃这一次」是同一条路：只关本地资源，不 ended、不 failed。
  if (signal !== undefined && signal.aborted) return handle; // 已经取消：连设备都不请求
  signal?.addEventListener('abort', dispose, { once: true });

  /** 停设备：麦克风占用与录音指示在这一步就该放开。 */
  function stopTracks(): void {
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  /** 拆音频图：不再收帧，端口、节点与上下文一起放开。可重复调用。 */
  function releaseGraph(): void {
    if (node !== null) {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
      node = null;
    }
    if (source !== null) {
      source.disconnect();
      source = null;
    }
    if (context !== null) {
      void context.close();
      context = null;
    }
    signal?.removeEventListener('abort', dispose); // 资源已关：取消监听一起摘掉
    markStreamEnded();
  }

  /** 关硬件与音频图：设备优先，端口与上下文随后。 */
  function release(): void {
    stopTracks();
    releaseGraph();
  }

  /** 每个 await 之后收一次手：界面或宿主已经取消就不再请求下一步。 */
  function abandoned(): boolean {
    if (!closing) return false;
    release();
    return true;
  }

  /** 唯一的失败出口：先关硬件，再回传固定原因。 */
  function report(reason: CaptureErrorReason): void {
    if (settled) return;
    settled = true;
    failed = true;
    release();
    events.failed(reason);
  }

  /**
   * 结束序列：停设备 → 向音频线程要尾巴 → 等尾巴与之前每一帧的真实 ack → 只一次的 ended
   * → 才拆图。尾巴一到就排在 acked 链的末尾，所以 ended 一定在所有数据之后。
   */
  async function finish(): Promise<void> {
    stopTracks();
    if (!ready || settled || givenUp) {
      releaseGraph();
      return;
    }
    node?.port.postMessage(FINISH_REQUEST);
    await streamed;
    await acked;
    if (!settled && !givenUp) {
      settled = true;
      await events.ended();
    }
    releaseGraph();
  }

  function endOnce(): Promise<void> {
    if (ending === null) ending = finish();
    return ending;
  }

  /** 一帧的上行：顺序由 acked 链保证，pendingAcks 是这一帧的排队许可。 */
  function send(frame: Float32Array): void {
    if (pendingAcks >= MAX_PENDING_FRAMES) {
      report('failed'); // 溢出：停下报错，不丢帧装成功
      return;
    }
    pendingAcks += 1;
    acked = acked.then(async () => {
      if (failed) {
        pendingAcks -= 1;
        return;
      }
      try {
        await events.push(frame);
      } catch {
        report('failed'); // reject 就是宿主拒收：关硬件并报失败
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

  /** 音频线程的三个出口：结束标记、格式标记，否则必须是 Float32 帧，且越过授权长度不入流。 */
  function onData(event: MessageEvent<unknown>): void {
    const data = event.data;
    if (data === END_MARKER) {
      markStreamEnded();
      return;
    }
    if (data === FORMAT_MARKER) {
      report('format'); // 采样点不是数：关硬件报格式失败，坏数据不入流、不 ended
      return;
    }
    if (!(data instanceof Float32Array)) return;
    const room = ticket.maxSamples - samples;
    if (room <= 0) return;
    const frame = data.length > room ? data.slice(0, room) : data;
    samples += frame.length;
    reportLevel(frame);
    send(frame);
    if (samples >= ticket.maxSamples) void endOnce(); // 录满：与点「结束并识别」同义
  }

  async function stop(): Promise<void> {
    closing = true;
    await endOnce();
  }

  /** 只关本地资源：不要尾巴、不 ended、不重试。 */
  function dispose(): void {
    closing = true;
    givenUp = true;
    release();
  }

  if (navigator.mediaDevices?.getUserMedia === undefined) {
    report('missing'); // 连采集 API 都没有：照实说缺少设备能力
    return handle;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 } } });
    if (abandoned()) return handle; // 授权还挂着就放弃了：晚到的 stream 立刻停
    context = new AudioContext({ sampleRate: ticket.sampleRate });
    if (context.sampleRate !== ticket.sampleRate) {
      report('format'); // 起不了 16kHz 就报错，不猜实际速率、不自己重采样
      return handle;
    }
    if (context.state !== 'running') await context.resume();
    if (abandoned()) return handle;
    await context.audioWorklet.addModule(workletUrl);
    if (abandoned()) return handle;
    node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkSamples: ticket.chunkSamples },
    });
    source = context.createMediaStreamSource(stream);
    node.port.onmessage = onData;
    await events.ready(context.sampleRate); // 宿主点头之前一帧都不上行
    if (abandoned()) return handle; // 握手期间被取消：不接上音频，也不补 ended
    ready = true;
    source.connect(node);
    node.connect(context.destination); // 输出保持静音，只为让处理线程被拉起来
  } catch (error) {
    report(reasonOf(error));
  }
  return handle;
}

/** 设备与音频图的异常归到固定原因；原始名称与消息不回传给宿主。 */
function reasonOf(error: unknown): CaptureErrorReason {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'failed';
}
